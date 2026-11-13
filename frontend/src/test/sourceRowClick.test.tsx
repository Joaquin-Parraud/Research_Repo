import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAG_ACTIVATION_DISTANCE } from "../features/folders/LibraryDnd";
import { baseRoutes, makeCitation, makeSource, makeSummary, sampleTree } from "./fixtures";
import { jsonResponse, mockApi, renderApp } from "./helpers";

// SourceList.module.css is loaded for real in tests (see `test.css` in vite.config.ts),
// so the computed styles below are the shipped ones.

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** A freshly uploaded source: pending-metadata badge, authors, year and pages all shown. */
function treeWithNewUpload() {
  const base = sampleTree();
  return {
    folders: base.folders,
    sources: [
      ...base.sources,
      makeSummary("s9", "Freshly uploaded paper", null, {
        metadata_status: "pending",
        authors_text: "Doe, J.; Roe, R.",
        year: 2024,
        page_count: 120,
      }),
    ],
  };
}

async function renderNewUpload() {
  mockApi({
    ...baseRoutes({ tree: treeWithNewUpload() }),
    "GET /api/sources/s9": () => jsonResponse(200, makeSource({ id: "s9", title: "Freshly uploaded paper" })),
    "GET /api/sources/s9/citation": () => jsonResponse(200, makeCitation()),
  });
  renderApp("/p/p1");
  const list = await screen.findByRole("list", { name: "Sources in this folder" });
  const title = within(list).getByRole("button", { name: "Freshly uploaded paper" });
  const row = title.closest("li");
  if (!row) throw new Error("title outside a row");
  return { list, title, row };
}

describe("source row click target", () => {
  it("clicking the title of a newly added source (badge + metadata columns) opens it", async () => {
    const { list, title } = await renderNewUpload();
    // The badge and metadata sit beside the title button, not inside it.
    expect(title).not.toHaveTextContent("Needs metadata");

    await userEvent.click(title);

    expect(await screen.findByRole("heading", { name: "Freshly uploaded paper" })).toBeInTheDocument();
    expect(within(list).getByRole("listitem", { current: true })).toHaveTextContent("Freshly uploaded paper");
  });

  it("drag needs a movement threshold, so a press without movement stays a click", () => {
    expect(DRAG_ACTIVATION_DISTANCE).toBeGreaterThanOrEqual(3);
  });
});

// jsdom does no layout, so these pin the styles that keep the title clickable. Regression:
// the title was the only shrinkable item of a no-wrap flex row, and the status badge,
// metadata columns and invisible row actions squeezed it to 0px: nothing left to click.
describe("source row layout", () => {
  it("the title button keeps a minimum width and the row wraps its metadata instead", async () => {
    const { title, row } = await renderNewUpload();

    expect(getComputedStyle(row).flexWrap).toBe("wrap");
    const titleStyle = getComputedStyle(title);
    expect(titleStyle.minWidth).not.toMatch(/^(0|0px|auto|)$/);
    expect(titleStyle.flexBasis).not.toMatch(/^(0|0px|0%|auto|)$/);
    const authors = within(row).getByText("Doe, J.; Roe, R.");
    expect(getComputedStyle(authors).flexShrink).not.toBe("0");
  });

  it("the hidden row actions sit out of the flow, so they take no width from the title", async () => {
    const { title, row } = await renderNewUpload();
    const rename = within(row).getByRole("button", { name: "Rename “Freshly uploaded paper”" });
    const actions = rename.parentElement;
    if (!actions) throw new Error("rename outside the actions group");

    expect(getComputedStyle(row).position).toBe("relative");
    expect(getComputedStyle(actions).position).toBe("absolute");
    expect(title).not.toContainElement(actions);
  });
});
