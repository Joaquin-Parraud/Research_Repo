import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bibliography } from "../api/citations";
import { baseRoutes, bodyOf, makeSummary, sampleTree } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

let blobs: Blob[];
let downloads: string[];
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  blobs = [];
  downloads = [];
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:test";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  localStorage.clear();
});

const answers: Record<string, Bibliography> = {
  text: { format: "text", count: 2, content: "Alpha, A. (2020). One.\nBeta, B. (2021). Two." },
  html: { format: "html", count: 2, content: "<div class=\"csl-bib-body\">…</div>" },
  bibtex: { format: "bibtex", count: 2, content: "@article{alpha2020,\n  title={One}\n}" },
  csl: { format: "csl", count: 2, content: [{ id: "alpha2020", type: "book" }] },
};

function setup(count?: number) {
  const bodies: Record<string, unknown>[] = [];
  const tree = sampleTree();
  tree.sources.push(makeSummary("s5", "Epsilon", "f1"));
  mockApi({
    ...baseRoutes({ tree }),
    "POST /api/projects/p1/bibliography": (init) => {
      const body = bodyOf(init) as { format: string };
      bodies.push(body as Record<string, unknown>);
      const answer = answers[body.format] ?? answers.text;
      return jsonResponse(200, count === undefined ? answer : { ...answer, count, content: count === 0 ? "" : answer?.content });
    },
  });
  return bodies;
}

const last = (bodies: unknown[]) => bodies[bodies.length - 1];

