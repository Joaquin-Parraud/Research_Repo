import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../api/library";
import { baseRoutes, bodyOf, makeCitation, makeProject, makeSource } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => undefined)) }));

const citationOnly = (overrides: Partial<Source> = {}) =>
  makeSource({ has_file: false, file: null, csl: { type: "book", title: "Alpha paper" }, ...overrides });

let writeText: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;

class FakeClipboardItem {
  constructor(public readonly data: Record<string, Blob>) {}
}

function installClipboard(options: { rich?: boolean } = { rich: true }) {
  writeText = vi.fn(() => Promise.resolve());
  write = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: options.rich ? { writeText, write } : { writeText },
  });
  if (options.rich) vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  else vi.stubGlobal("ClipboardItem", undefined);
}

beforeEach(() => installClipboard());
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  localStorage.clear();
});

async function openSource(source: Source, routes: Parameters<typeof mockApi>[0] = {}, role: "owner" | "viewer" = "owner") {
  const fetchMock = mockApi({
    ...baseRoutes({ role }),
    "GET /api/sources/s1": () => jsonResponse(200, source),
    ...routes,
  });
  renderApp("/p/p1?source=s1");
  const panel = await screen.findByRole("region", { name: "Citation" });
  return { fetchMock, panel };
}

describe("citation panel", () => {
  it("shows the reference with italics, both in-text forms and the citation language", async () => {
    const { panel } = await openSource(citationOnly());
    const p = within(panel);
    expect(await p.findByText("Journal", { selector: "i" })).toBeInTheDocument();
    expect(p.getByText("1", { selector: "i" })).toBeInTheDocument();
    expect(p.getByText("(Doe, 2020)")).toBeInTheDocument();
    expect(p.getByText("Doe (2020)")).toBeInTheDocument();
    expect(p.getByText("In-text (parenthetical)")).toBeInTheDocument();
    expect(p.getByText("In-text (narrative)")).toBeInTheDocument();
    expect(p.getByText("APA 7th edition. Citation language: English (en-US).")).toBeInTheDocument();
  });

  it("shows the citation language the server used", async () => {
    const { panel } = await openSource(citationOnly(), {
      "GET /api/sources/s1/citation": () => jsonResponse(200, makeCitation({ locale: "es" })),
    });
    expect(await within(panel).findByText("APA 7th edition. Citation language: Spanish (es).")).toBeInTheDocument();
  });

  it("does not render a <script> or an <img onerror> from reference_html", async () => {
    const { panel } = await openSource(citationOnly(), {
      "GET /api/sources/s1/citation": () =>
        jsonResponse(
          200,
          makeCitation({
            reference_html:
              'Doe (2020). <i>Safe</i><script>window.__xss = 1</script><img src="x" onerror="window.__xss = 2"><b onclick="window.__xss = 3">bold</b>',
          }),
        ),
    });
    await within(panel).findByText("Safe", { selector: "i" });
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(panel.querySelector("[onclick], [onerror]")).toBeNull();
    expect(within(panel).getByText("bold", { selector: "b" })).toBeInTheDocument();
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });

  it("copies the plain-text reference and each in-text form", async () => {
    const { panel } = await openSource(citationOnly());
    const p = within(panel);
    await p.findByText("(Doe, 2020)");
    fireEvent.click(p.getByRole("button", { name: "Copy reference" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Doe, J. (2020). A study. Journal, 1(2), 3-4."));
    fireEvent.click(p.getByRole("button", { name: "Copy parenthetical citation" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("(Doe, 2020)"));
    fireEvent.click(p.getByRole("button", { name: "Copy narrative citation" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Doe (2020)"));
    expect((await screen.findAllByText("Copied to the clipboard.")).length).toBeGreaterThan(0);
  });

  it("'Copy formatted' writes text/html (sanitised, with italics) and text/plain together", async () => {
    const { panel } = await openSource(citationOnly(), {
      "GET /api/sources/s1/citation": () =>
        jsonResponse(
          200,
          makeCitation({
            reference_text: "Doe. Title. Journal.",
            reference_html: 'Doe. Title. <i onclick="x">Journal</i>.<script>bad()</script>',
          }),
        ),
    });
    await within(panel).findByText("Journal", { selector: "i" });
    fireEvent.click(within(panel).getByRole("button", { name: "Copy formatted" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const items = write.mock.calls[0]?.[0] as FakeClipboardItem[];
    expect(items).toHaveLength(1);
    const data = items[0]?.data ?? {};
    expect(Object.keys(data).sort()).toEqual(["text/html", "text/plain"]);
    expect(await data["text/html"]?.text()).toBe("Doe. Title. <i>Journal</i>.");
    expect(data["text/html"]?.type).toBe("text/html");
    expect(await data["text/plain"]?.text()).toBe("Doe. Title. Journal.");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("'Copy formatted' falls back to plain text when rich clipboard writes are unavailable", async () => {
    installClipboard({ rich: false });
    const { panel } = await openSource(citationOnly());
    await within(panel).findByText("Journal", { selector: "i" });
    fireEvent.click(within(panel).getByRole("button", { name: "Copy formatted" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Doe, J. (2020). A study. Journal, 1(2), 3-4."));
  });

  it("falls back to plain text when the rich write is refused", async () => {
    write.mockRejectedValueOnce(new Error("denied"));
    const { panel } = await openSource(citationOnly());
    await within(panel).findByText("Journal", { selector: "i" });
    fireEvent.click(within(panel).getByRole("button", { name: "Copy formatted" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it("reports a failed copy", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    // jsdom has no execCommand, so the legacy path fails as well.
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    const { panel } = await openSource(citationOnly());
    await within(panel).findByText("(Doe, 2020)");
    fireEvent.click(within(panel).getByRole("button", { name: "Copy parenthetical citation" }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("is available to viewers (read-only role)", async () => {
    const { panel } = await openSource(citationOnly(), {}, "viewer");
    expect(await within(panel).findByText("(Doe, 2020)")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy reference" })).toBeEnabled();
  });
});

describe("citation panel: states", () => {
  it("asks for metadata while it is pending, without requesting a citation", async () => {
    const { fetchMock, panel } = await openSource(citationOnly({ metadata_status: "pending" }));
    expect(within(panel).getByText("Add metadata to get a citation.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/citation"))).toBe(false);

    await userEvent.click(within(panel).getByRole("button", { name: "Add metadata" }));
    expect(await screen.findByRole("dialog", { name: "Edit metadata" })).toBeInTheDocument();
  });

  it("viewers see the pending message but no button", async () => {
    const { panel } = await openSource(citationOnly({ metadata_status: "pending" }), {}, "viewer");
    expect(within(panel).getByText("Add metadata to get a citation.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add metadata" })).not.toBeInTheDocument();
  });

  it("notes when the citation is based on a suggestion", async () => {
    const { panel } = await openSource(citationOnly({ metadata_status: "suggested" }));
    expect(await within(panel).findByText(/based on suggested metadata/)).toBeInTheDocument();
    expect(within(panel).getByText("(Doe, 2020)")).toBeInTheDocument();
  });

  it("shows a translated error with a retry", async () => {
    let calls = 0;
    const { panel } = await openSource(citationOnly(), {
      "GET /api/sources/s1/citation": () => (++calls === 1 ? errorResponse(500, "server.internal") : jsonResponse(200, makeCitation())),
    });
    expect(await within(panel).findByText(/Something went wrong on the server/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(await within(panel).findByText("(Doe, 2020)")).toBeInTheDocument();
  });

  it("fetches the citation again after the metadata is saved", async () => {
    let source = citationOnly({ metadata_status: "suggested", updated_at: "2026-02-01T00:00:00Z" });
    let citations = 0;
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s1": () => jsonResponse(200, source),
      "GET /api/sources/s1/citation": () =>
        jsonResponse(200, makeCitation({ in_text_parenthetical: citations++ === 0 ? "(Old, 2019)" : "(New, 2024)" })),
      "PATCH /api/sources/s1": (init) => {
        const body = bodyOf(init) as { csl: Record<string, unknown> };
        source = { ...source, csl: body.csl, metadata_status: "confirmed", updated_at: "2026-03-01T00:00:00Z" };
        return jsonResponse(200, source);
      },
    });
    renderApp("/p/p1?source=s1");
    expect(await screen.findByText("(Old, 2019)")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Edit metadata" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit metadata" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save and confirm" }));

    expect(await screen.findByText("(New, 2024)")).toBeInTheDocument();
    expect(citations).toBe(2);
    // Confirmed: the badge is gone.
    expect(screen.queryByText("Review suggestion")).not.toBeInTheDocument();
  });

  it("fetches the citation again when the project's citation language changes", async () => {
    let project = makeProject();
    let citations = 0;
    mockApi({
      ...baseRoutes(),
      "GET /api/projects/p1": () => jsonResponse(200, project),
      "GET /api/sources/s1": () => jsonResponse(200, citationOnly()),
      "GET /api/sources/s1/citation": () => {
        citations += 1;
        return jsonResponse(200, makeCitation({ locale: project.citation_locale }));
      },
      "PATCH /api/projects/p1": () => {
        project = { ...project, citation_locale: "es" };
        return jsonResponse(200, project);
      },
    });
    renderApp("/p/p1?source=s1");
    expect(await screen.findByText(/Citation language: English/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Settings for Thesis" }));
    const dialog = await screen.findByRole("dialog", { name: "Project settings" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Citation language"), "es");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Citation language: Spanish/)).toBeInTheDocument();
    expect(citations).toBe(2);
  });
});
