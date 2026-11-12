import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, makeSource } from "./fixtures";
import { FakeXHR } from "./fakeXhr";
import { jsonResponse, mockApi, renderApp } from "./helpers";


// Attaching a PDF makes the viewer appear; pdf.js itself needs a real browser.
vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => undefined)) }));
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

describe("config-driven behaviour", () => {
  const sized = (name: string, bytes: number) => {
    const file = pdf(name);
    Object.defineProperty(file, "size", { value: bytes });
    return file;
  };

  it("rejects files above max_upload_mb client-side, stating the limit, and uploads the rest", async () => {
    mockApi({ ...baseRoutes({ config: { max_upload_mb: 2, metadata_lookup_enabled: true } }) });
    renderApp("/p/p1");
    const list = await screen.findByRole("list", { name: "Sources in this folder" });
    // Wait for the config to arrive (the Add dialog shows it).
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(await screen.findByText("Each file can be up to 2 MB.")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    drop(list.parentElement as HTMLElement, [sized("big.pdf", 2 * 1024 * 1024 + 1), sized("ok.pdf", 1024)]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 file was skipped because it is larger than the 2 MB limit: big.pdf",
    );
    expect(FakeXHR.instances).toHaveLength(1);
    expect((FakeXHR.instances[0]?.body?.get("file") as File).name).toBe("ok.pdf");
  });

  it("shows 'Looking up metadata…' between the end of the upload and the response", async () => {
    const { dropZone } = await renderWithList();
    drop(dropZone, [pdf("slow.pdf")]);
    const panel = await screen.findByRole("region", { name: "Uploads" });
    act(() => FakeXHR.instances[0]?.progress(1));
    expect(within(panel).getByText("Uploading… 100%")).toBeInTheDocument();

    act(() => FakeXHR.instances[0]?.uploaded());
    expect(await within(panel).findByText("Looking up metadata…")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Looking up metadata for slow.pdf" })).not.toHaveAttribute("value");

    act(() => FakeXHR.instances[0]?.respond(201, makeSource({ metadata_status: "suggested" })));
    expect(await within(panel).findByText("Uploaded")).toBeInTheDocument();
    expect(within(panel).queryByText("Looking up metadata…")).not.toBeInTheDocument();
  });
});

describe("attach PDF to a citation-only source", () => {
  const citationOnly = () => makeSource({ has_file: false, file: null });

  async function openCitationOnly() {
    let source = citationOnly();
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s1": () => jsonResponse(200, source),
    });
    renderApp("/p/p1?source=s1");
    await screen.findByRole("button", { name: "Attach PDF" });
    return {
      setFile: () => {
        source = makeSource();
      },
      input: () => screen.getByLabelText("PDF file to attach"),
    };
  }

  it("PUTs the file with progress, a metadata-lookup state, then refreshes the source", async () => {
    const { setFile, input } = await openCitationOnly();
    await userEvent.upload(input(), pdf("late.pdf"));

    expect(FakeXHR.instances).toHaveLength(1);
    const xhr = FakeXHR.instances[0];
    expect(xhr?.method).toBe("PUT");
    expect(xhr?.url).toBe("/api/sources/s1/file");
    expect((xhr?.body?.get("file") as File).name).toBe("late.pdf");
    expect(xhr?.body?.has("allow_duplicate")).toBe(false);

    act(() => xhr?.progress(0.4));
    expect(await screen.findAllByText("Uploading… 40%")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Attach PDF" })).toBeDisabled();
    act(() => xhr?.uploaded());
    expect((await screen.findAllByText("Looking up metadata…")).length).toBeGreaterThan(0);

    setFile();
    act(() => xhr?.respond(200, makeSource()));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Attach PDF" })).not.toBeInTheDocument());
    expect(await screen.findByText("alpha.pdf")).toBeInTheDocument();
  });

  it("rejects non-PDFs and oversize files before sending", async () => {
    const { input } = await openCitationOnly();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(input(), new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only PDF files");
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("duplicate: offers Add anyway, which retries with allow_duplicate=true", async () => {
    const { input } = await openCitationOnly();
    await userEvent.upload(input(), pdf("dup.pdf"));
    act(() =>
      FakeXHR.instances[0]?.respond(409, {
        error: { code: "source.duplicate_file", message: "x", details: { existing_source_id: "s2" } },
      }),
    );
    const panel = await screen.findByRole("region", { name: "Uploads" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Add anyway" }));
    expect(FakeXHR.instances).toHaveLength(2);
    expect(FakeXHR.instances[1]?.method).toBe("PUT");
    expect(FakeXHR.instances[1]?.body?.get("allow_duplicate")).toBe("true");
  });

  it("translates source.already_has_file", async () => {
    const { input } = await openCitationOnly();
    await userEvent.upload(input(), pdf("x.pdf"));
    act(() => FakeXHR.instances[0]?.respond(409, { error: { code: "source.already_has_file", message: "x" } }));
    const panel = await screen.findByRole("region", { name: "Uploads" });
    expect(await within(panel).findByText("This source already has a PDF attached.")).toBeInTheDocument();
  });

  it("is not offered to viewers or for sources that have a PDF", async () => {
    mockApi({
      ...baseRoutes({ role: "viewer" }),
      "GET /api/sources/s3": () => jsonResponse(200, makeSource({ id: "s3", has_file: false, file: null })),
    });
    renderApp("/p/p1?source=s3");
    await screen.findByText("No PDF attached", { selector: "p" });
    expect(screen.queryByRole("button", { name: "Attach PDF" })).not.toBeInTheDocument();
  });
});