describe("bibliography export", () => {
  it("selection: sends source_ids, shows the count and a preview", async () => {
    const bodies = setup();
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Alpha paper”" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Gamma report”" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Actions for selected sources" })).getByRole("button", { name: "Export selected" }));

    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    expect(d.getByRole("radio", { name: "The 2 selected sources" })).toBeChecked();
    expect(await d.findByText("2 references")).toBeInTheDocument();
    expect(bodies).toEqual([{ format: "text", source_ids: ["s1", "s3"] }]);
    expect(d.getByLabelText("Bibliography preview")).toHaveTextContent("Alpha, A. (2020). One.");
  });

  it("folder: sends folder_id and include_subfolders, and follows the toggle", async () => {
    const bodies = setup();
    renderApp("/p/p1/f/f1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export bibliography" }));

    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    expect(d.getByRole("radio", { name: "Folder “Theory”" })).toBeChecked();
    await d.findByText("2 references");
    expect(last(bodies)).toEqual({ format: "text", folder_id: "f1", include_subfolders: true });

    await userEvent.click(d.getByRole("checkbox", { name: "Include subfolders" }));
    await waitFor(() => expect(last(bodies)).toEqual({ format: "text", folder_id: "f1", include_subfolders: false }));
  });

  it("project: sends neither source_ids nor folder_id", async () => {
    const bodies = setup();
    renderApp("/p/p1/f/f1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));

    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    expect(d.getByRole("radio", { name: "The whole project “Thesis”" })).toBeChecked();
    await d.findByText("2 references");
    expect(last(bodies)).toEqual({ format: "text" });
    expect(Object.keys(last(bodies) as object)).toEqual(["format"]);

    // The scope can be changed inside the dialog.
    await userEvent.click(d.getByRole("radio", { name: "Folder “Theory”" }));
    await waitFor(() => expect(last(bodies)).toEqual({ format: "text", folder_id: "f1", include_subfolders: true }));
  });

  it("the project root is exported as the whole project (no ambiguous folder_id: null)", async () => {
    const bodies = setup();
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    expect(within(dialog).queryByRole("radio", { name: /^Folder/ })).not.toBeInTheDocument();
    await within(dialog).findByText("2 references");
    expect(last(bodies)).toEqual({ format: "text" });
  });

  it("changes format: formatted text, HTML, BibTeX and CSL-JSON", async () => {
    const bodies = setup();
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    const format = d.getByLabelText("Format");
    expect(within(format).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Formatted text",
      "HTML",
      "BibTeX",
      "CSL-JSON",
    ]);

    await userEvent.selectOptions(format, "bibtex");
    await waitFor(() => expect(last(bodies)).toEqual({ format: "bibtex" }));
    expect(await d.findByLabelText("Bibliography preview")).toHaveTextContent("@article{alpha2020");

    await userEvent.selectOptions(format, "csl");
    await waitFor(() => expect(last(bodies)).toEqual({ format: "csl" }));
    await waitFor(() => expect(d.getByLabelText("Bibliography preview")).toHaveTextContent('"id": "alpha2020"'));

    await userEvent.selectOptions(format, "html");
    await waitFor(() => expect(last(bodies)).toEqual({ format: "html" }));
  });

  it("copies the content", async () => {
    setup();
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    await within(dialog).findByText("2 references");
    await userEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(answers.text?.content));
    expect(await screen.findByText("Bibliography copied to the clipboard.")).toBeInTheDocument();
  });

  it("downloads a Blob with a sensible filename and MIME type per format", async () => {
    setup();
    renderApp("/p/p1/f/f1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    await d.findByText("2 references");

    await userEvent.click(d.getByRole("button", { name: "Download" }));
    expect(downloads).toEqual(["theory-bibliography.txt"]);
    expect(blobs[0]?.type).toBe("text/plain;charset=utf-8");
    expect(await blobs[0]?.text()).toBe(answers.text?.content);

    await userEvent.selectOptions(d.getByLabelText("Format"), "bibtex");
    await d.findByText(/@article\{alpha2020/);
    await userEvent.click(d.getByRole("button", { name: "Download" }));
    expect(downloads[1]).toBe("theory-bibliography.bib");
    expect(blobs[1]?.type).toMatch(/^application\/x-bibtex/);

    await userEvent.selectOptions(d.getByLabelText("Format"), "csl");
    await waitFor(() => expect(d.getByLabelText("Bibliography preview")).toHaveTextContent('"id": "alpha2020"'));
    await userEvent.click(d.getByRole("button", { name: "Download" }));
    expect(downloads[2]).toBe("theory-bibliography.json");
    expect(blobs[2]?.type).toMatch(/^application\/vnd\.citationstyles\.csl\+json/);
    expect(JSON.parse((await blobs[2]?.text()) ?? "")).toEqual([{ id: "alpha2020", type: "book" }]);

    await userEvent.selectOptions(d.getByLabelText("Format"), "html");
    await waitFor(() => expect(d.getByLabelText("Bibliography preview")).toHaveTextContent("csl-bib-body"));
    await userEvent.click(d.getByRole("button", { name: "Download" }));
    expect(downloads[3]).toBe("theory-bibliography.html");
    expect(blobs[3]?.type).toMatch(/^text\/html/);
  });

  it("names a project export after the project", async () => {
    setup();
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    await within(dialog).findByText("2 references");
    await userEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(downloads).toEqual(["thesis-bibliography.txt"]);
  });

  it("shows an empty state and disables copy and download when there is nothing to export", async () => {
    setup(0);
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    const d = within(dialog);
    expect(await d.findByText("0 references")).toBeInTheDocument();
    expect(d.getByText("There are no sources to export for this choice.")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(d.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(d.queryByLabelText("Bibliography preview")).not.toBeInTheDocument();
  });

  it("shows a translated error", async () => {
    mockApi({
      ...baseRoutes(),
      "POST /api/projects/p1/bibliography": () => errorResponse(500, "server.internal"),
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("button", { name: "Export project bibliography" }));
    const dialog = await screen.findByRole("dialog", { name: "Export bibliography" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Something went wrong on the server/);
  });

  it("is available to viewers", async () => {
    setup();
    mockApi({
      ...baseRoutes({ role: "viewer", projects: [] }),
      "POST /api/projects/p1/bibliography": () => jsonResponse(200, answers.text),
      "GET /api/projects?include_archived=false": () => jsonResponse(200, []),
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    expect(screen.getByRole("button", { name: "Export bibliography" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export project bibliography" })).toBeInTheDocument();
  });
});
