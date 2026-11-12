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

export type SortKey = "title" | "added";
export type SortDirection = "asc" | "desc";

export function sortSources(
  sources: readonly SourceSummary[],
  key: SortKey,
  direction: SortDirection,
  compareText: (a: string, b: string) => number,
): SourceSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...sources].sort((a, b) => {
    const primary =
      key === "title" ? compareText(a.title, b.title) : a.created_at.localeCompare(b.created_at);
    return factor * primary || compareText(a.title, b.title) || a.id.localeCompare(b.id);
  });
}

/** Authors/year columns are only worth showing once some source has a value. */
export function hasMetadataColumns(sources: readonly SourceSummary[]): boolean {
  return sources.some((source) => Boolean(source.authors_text) || source.year !== null);
}
