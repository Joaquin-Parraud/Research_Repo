import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replacesReadme } from "../hooks/useAppNavigation";
import { baseRoutes, bodyOf, makeFolder } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const row = (name: RegExp | string) => screen.getByRole("treeitem", { name });

describe("folder tree", () => {
  it("renders nested folders with ARIA tree roles, levels and source counts", async () => {
    localStorage.setItem("rr.expanded.p1", JSON.stringify(["f1"]));
    mockApi({ ...baseRoutes() });
    renderApp("/p/p1");

    const tree = await screen.findByRole("tree", { name: "Folders" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "2"]);
    expect(row("Project root")).toHaveAttribute("aria-selected", "true");
    expect(row(/Theory/)).toHaveAttribute("aria-expanded", "true");
    expect(within(row("Project root")).getByLabelText("2 sources")).toBeInTheDocument();
    expect(within(row(/Method/)).getByLabelText("1 source")).toBeInTheDocument();
    expect(within(row(/Data/)).getByLabelText("0 sources")).toBeInTheDocument();
  });

  it("expands and collapses with the keyboard and remembers it per project", async () => {
    mockApi({ ...baseRoutes() });
    renderApp("/p/p1");
    await screen.findByRole("tree");
    expect(screen.queryByRole("treeitem", { name: /Method/ })).not.toBeInTheDocument();

    row(/Theory/).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: /Method/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("rr.expanded.p1") ?? "[]")).toContain("f1");

    await userEvent.keyboard("{ArrowDown}");
    expect(row(/Method/)).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(row(/Theory/)).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: /Method/ })).not.toBeInTheDocument();
  });

  it("selecting a folder lists only its direct sources", async () => {
    mockApi({ ...baseRoutes() });
    renderApp("/p/p1");
    await screen.findByRole("tree");
    expect(screen.getByRole("button", { name: "Alpha paper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Beta study" })).not.toBeInTheDocument();

    await userEvent.click(row(/Theory/).querySelector("div") as HTMLElement);
    expect(await screen.findByRole("button", { name: "Beta study" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alpha paper" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delta notes" })).not.toBeInTheDocument();
  });

  it("creates a folder under the selected folder with an inline input", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes(),
      "POST /api/projects/p1/folders": (init) => {
        body = bodyOf(init);
        return jsonResponse(201, makeFolder("f9", "Results", "f1", 1));
      },
    });
    renderApp("/p/p1/f/f1");
    await screen.findByRole("tree");

    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Results{Enter}");

    expect(body).toEqual({ name: "Results", parent_id: "f1" });
  });

  it("creates a root folder when the root is selected", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes(),
      "POST /api/projects/p1/folders": (init) => {
        body = bodyOf(init);
        return jsonResponse(201, makeFolder("f9", "Top", null, 2));
      },
    });
    renderApp("/p/p1");
    await screen.findByRole("tree");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Top{Enter}");
    expect(body).toEqual({ name: "Top", parent_id: null });
  });

  it("shows a translated inline error for a name conflict and keeps the input", async () => {
    mockApi({
      ...baseRoutes(),
      "POST /api/projects/p1/folders": () => errorResponse(409, "folder.name_conflict"),
    });
    renderApp("/p/p1");
    await screen.findByRole("tree");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Theory{Enter}");

    expect(await screen.findByText("A folder with that name already exists here.")).toBeInTheDocument();
    expect(screen.getByLabelText("New folder name")).toBeInTheDocument();
  });

  it("renames inline and cancels with Escape", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/folders/f3": (init) => {
        body = bodyOf(init);
        return jsonResponse(200, makeFolder("f3", "Datasets", null, 1));
      },
    });
    renderApp("/p/p1/f/f3");
    await screen.findByRole("tree");

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Folder name");
    expect(input).toHaveValue("Data");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Folder name")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.keyboard("{Control>}a{/Control}Datasets{Enter}");
    expect(body).toEqual({ name: "Datasets" });
  });

  it("delete confirm explains the contents move up, then deletes", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      "DELETE /api/folders/f1": () => jsonResponse(204),
    });
    renderApp("/p/p1/f/f1");
    await screen.findByRole("tree");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Theory”?" });
    expect(dialog).toHaveTextContent(
      "Its contents (1 source, 1 subfolder) will move up to “Project root”. No sources are deleted.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete folder" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/folders/f1", expect.objectContaining({ method: "DELETE" }));
    // The deleted folder was selected, so we land on its parent (the root).
    await vi.waitFor(() =>
      expect(screen.getByRole("treeitem", { name: "Project root" })).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("moves a folder with the Move to… dialog (keyboard alternative to drag and drop)", async () => {
    let body: unknown;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/folders/f3": (init) => {
        body = bodyOf(init);
        return jsonResponse(200, makeFolder("f3", "Data", "f2", 0));
      },
    });
    renderApp("/p/p1/f/f3");
    await screen.findByRole("tree");

    await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move “Data” to…" });
    // The folder's current location (root) cannot be chosen again.
    expect(within(dialog).getByRole("radio", { name: /Project root/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Method" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(body).toEqual({ parent_id: "f2" });
  });

  it("does not offer a folder itself or its descendants as move targets", async () => {
    mockApi({ ...baseRoutes() });
    renderApp("/p/p1/f/f1");
    await screen.findByRole("tree");
    await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Theory" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Method" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Data" })).toBeEnabled();
  });

  it("rolls back an optimistic folder move and shows a translated error when the server refuses", async () => {
    let moveCalls = 0;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/folders/f3": () => {
        moveCalls += 1;
        return errorResponse(409, "folder.cycle");
      },
    });
    renderApp("/p/p1/f/f3");
    await screen.findByRole("tree");
    await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Theory" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A folder cannot be moved into itself or one of its subfolders.",
    );
    expect(moveCalls).toBe(1);
    // Rolled back: Data is still a root-level (level 2) item.
    expect(row(/Data/)).toHaveAttribute("aria-level", "2");
  });

  it("applies the move optimistically before the server answers", async () => {
    let release: () => void = () => undefined;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/folders/f3": () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(200, makeFolder("f3", "Data", "f1", 1)));
        }),
    });
    renderApp("/p/p1/f/f3");
    await screen.findByRole("tree");
    await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Theory" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    // Data is re-parented in the UI immediately (now one level deeper), before the request resolves.
    await vi.waitFor(() => expect(row(/Data/)).toHaveAttribute("aria-level", "3"));
    release();
  });
});

describe("replacesReadme", () => {
  it("is true only when the right pane would change", () => {
    expect(replacesReadme("/p/p1", "", "/p/p1/f/f2")).toBe(false);
    expect(replacesReadme("/p/p1", "", "/p/p2")).toBe(true);
    expect(replacesReadme("/p/p1", "", "/")).toBe(true);
    expect(replacesReadme("/p/p1", "", "/p/p1?source=s1")).toBe(true);
    expect(replacesReadme("/p/p1", "?source=s1", "/p/p1/f/f2?source=s1")).toBe(false);
  });
});

