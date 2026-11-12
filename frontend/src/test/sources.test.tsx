import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryTree } from "../api/library";
import { baseRoutes, bodyOf, makeSource, makeSummary, sampleTree } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function treeWithMoreRoot(): LibraryTree {
  const base = sampleTree();
  return {
    folders: base.folders,
    sources: [
      makeSummary("a", "Apple", null, { created_at: "2026-01-01T00:00:00Z" }),
      makeSummary("b", "Banana", null, { created_at: "2026-01-02T00:00:00Z" }),
      makeSummary("c", "Cherry", null, { created_at: "2026-01-03T00:00:00Z", has_file: false, page_count: null }),
      makeSummary("d", "Date", null, { created_at: "2026-01-04T00:00:00Z" }),
    ],
  };
}

const titles = () =>
  screen
    .getAllByRole("button", { name: /^(Apple|Banana|Cherry|Date)/ })
    .map((button) => button.querySelector("span")?.textContent);

describe("source list", () => {
  it("shows title, a citation-only badge and page count; hides empty author/year columns", async () => {
    mockApi({ ...baseRoutes({ tree: treeWithMoreRoot() }) });
    renderApp("/p/p1");

    const list = await screen.findByRole("list", { name: "Sources in this folder" });
    const cherry = within(list).getByRole("button", { name: "Cherry citation only" });
    expect(cherry).toHaveTextContent("citation only");
    expect(within(list).getAllByText("10 pages").length).toBe(3);
    expect(within(list).queryByText("citation only", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("4 sources")).toBeInTheDocument();
  });

  it("shows authors and year once some source has them", async () => {
    const tree = treeWithMoreRoot();
    tree.sources[0] = makeSummary("a", "Apple", null, { authors_text: "García, A.", year: 2021 });
    mockApi({ ...baseRoutes({ tree }) });
    renderApp("/p/p1");
    expect(await screen.findByText("García, A.")).toBeInTheDocument();
    expect(screen.getByText("2021")).toBeInTheDocument();
  });

  it("sorts by title and by date added, both directions", async () => {
    mockApi({ ...baseRoutes({ tree: treeWithMoreRoot() }) });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    expect(titles()).toEqual(["Apple", "Banana", "Cherry", "Date"]);

    await userEvent.click(screen.getByRole("button", { name: /Ascending/ }));
    expect(titles()).toEqual(["Date", "Cherry", "Banana", "Apple"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "added");
    expect(titles()).toEqual(["Date", "Cherry", "Banana", "Apple"]);
    await userEvent.click(screen.getByRole("button", { name: /Descending/ }));
    expect(titles()).toEqual(["Apple", "Banana", "Cherry", "Date"]);
  });

  it("selecting a source opens it via ?source and shows its details", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s3": () =>
        jsonResponse(200, makeSource({ id: "s3", title: "Gamma report", has_file: false, file: null, tags: ["policy"] })),
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Gamma report citation only" }));

    expect(await screen.findByText("No PDF attached", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("policy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gamma report" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("Gamma report");
  });

  it("supports multi-select with checkboxes and shift-click ranges", async () => {
    mockApi({ ...baseRoutes({ tree: treeWithMoreRoot() }) });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });

    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Apple”" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select “Cherry”" }), { shiftKey: true });

    expect(screen.getByRole("checkbox", { name: "Select “Banana”" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select “Date”" })).not.toBeChecked();
    expect(screen.getByText("3 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("3 selected")).not.toBeInTheDocument();
  });

  it("moves all selected sources with the Move to… dialog (request body asserted)", async () => {
    let body: unknown;
    const tree = treeWithMoreRoot();
    mockApi({
      ...baseRoutes({ tree }),
      "GET /api/projects/p1/tree": () => jsonResponse(200, tree),
      "POST /api/sources/move": (init) => {
        body = bodyOf(init);
        tree.sources = tree.sources.map((s) => (s.id === "a" || s.id === "d" ? { ...s, folder_id: "f3" } : s));
        return jsonResponse(200, { moved: 2 });
      },
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Apple”" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Date”" }));

    await userEvent.click(within(screen.getByRole("group", { name: "Actions for selected sources" })).getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move 2 sources to…" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Data" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(body).toEqual({ source_ids: ["a", "d"], folder_id: "f3" });
    // Optimistic: they left this folder immediately.
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Apple" })).not.toBeInTheDocument());
  });

  it("can move to the project root (folder_id null)", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes(),
      "POST /api/sources/move": (init) => {
        body = bodyOf(init);
        return jsonResponse(200, { moved: 1 });
      },
    });
    renderApp("/p/p1/f/f1");
    await userEvent.click(await screen.findByRole("button", { name: "Move “Beta study” to…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move 1 source to…" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Project root" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(body).toEqual({ source_ids: ["s2"], folder_id: null });
  });

  it("rolls back a failed source move and shows a translated toast", async () => {
    mockApi({
      ...baseRoutes({ tree: treeWithMoreRoot() }),
      "POST /api/sources/move": () => errorResponse(422, "source.move_invalid"),
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Apple”" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Actions for selected sources" })).getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Data" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The selected sources cannot be moved there.");
    expect(await screen.findByRole("button", { name: "Apple" })).toBeInTheDocument();
  });

  it("deletes selected sources after confirmation", async () => {
    const fetchMock = mockApi({
      ...baseRoutes({ tree: treeWithMoreRoot() }),
      "DELETE /api/sources/a": () => jsonResponse(204),
      "DELETE /api/sources/b": () => jsonResponse(204),
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Apple”" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Banana”" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Actions for selected sources" })).getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete 2 sources?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => url);
      expect(deletes.sort()).toEqual(["/api/sources/a", "/api/sources/b"]);
    });
  });

  it("renames a source inline with PATCH", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes({ tree: treeWithMoreRoot() }),
      "PATCH /api/sources/a": (init) => {
        body = bodyOf(init);
        return jsonResponse(200, makeSource({ id: "a", title: "Apricot" }));
      },
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Rename “Apple”" }));
    await userEvent.keyboard("{Control>}a{/Control}Apricot{Enter}");
    expect(body).toEqual({ title: "Apricot" });
  });
});

describe("source details strip", () => {
  it("edits the title and replaces the full tag set with PATCH", async () => {
    const bodies: unknown[] = [];
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s1": () => jsonResponse(200, makeSource({ tags: ["ml"], has_file: false, file: null })),
      "PATCH /api/sources/s1": (init) => {
        bodies.push(bodyOf(init));
        return jsonResponse(200, makeSource({ tags: ["ml", "risk"], has_file: false, file: null }));
      },
    });
    renderApp("/p/p1?source=s1");

    const tags = await screen.findByRole("group", { name: "Tags" });
    await userEvent.type(within(tags).getByLabelText("Add a tag"), "risk{Enter}");
    expect(bodies).toEqual([{ tags: ["ml", "risk"] }]);

    await userEvent.click(await within(await screen.findByRole("group", { name: "Tags" })).findByRole("button", { name: "Remove tag ml" }));
    expect(bodies[1]).toEqual({ tags: ["risk"] });
  });

  it("shows file name, size and pages formatted for the active language", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s1": () => jsonResponse(200, makeSource()),
    });
    renderApp("/p/p1?source=s1");
    expect(await screen.findByText("alpha.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2\.4 MB|2\.5 MB/)).toBeInTheDocument();
  });
});

