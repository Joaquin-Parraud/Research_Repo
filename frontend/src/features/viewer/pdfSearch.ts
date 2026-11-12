/** Folds a character for matching: lower case, accents removed. */
function foldChar(char: string): string {
  return char.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Folded text plus, for each folded index, the index in the original text. */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = foldChar(char);
    for (let i = 0; i < piece.length; i += 1) map.push(index);
    folded += piece;
    index += char.length;
  }
  return { folded, map };
}

export interface TextMatch {
  /** Offsets into `items.join("")`. */
  start: number;
  end: number;
}

function queryPattern(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map((word) =>
    Array.from(word)
      .map((char) => foldChar(char))
      .join("")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  // Whitespace in the query matches any amount (including none): pdf.js often
  // splits words into separate items without a space between them.
  return new RegExp(escaped.join("\\s*"), "g");
}

/**
 * Case- and accent-insensitive matches of `query` in the page text made of `items`
 * (the text-content strings, in text-layer order). Matches never overlap.
 */
export function findMatches(items: readonly string[], query: string): TextMatch[] {
  const pattern = queryPattern(query);
  if (!pattern) return [];
  const text = items.join("");
  const { folded, map } = foldWithMap(text);
  const matches: TextMatch[] = [];
  for (const found of folded.matchAll(pattern)) {
    if (found[0].length === 0) continue;
    const start = map[found.index] ?? 0;
    const last = map[found.index + found[0].length - 1];
    if (last === undefined) continue;
    // `last` is the original index of the final matched char; include its full length.
    const lastCodePoint = text.codePointAt(last);
    const end = last + (lastCodePoint !== undefined && lastCodePoint > 0xffff ? 2 : 1);
    matches.push({ start, end });
  }
  return matches;
}

export interface ItemPiece {
  item: number;
  from: number;
  to: number;
  matchIndex: number;
}

/** Splits matches into per-item character ranges (a match can span several items). */
export function matchPieces(items: readonly string[], matches: readonly TextMatch[]): ItemPiece[] {
  const pieces: ItemPiece[] = [];
  const starts: number[] = [];
  let offset = 0;
  for (const item of items) {
    starts.push(offset);
    offset += item.length;
  }
  matches.forEach((match, matchIndex) => {
    items.forEach((item, index) => {
      const itemStart = starts[index] ?? 0;
      const from = Math.max(match.start, itemStart) - itemStart;
      const to = Math.min(match.end, itemStart + item.length) - itemStart;
      if (to > from) pieces.push({ item: index, from, to, matchIndex });
    });
  });
  return pieces;
}

export interface MatchLocation {
  page: number;
  /** Index of the match within that page. */
  indexInPage: number;
}

/** Maps a 0-based global match index to a page and an index within it. */
export function locateMatch(
  counts: ReadonlyMap<number, number>,
  pageCount: number,
  globalIndex: number,
): MatchLocation | null {
  let remaining = globalIndex;
  for (let page = 1; page <= pageCount; page += 1) {
    const count = counts.get(page) ?? 0;
    if (remaining < count) return { page, indexInPage: remaining };
    remaining -= count;
  }
  return null;
}

export function totalMatches(counts: ReadonlyMap<number, number>): number {
  let total = 0;
  counts.forEach((count) => {
    total += count;
  });
  return total;
}
