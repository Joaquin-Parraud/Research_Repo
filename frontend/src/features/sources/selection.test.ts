import { describe, expect, it } from "vitest";
import { makeSummary } from "../../test/fixtures";
import { applySelection, hasMetadataColumns, rangeIds, sortSources } from "./selection";

const ids = ["a", "b", "c", "d", "e"];

describe("selection", () => {
  it("computes inclusive ranges in either direction", () => {
    expect(rangeIds(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(ids, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(ids, null, "c")).toEqual(["c"]);
  });

  it("toggles one id and moves the anchor", () => {
    const first = applySelection({ selected: new Set(), anchor: null }, ids, "b", "toggle");
    expect([...first.selected]).toEqual(["b"]);
    expect(first.anchor).toBe("b");
    const second = applySelection(first, ids, "b", "toggle");
    expect(second.selected.size).toBe(0);
  });

  it("shift-select adds the range from the anchor and keeps the anchor", () => {
    const start = applySelection({ selected: new Set(), anchor: null }, ids, "b", "toggle");
    const ranged = applySelection(start, ids, "d", "range");
    expect([...ranged.selected].sort()).toEqual(["b", "c", "d"]);
    expect(ranged.anchor).toBe("b");
  });
});

describe("sorting and columns", () => {
  const sources = [
    makeSummary("1", "banana 10", null, { created_at: "2026-01-02T00:00:00Z" }),
    makeSummary("2", "Banana 2", null, { created_at: "2026-01-03T00:00:00Z" }),
    makeSummary("3", "apple", null, { created_at: "2026-01-01T00:00:00Z" }),
  ];
  const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

  it("sorts by title (natural, case-insensitive) in both directions", () => {
    expect(sortSources(sources, "title", "asc", compare).map((s) => s.id)).toEqual(["3", "2", "1"]);
    expect(sortSources(sources, "title", "desc", compare).map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts by date added", () => {
    expect(sortSources(sources, "added", "asc", compare).map((s) => s.id)).toEqual(["3", "1", "2"]);
    expect(sortSources(sources, "added", "desc", compare).map((s) => s.id)).toEqual(["2", "1", "3"]);
  });

  it("shows authors/year columns only when some source has a value", () => {
    expect(hasMetadataColumns(sources)).toBe(false);
    expect(hasMetadataColumns([...sources, makeSummary("4", "x", null, { year: 2020 })])).toBe(true);
    expect(hasMetadataColumns([makeSummary("5", "x", null, { authors_text: "Ng" })])).toBe(true);
  });
});
