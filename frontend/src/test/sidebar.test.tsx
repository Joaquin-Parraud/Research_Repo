import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_STORAGE_KEY } from "../hooks/useSidebar";
import { baseRoutes, makeProject } from "./fixtures";
import { mockApi, renderApp } from "./helpers";

const toggleName = "Toggle project sidebar";

function stubNarrow(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("project sidebar", () => {
  it("is open by default and the toggle exposes aria-expanded / aria-controls", async () => {
    mockApi(baseRoutes());
    renderApp("/");
    const toggle = await screen.findByRole("button", { name: toggleName });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(controlled).toBeVisible();
    expect(await screen.findByRole("link", { name: /Thesis/ })).toBeVisible();
  });

  it("collapses and expands, remembering the choice", async () => {
    mockApi(baseRoutes());
    const first = renderApp("/");
    const toggle = await screen.findByRole("button", { name: toggleName });
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("project-sidebar")).not.toBeVisible();
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");

    first.unmount();
    renderApp("/");
    const again = await screen.findByRole("button", { name: toggleName });
    expect(again).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(again);
    expect(again).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
  });

  it("still works when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mockApi(baseRoutes());
    renderApp("/");
    const toggle = await screen.findByRole("button", { name: toggleName });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("selecting a project opens it and keeps the sidebar open on wide screens", async () => {
    mockApi(baseRoutes({ projects: [makeProject(), makeProject({ id: "p2", name: "Paper B" })] }));
    renderApp("/");
    await userEvent.click(await screen.findByRole("link", { name: /Thesis/ }));
    expect(await screen.findByRole("tree", { name: "Folders" })).toBeInTheDocument();
    const sidebar = document.getElementById("project-sidebar") as HTMLElement;
    expect(sidebar).toBeVisible();
    expect(within(sidebar).getByRole("link", { name: /Thesis/ })).toHaveAttribute("aria-current", "page");
  });

  it("on narrow screens starts closed, closes on project choice, Escape and backdrop click", async () => {
    stubNarrow(true);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
    mockApi(baseRoutes());
    renderApp("/");
    const toggle = await screen.findByRole("button", { name: toggleName });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(await screen.findByRole("link", { name: /Thesis/ }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    await userEvent.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId("sidebar-backdrop"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Overlay state is never persisted.
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
  });
});