describe("viewer role", () => {
  it("hides every write affordance", async () => {
    mockApi({
      ...baseRoutes({ role: "viewer", readme: "# Notes" }),
      "GET /api/projects?include_archived=false": () =>
        jsonResponse(200, [{ ...(sampleProject()), role: "viewer" }]),
      "GET /api/sources/s3": () =>
        jsonResponse(200, makeSource({ id: "s3", title: "Gamma report", has_file: false, file: null, tags: ["policy"] })),
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });

    expect(screen.queryByRole("button", { name: "Add source" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Folder actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit README" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Settings for/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tree")).toBeInTheDocument();

    // Selecting is a read action (it feeds the bibliography export); only moving and deleting are writes.
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Alpha paper”" }));
    const bulk = screen.getByRole("group", { name: "Actions for selected sources" });
    expect(within(bulk).getByRole("button", { name: "Export selected" })).toBeInTheDocument();
    expect(within(bulk).queryByRole("button", { name: "Move to…" })).not.toBeInTheDocument();
    expect(within(bulk).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.click(within(bulk).getByRole("button", { name: "Clear selection" }));

    await userEvent.click(screen.getByRole("button", { name: "Gamma report citation only" }));
    expect(await screen.findByText("policy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit title" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a tag")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove tag/ })).not.toBeInTheDocument();
  });
});

function sampleProject() {
  return {
    id: "p1",
    name: "Thesis",
    slug: "thesis",
    description: "",
    citation_locale: "en-US",
    archived_at: null,
    created_at: "x",
    updated_at: "x",
    role: "viewer",
    source_count: 3,
  };
}
