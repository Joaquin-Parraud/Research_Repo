import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, bodyOf, makeProject } from "./fixtures";
import { jsonResponse, mockApi, renderApp } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("README front page", () => {
  it("renders Markdown (GFM) and never raw HTML", async () => {
    const readme = [
      "# Research question",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- [x] done",
      "",
      "<script>window.hacked = true</script>",
      "",
      "<b id='raw'>raw bold</b>",
      "",
      "[bad](javascript:alert(1)) and [good](https://example.org)",
    ].join("\n");
    mockApi({ ...baseRoutes({ readme }) });
    const { container } = renderApp("/p/p1");

    expect(await screen.findByRole("heading", { name: "Research question" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("#raw")).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
    expect(screen.getByRole("link", { name: "good" })).toHaveAttribute("rel", "noopener noreferrer");
    const bad = container.querySelector("a[href^='javascript']");
    expect(bad).toBeNull();
  });

  it("shows a friendly empty state inviting the owner to write one", async () => {
    mockApi({ ...baseRoutes({ readme: "" }) });
    renderApp("/p/p1");
    expect(await screen.findByText("No README yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write a README" })).toBeInTheDocument();
  });

  it("edits with preview and saves with PUT", async () => {
    let saved: unknown;
    mockApi({
      ...baseRoutes({ readme: "Old text" }),
      "PUT /api/projects/p1/readme": (init) => {
        saved = bodyOf(init);
        return jsonResponse(200, { readme_md: "# New title", updated_at: "2026-02-01T00:00:00Z" });
      },
    });
    renderApp("/p/p1");

    await userEvent.click(await screen.findByRole("button", { name: "Edit README" }));
    const textarea = screen.getByLabelText("README (Markdown)");
    expect(textarea).toHaveValue("Old text");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "# New title");

    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "New title" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saved).toEqual({ readme_md: "# New title" });
    expect(await screen.findByRole("button", { name: "Edit README" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New title" })).toBeInTheDocument();
  });

  it("cancel discards the draft", async () => {
    mockApi({ ...baseRoutes({ readme: "Keep me" }) });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit README" }));
    await userEvent.type(screen.getByLabelText("README (Markdown)"), " plus");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Keep me")).toBeInTheDocument();
    expect(screen.queryByLabelText("README (Markdown)")).not.toBeInTheDocument();
  });

  it("guards unsaved changes when leaving for another project", async () => {
    mockApi({
      ...baseRoutes({ readme: "Text", projects: [makeProject(), makeProject({ id: "p2", name: "Paper B" })] }),
      "GET /api/projects/p2": () => jsonResponse(200, makeProject({ id: "p2", name: "Paper B" })),
      "GET /api/projects/p2/tree": () => jsonResponse(200, { folders: [], sources: [] }),
      "GET /api/projects/p2/readme": () => jsonResponse(200, { readme_md: "Other", updated_at: "x" }),
    });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit README" }));
    await userEvent.type(screen.getByLabelText("README (Markdown)"), " more");

    await userEvent.click(screen.getByRole("link", { name: /Paper B/ }));
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    // Stay: nothing changed.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("README (Markdown)")).toHaveValue("Text more");

    // Leave: the guard lets navigation through.
    await userEvent.click(screen.getByRole("link", { name: /Paper B/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("Other")).toBeInTheDocument();
  });

  it("does not guard when nothing changed, or when only browsing folders", async () => {
    mockApi({ ...baseRoutes({ readme: "Text" }) });
    renderApp("/p/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit README" }));
    await userEvent.click(screen.getByRole("treeitem", { name: /Theory/ }).querySelector("div") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("README (Markdown)"), " more");
    await userEvent.click(screen.getByRole("treeitem", { name: /Data/ }).querySelector("div") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("README (Markdown)")).toHaveValue("Text more");
  });
});
