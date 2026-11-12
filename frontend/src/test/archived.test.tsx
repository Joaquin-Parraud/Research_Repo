import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccess } from "../api/projects";
import { baseRoutes, bodyOf, makeProject, makeSource, sampleTree } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => undefined)) }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const archived = (role: "owner" | "editor" | "viewer") =>
  makeProject({ role, archived_at: "2026-05-01T00:00:00Z" });

function setup(role: "owner" | "editor" | "viewer", extra: Parameters<typeof mockApi>[0] = {}) {
  const project = archived(role);
  return mockApi({
    ...baseRoutes({ project, projects: [project] }),
    "GET /api/projects?include_archived=false": () => jsonResponse(200, [project]),
    ...extra,
  });
}

describe("projectAccess", () => {
  it("derives one canWrite from role AND not archived", () => {
    const active = { archived_at: null };
    const arch = { archived_at: "x" };
    expect(projectAccess({ role: "owner", ...active }).canWrite).toBe(true);
    expect(projectAccess({ role: "editor", ...active }).canWrite).toBe(true);
    expect(projectAccess({ role: "viewer", ...active }).canWrite).toBe(false);
    for (const role of ["owner", "editor", "viewer"] as const) {
      expect(projectAccess({ role, ...arch }).canWrite).toBe(false);
    }
  });

  it("keeps reading position, copy and owner actions available while archived", () => {
    const owner = projectAccess({ role: "owner", archived_at: "x" });
    expect(owner).toMatchObject({ canSaveProgress: true, canCopy: true, canManage: true, archived: true });
    const editor = projectAccess({ role: "editor", archived_at: "x" });
    expect(editor).toMatchObject({ canSaveProgress: true, canCopy: true, canManage: false });
    const viewer = projectAccess({ role: "viewer", archived_at: "x" });
    expect(viewer).toMatchObject({ canSaveProgress: false, canCopy: false });
  });
});

