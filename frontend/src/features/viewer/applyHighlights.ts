import { findMatches, matchPieces } from "./pdfSearch";

const MARKED = "data-highlighted";

interface HighlightClasses {
  hit: string;
  current: string;
}

/**
 * Highlights search matches inside pdf.js text-layer spans. `divs` and `items` are the
 * text layer's parallel `textDivs` / `textContentItemsStr`. Previous highlights are
 * removed first. Returns the "current" match element (for scrolling), if any.
 */
export function applyHighlights(
  divs: readonly HTMLElement[],
  items: readonly string[],
  query: string,
  currentIndex: number | null,
  classes: HighlightClasses,
): HTMLElement | null {
  // Remove earlier highlights by restoring the plain text.
  divs.forEach((div, index) => {
    if (div.hasAttribute(MARKED)) {
      div.textContent = items[index] ?? "";
      div.removeAttribute(MARKED);
    }
  });
  if (divs.length !== items.length || !query.trim()) return null;

  const pieces = matchPieces(items, findMatches(items, query));
  const byItem = new Map<number, typeof pieces>();
  for (const piece of pieces) byItem.set(piece.item, [...(byItem.get(piece.item) ?? []), piece]);

  let current: HTMLElement | null = null;
  byItem.forEach((itemPieces, index) => {
    const div = divs[index];
    const text = items[index];
    if (!div || text === undefined) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const piece of [...itemPieces].sort((a, b) => a.from - b.from)) {
      if (piece.from > cursor) fragment.append(text.slice(cursor, piece.from));
      const mark = document.createElement("mark");
      mark.className = piece.matchIndex === currentIndex ? `${classes.hit} ${classes.current}` : classes.hit;
      mark.textContent = text.slice(piece.from, piece.to);
      fragment.append(mark);
      if (piece.matchIndex === currentIndex && !current) current = mark;
      cursor = piece.to;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    div.replaceChildren(fragment);
    div.setAttribute(MARKED, "");
  });
  return current;
}
