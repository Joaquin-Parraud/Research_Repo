import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findMatches, locateMatch, totalMatches, type MatchLocation } from "./pdfSearch";

export interface PdfSearch {
  total: number;
  /** 0-based index of the current match, or null when there is none. */
  current: number | null;
  location: MatchLocation | null;
  searching: boolean;
  next: () => void;
  previous: () => void;
}

interface SearchState {
  key: string;
  counts: ReadonlyMap<number, number>;
  done: boolean;
  current: number | null;
}

const EMPTY: ReadonlyMap<number, number> = new Map();

/**
 * In-document search: scans every page's text (progressively, cancellable) and counts
 * matches per page; the viewer highlights matches in the pages it renders.
 */
export function usePdfSearch(doc: PDFDocumentProxy | null, query: string): PdfSearch {
  const trimmed = query.trim();
  const key = `${doc ? doc.numPages : 0}:${trimmed}`;
  const [state, setState] = useState<SearchState>({ key: "", counts: EMPTY, done: true, current: null });

  useEffect(() => {
    if (!doc || !trimmed) return;
    let cancelled = false;
    const counts = new Map<number, number>();

    void (async () => {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent();
          page.cleanup();
          const items = content.items.flatMap((item) => ("str" in item ? [item.str] : []));
          const found = findMatches(items, trimmed).length;
          if (found > 0) counts.set(pageNumber, found);
        } catch {
          // A page that cannot be read simply has no matches.
        }
        if (cancelled) return;
        if (pageNumber === 1 || pageNumber % 5 === 0 || pageNumber === doc.numPages) {
          const snapshot = new Map(counts);
          setState((previous) => ({
            key,
            counts: snapshot,
            done: pageNumber === doc.numPages,
            current: previous.current ?? (totalMatches(snapshot) > 0 ? 0 : null),
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, trimmed, key]);

  const active = trimmed && state.key === key ? state : null;
  const counts = active?.counts ?? EMPTY;
  const total = totalMatches(counts);
  const current = active && total > 0 ? Math.min(active.current ?? 0, total - 1) : null;

  const move = useCallback(
    (delta: number) =>
      setState((previous) => {
        const count = totalMatches(previous.counts);
        if (count === 0) return previous;
        const base = previous.current ?? 0;
        return { ...previous, current: (base + delta + count) % count };
      }),
    [],
  );

  const location = useMemo(
    () => (current === null || !doc ? null : locateMatch(counts, doc.numPages, current)),
    [counts, current, doc],
  );

  return {
    total,
    current,
    location,
    searching: trimmed !== "" && !(state.key === key && state.done),
    next: () => move(1),
    previous: () => move(-1),
  };
}
