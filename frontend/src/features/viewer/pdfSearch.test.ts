import { describe, expect, it } from "vitest";
import { findMatches, locateMatch, matchPieces, totalMatches } from "./pdfSearch";

describe("findMatches", () => {
  it("is case- and accent-insensitive and reports original offsets", () => {
    const items = ["La Educación ", "es clave. EDUCACION."];
    const matches = findMatches(items, "educacion");
    expect(matches).toHaveLength(2);
    const text = items.join("");
    expect(text.slice(matches[0]?.start, matches[0]?.end)).toBe("Educación");
    expect(text.slice(matches[1]?.start, matches[1]?.end)).toBe("EDUCACION");
  });

  it("matches phrases across items and lines even without a space between them", () => {
    const items = ["machine", "learning is fun"];
    const [match] = findMatches(items, "machine learning");
    expect(match).toEqual({ start: 0, end: "machinelearning".length });
    expect(matchPieces(items, [match ?? { start: 0, end: 0 }])).toEqual([
      { item: 0, from: 0, to: 7, matchIndex: 0 },
      { item: 1, from: 0, to: 8, matchIndex: 0 },
    ]);
  });

  it("treats regex characters in the query literally", () => {
    expect(findMatches(["a.b a+b (x)"], "a.b")).toHaveLength(1);
    expect(findMatches(["a+b"], "a+b")).toHaveLength(1);
    expect(findMatches(["(x)"], "(x)")).toHaveLength(1);
  });

  it("returns nothing for blank queries or no match", () => {
    expect(findMatches(["abc"], "   ")).toEqual([]);
    expect(findMatches(["abc"], "zzz")).toEqual([]);
  });

  it("does not overlap matches", () => {
    expect(findMatches(["aaaa"], "aa")).toHaveLength(2);
  });
});

describe("locateMatch", () => {
  const counts = new Map([
    [2, 3],
    [5, 1],
  ]);

  it("maps a global index to page and index within the page", () => {
    expect(locateMatch(counts, 6, 0)).toEqual({ page: 2, indexInPage: 0 });
    expect(locateMatch(counts, 6, 2)).toEqual({ page: 2, indexInPage: 2 });
    expect(locateMatch(counts, 6, 3)).toEqual({ page: 5, indexInPage: 0 });
    expect(locateMatch(counts, 6, 4)).toBeNull();
    expect(totalMatches(counts)).toBe(4);
  });
});