describe("archived project", () => {
  it("shows the banner and hides every write affordance, like for a viewer", async () => {
    setup("owner", {
      "GET /api/sources/s3": () =>
        jsonResponse(200, makeSource({ id: "s3", title: "Gamma report", has_file: false, file: null, metadata_status: "pending", tags: ["policy"] })),
    });
    renderApp("/p/p1");
    const banner = await screen.findByRole("region", { name: "Archived project" });
    expect(within(banner).getByText("This project is archived and read-only.")).toBeInTheDocument();
    await screen.findByRole("list", { name: "Sources in this folder" });

    expect(screen.queryByRole("button", { name: "Add source" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Folder actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit README" })).not.toBeInTheDocument();

    // Reading, citing and exporting stay.
    expect(screen.getByRole("button", { name: "Export bibliography" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export project bibliography" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gamma report citation only" }));
    expect(await screen.findByText("policy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit metadata" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach PDF" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a tag")).not.toBeInTheDocument();
  });

  it("selection checkboxes only offer export, not move or delete", async () => {
    setup("editor");
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Alpha paper”" }));
    const bulk = screen.getByRole("group", { name: "Actions for selected sources" });
    expect(within(bulk).getByRole("button", { name: "Export selected" })).toBeInTheDocument();
    expect(within(bulk).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("owners can unarchive: PATCH with only archived:false, then the banner goes", async () => {
    let project = archived("owner");
    let body: unknown;
    setup("owner", {
      "GET /api/projects/p1": () => jsonResponse(200, project),
      "PATCH /api/projects/p1": (init) => {
        body = bodyOf(init);
        project = { ...project, archived_at: null };
        return jsonResponse(200, project);
      },
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Unarchive" }));
    expect(body).toEqual({ archived: false });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Archived project" })).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("editors get Copy but not Unarchive; viewers get neither", async () => {
    setup("editor");
    renderApp("/p/p1");
    const banner = await screen.findByRole("region", { name: "Archived project" });
    expect(within(banner).queryByRole("button", { name: "Unarchive" })).not.toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Copy to a new project" })).toBeInTheDocument();
  });

  it("viewers only see the notice", async () => {
    setup("viewer");
    renderApp("/p/p1");
    const banner = await screen.findByRole("region", { name: "Archived project" });
    expect(within(banner).queryByRole("button")).not.toBeInTheDocument();
  });

  it("copy: asks for a name prefilled with '<name> (copy)', posts it and opens the new project", async () => {
    let body: unknown;
    const copy = makeProject({ id: "p2", name: "Thesis (my copy)", role: "owner" });
    setup("editor", {
      "POST /api/projects/p1/copy": (init) => {
        body = bodyOf(init);
        return jsonResponse(201, copy);
      },
      "GET /api/projects/p2": () => jsonResponse(200, copy),
      "GET /api/projects/p2/tree": () => jsonResponse(200, { folders: [], sources: [] }),
      "GET /api/projects/p2/readme": () => jsonResponse(200, { readme_md: "# Copied README", updated_at: "x" }),
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Copy to a new project" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy to a new project" });
    const name = within(dialog).getByLabelText("Name of the new project");
    expect(name).toHaveValue("Thesis (copy)");
    await userEvent.clear(name);
    await userEvent.type(name, "Thesis (my copy)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create copy" }));

    expect(body).toEqual({ name: "Thesis (my copy)" });
    expect(await screen.findByRole("heading", { name: "Copied README" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Archived project" })).not.toBeInTheDocument();
  });

  it("copy is also in project settings (owner), where an archived project's details are not editable", async () => {
    let body: unknown;
    const copy = makeProject({ id: "p2", name: "Thesis (copy)" });
    setup("owner", {
      "POST /api/projects/p1/copy": (init) => {
        body = bodyOf(init);
        return jsonResponse(201, copy);
      },
      "GET /api/projects/p2": () => jsonResponse(200, copy),
      "GET /api/projects/p2/tree": () => jsonResponse(200, { folders: [], sources: [] }),
      "GET /api/projects/p2/readme": () => jsonResponse(200, { readme_md: "", updated_at: "x" }),
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Settings for Thesis" }));
    const settings = await screen.findByRole("dialog", { name: "Project settings" });
    expect(within(settings).queryByLabelText("Name")).not.toBeInTheDocument();
    await userEvent.click(within(settings).getByRole("button", { name: "Copy to a new project" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy to a new project" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create copy" }));
    await waitFor(() => expect(body).toEqual({ name: "Thesis (copy)" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("stray 409 project.archived", () => {
  it("shows a translated toast and refetches the project, which brings up the banner", async () => {
    let project = makeProject({ role: "owner" });
    let projectFetches = 0;
    const tree = sampleTree();
    mockApi({
      ...baseRoutes({ tree }),
      "GET /api/projects/p1": () => {
        projectFetches += 1;
        return jsonResponse(200, project);
      },
      "POST /api/sources/move": () => {
        project = { ...project, archived_at: "2026-05-01T00:00:00Z" }; // archived in another tab
        return errorResponse(409, "project.archived");
      },
    });
    renderApp("/p/p1");
    await screen.findByRole("list", { name: "Sources in this folder" });
    const before = projectFetches;

    await userEvent.click(screen.getByRole("button", { name: "Move “Alpha paper” to…" }));
    const picker = await screen.findByRole("dialog");
    await userEvent.click(within(picker).getByRole("radio", { name: "Data" }));
    await userEvent.click(within(picker).getByRole("button", { name: "Move" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toContain("This project is archived and read-only.×");
    expect(alerts.filter((a) => a.textContent?.startsWith("This project is archived"))).toHaveLength(1);
    await waitFor(() => expect(projectFetches).toBeGreaterThan(before));
    expect(await screen.findByRole("region", { name: "Archived project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add source" })).not.toBeInTheDocument();
  });
});
