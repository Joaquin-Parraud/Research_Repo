import { needsReview } from "../../api/csl";
import type { SourceSummary } from "../../api/library";

/** Ids between two ids (inclusive) in list order. Falls back to just the target. */
export function rangeIds(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const to = orderedIds.indexOf(targetId);
  const from = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (to === -1) return [];
  if (from === -1) return [targetId];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return orderedIds.slice(start, end + 1);
}

export interface SelectionState {
  selected: ReadonlySet<string>;
  anchor: string | null;
}

/** Checkbox / ctrl-click toggles one id; shift-click selects the range from the anchor. */
export function applySelection(
  state: SelectionState,
  orderedIds: readonly string[],
  id: string,
  mode: "toggle" | "range",
): SelectionState {
  const next = new Set(state.selected);
  if (mode === "range" && state.anchor !== null) {
    for (const rangeId of rangeIds(orderedIds, state.anchor, id)) next.add(rangeId);
    return { selected: next, anchor: state.anchor };
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { selected: next, anchor: id };
}

export type SortKey = "title" | "authors" | "year" | "added";
export type SortDirection = "asc" | "desc";

/** Sources still waiting for their metadata to be completed or confirmed. */
export function filterNeedsReview(sources: readonly SourceSummary[]): SourceSummary[] {
  return sources.filter((source) => needsReview(source.metadata_status));
}

/** Empty values always sort last, in either direction: an unknown author or year is never "the first". */
function compareOptional<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number, factor: number): number {
  const aEmpty = a === null || a === "";
  const bEmpty = b === null || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  return factor * compare(a, b);
}

export function sortSources(
  sources: readonly SourceSummary[],
  key: SortKey,
  direction: SortDirection,
  compareText: (a: string, b: string) => number,
): SourceSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  const primary = (a: SourceSummary, b: SourceSummary): number => {
    switch (key) {
      case "title":
        return factor * compareText(a.title, b.title);
      case "authors":
        return compareOptional(a.authors_text, b.authors_text, compareText, factor);
      case "year":
        return compareOptional(a.year, b.year, (x, y) => x - y, factor);
      case "added":
        return factor * a.created_at.localeCompare(b.created_at);
    }
  };
  return [...sources].sort(
    (a, b) => primary(a, b) || compareText(a.title, b.title) || a.id.localeCompare(b.id),
  );
}

/** Authors/year columns are only worth showing once some source has a value. */
export function hasMetadataColumns(sources: readonly SourceSummary[]): boolean {
  return sources.some((source) => Boolean(source.authors_text) || source.year !== null);
}
