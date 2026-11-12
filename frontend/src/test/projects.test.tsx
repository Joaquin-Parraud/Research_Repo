import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, bodyOf, makeProject } from "./fixtures";
import { jsonResponse, mockApi, renderApp } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("projects", () => {
  it("lists projects with their source counts and marks the selected one", async () => {
    mockApi({
      ...baseRoutes({
        projects: [makeProject(), makeProject({ id: "p2", name: "Paper B", source_count: 0 })],
      }),
    });
    renderApp("/p/p1");

    const list = await screen.findByRole("list", { name: "Projects" });
    const thesis = within(list).getByRole("link", { name: /Thesis/ });
    expect(thesis).toHaveAttribute("aria-current", "page");
    expect(within(list).getByRole("link", { name: /Paper B/ })).not.toHaveAttribute("aria-current");
    expect(within(thesis).getByLabelText("3 sources")).toBeInTheDocument();
  });

  it("shows an empty state when there are no projects", async () => {
    mockApi({ ...baseRoutes({ projects: [] }) });
    renderApp("/");
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("selecting a project opens its README front page and folder tree", async () => {
    const fetchMock = mockApi({ ...baseRoutes({ readme: "# Hello" }) });
    renderApp("/");

    await userEvent.click(await screen.findByRole("link", { name: /Thesis/ }));

    expect(await screen.findByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(await screen.findByRole("tree", { name: "Folders" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/readme", expect.anything());
  });

  it("creates a project with name and description, then opens it", async () => {
    let created: unknown;
    mockApi({
      ...baseRoutes(),
      "POST /api/projects": (init) => {
        created = bodyOf(init);
        return jsonResponse(201, makeProject());
      },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Thesis");
    await userEvent.type(within(dialog).getByLabelText("Description"), "My thesis");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(created).toEqual({ name: "Thesis", description: "My thesis" });
    expect(await screen.findByRole("tree", { name: "Folders" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes dialogs with Escape and restores focus to the opener", async () => {
    mockApi({ ...baseRoutes() });
    renderApp("/");
    const opener = await screen.findByRole("button", { name: "New project" });
    await userEvent.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("owner can change settings: citation language is saved", async () => {
    let patched: unknown;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/projects/p1": (init) => {
        patched = bodyOf(init);
        return jsonResponse(200, makeProject({ citation_locale: "es" }));
      },
    });
    renderApp("/p/p1");

    await userEvent.click(await screen.findByRole("button", { name: "Settings for Thesis" }));
    const dialog = await screen.findByRole("dialog", { name: "Project settings" });
    expect(within(dialog).getByText(/independent of the interface language/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Citation language"), "es");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(patched).toEqual({ name: "Thesis", description: "", citation_locale: "es" });
  });

  it("deleting a project requires typing its name", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      "DELETE /api/projects/p1": () => jsonResponse(204),
    });
    renderApp("/p/p1");

    await userEvent.click(await screen.findByRole("button", { name: "Settings for Thesis" }));
    const dialog = await screen.findByRole("dialog");
    const remove = within(dialog).getByRole("button", { name: "Delete project" });
    expect(remove).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type “Thesis” to confirm"), "Thesis");
    expect(remove).toBeEnabled();
    await userEvent.click(remove);

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1", expect.objectContaining({ method: "DELETE" }));
  });

  it("archives a project from settings", async () => {
    let patched: unknown;
    mockApi({
      ...baseRoutes(),
      "PATCH /api/projects/p1": (init) => {
        patched = bodyOf(init);
        return jsonResponse(200, makeProject({ archived_at: "2026-02-01T00:00:00Z" }));
      },
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Settings for Thesis" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(patched).toEqual({ archived: true });
  });

  it("requests archived projects when the toggle is on", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      "GET /api/projects?include_archived=true": () =>
        jsonResponse(200, [makeProject({ archived_at: "2026-02-01T00:00:00Z" })]),
    });
    renderApp("/");
    await userEvent.click(await screen.findByLabelText("Show archived"));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects?include_archived=true", expect.anything());
  });

  it("hides project settings from non-owners", async () => {
    mockApi({ ...baseRoutes({ role: "editor", projects: [makeProject({ role: "editor" })] }) });
    renderApp("/p/p1");
    await screen.findByRole("tree", { name: "Folders" });
    expect(screen.queryByRole("button", { name: /Settings for/ })).not.toBeInTheDocument();
  });
});
