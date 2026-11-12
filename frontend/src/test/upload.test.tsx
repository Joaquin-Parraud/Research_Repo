import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, makeSource } from "./fixtures";
import { FakeXHR } from "./fakeXhr";
import { jsonResponse, mockApi, renderApp } from "./helpers";

beforeEach(() => {
  FakeXHR.reset();
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const txt = (name: string) => new File(["hello"], name, { type: "text/plain" });

function drop(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } });
}

async function renderWithList(path = "/p/p1") {
  const fetchMock = mockApi({ ...baseRoutes() });
  renderApp(path);
  const list = await screen.findByRole("list", { name: "Sources in this folder" });
  return { fetchMock, list, dropZone: list.parentElement as HTMLElement };
}

describe("uploads", () => {
  it("uploads dropped PDFs into the current folder with per-file progress, then refreshes the list", async () => {
    const { fetchMock, dropZone } = await renderWithList("/p/p1/f/f1");
    const treeCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/projects/p1/tree").length;
    const before = treeCalls();

    drop(dropZone, [pdf("one.pdf"), pdf("two.pdf")]);

    const panel = await screen.findByRole("region", { name: "Uploads" });
    expect(within(panel).getByText("one.pdf")).toBeInTheDocument();
    expect(within(panel).getByText("two.pdf")).toBeInTheDocument();
    expect(FakeXHR.instances).toHaveLength(2);
    const [first, second] = FakeXHR.instances;
    expect(first?.url).toBe("/api/projects/p1/sources");
    expect(first?.withCredentials).toBe(true);
    expect(first?.body?.get("folder_id")).toBe("f1");
    expect((first?.body?.get("file") as File).name).toBe("one.pdf");
    expect(first?.body?.has("allow_duplicate")).toBe(false);

    act(() => first?.progress(0.5));
    expect(within(panel).getByText("Uploading… 50%")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Upload progress for one.pdf" })).toHaveValue(0.5);

    act(() => first?.respond(201, makeSource({ title: "one" })));
    expect(await within(panel).findByText("Uploaded")).toBeInTheDocument();
    // Still running for the other one.
    expect(within(panel).getByRole("progressbar", { name: "Upload progress for two.pdf" })).toBeInTheDocument();
    await vi.waitFor(() => expect(treeCalls()).toBeGreaterThan(before));
    act(() => second?.respond(201, makeSource({ id: "s8" })));
  });

  it("omits folder_id when uploading to the project root", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("root.pdf")]);
    await screen.findByRole("region", { name: "Uploads" });
    expect(FakeXHR.instances[0]?.body?.has("folder_id")).toBe(false);
  });

  it("uploads into a folder when files are dropped on it in the tree", async () => {
    await renderWithList();
    const folderRow = screen.getByRole("treeitem", { name: /Theory/ }).querySelector("div") as HTMLElement;
    drop(folderRow, [pdf("theory.pdf")]);
    await screen.findByRole("region", { name: "Uploads" });
    expect(FakeXHR.instances[0]?.body?.get("folder_id")).toBe("f1");
  });

  it("rejects non-PDF files client-side with a message and never sends them", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [txt("notes.txt"), pdf("ok.pdf")]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 file was skipped because only PDF files can be uploaded: notes.txt",
    );
    expect(FakeXHR.instances).toHaveLength(1);
    expect((FakeXHR.instances[0]?.body?.get("file") as File).name).toBe("ok.pdf");
  });

  it("rejects non-PDF files chosen in the Add source dialog", async () => {
    await renderWithList();
    const user = userEvent.setup({ applyAccept: false });
    await user.click(screen.getByRole("button", { name: "Add source" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a source" });
    await user.upload(within(dialog).getByLabelText("PDF files"), [txt("a.txt"), txt("b.docx")]);

    expect(await screen.findByRole("alert")).toHaveTextContent("2 files were skipped");
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("limits concurrency and starts the next file as slots free up", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, ["a", "b", "c", "d", "e"].map((n) => pdf(`${n}.pdf`)));
    await screen.findByRole("region", { name: "Uploads" });
    expect(FakeXHR.instances).toHaveLength(3);
    act(() => FakeXHR.instances[0]?.respond(201, makeSource()));
    await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(4));
  });

  it("shows a translated failure and retries", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("bad.pdf")]);
    const panel = await screen.findByRole("region", { name: "Uploads" });

    act(() => FakeXHR.instances[0]?.respond(422, { error: { code: "source.invalid_pdf", message: "English" } }));
    expect(await within(panel).findByText("That file is not a valid PDF.")).toBeInTheDocument();
    expect(within(panel).queryByText("English")).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(FakeXHR.instances).toHaveLength(2);
    act(() => FakeXHR.instances[1]?.respond(201, makeSource()));
    expect(await within(panel).findByText("Uploaded")).toBeInTheDocument();
  });

  it("reports network failures", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("x.pdf")]);
    const panel = await screen.findByRole("region", { name: "Uploads" });
    act(() => FakeXHR.instances[0]?.fail());
    expect(await within(panel).findByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it("duplicate: offers Add anyway, which retries with allow_duplicate=true", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("dup.pdf")]);
    const panel = await screen.findByRole("region", { name: "Uploads" });

    act(() =>
      FakeXHR.instances[0]?.respond(409, {
        error: { code: "source.duplicate_file", message: "dup", details: { existing_source_id: "s1" } },
      }),
    );
    expect(await within(panel).findByText("This PDF is already in the project.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Add anyway" }));

    expect(FakeXHR.instances).toHaveLength(2);
    expect(FakeXHR.instances[1]?.body?.get("allow_duplicate")).toBe("true");
    act(() => FakeXHR.instances[1]?.respond(201, makeSource()));
    expect(await within(panel).findByText("Uploaded")).toBeInTheDocument();
  });

  it("duplicate: Skip removes the item without another request", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("dup.pdf")]);
    const panel = await screen.findByRole("region", { name: "Uploads" });
    act(() =>
      FakeXHR.instances[0]?.respond(409, {
        error: { code: "source.duplicate_file", message: "dup", details: { existing_source_id: "s1" } },
      }),
    );
    await userEvent.click(await within(panel).findByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("region", { name: "Uploads" })).not.toBeInTheDocument();
    expect(FakeXHR.instances).toHaveLength(1);
  });

  it("viewers cannot drop files", async () => {
    mockApi({
      ...baseRoutes({ role: "viewer" }),
      "GET /api/projects?include_archived=false": () =>
        jsonResponse(200, [{ ...(await_project()), role: "viewer" }]),
    });
    renderApp("/p/p1");
    const list = await screen.findByRole("list", { name: "Sources in this folder" });
    drop(list.parentElement as HTMLElement, [pdf("x.pdf")]);
    expect(FakeXHR.instances).toHaveLength(0);
  });
});

function await_project() {
  return {
    id: "p1",
    name: "Thesis",
    slug: "t",
    description: "",
    citation_locale: "en-US",
    archived_at: null,
    created_at: "x",
    updated_at: "x",
    source_count: 1,
  };
}
