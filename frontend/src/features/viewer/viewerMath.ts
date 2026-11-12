export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;
export const PAGE_GAP_PX = 8;
const ZOOM_FACTOR = 1.2;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
export const zoomIn = (scale: number) => clampScale(Math.round(scale * ZOOM_FACTOR * 100) / 100);
export const zoomOut = (scale: number) => clampScale(Math.round((scale / ZOOM_FACTOR) * 100) / 100);

/** 1-based page number clamped into 1..total (and 1 for an empty/unknown total). */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, total));
}

/** Scale that makes a page of `pageWidth` (at scale 1) fill `containerWidth`, minus padding. */
export function fitWidthScale(containerWidth: number, pageWidth: number, padding = 32): number {
  if (pageWidth <= 0 || containerWidth <= padding) return 1;
  return clampScale((containerWidth - padding) / pageWidth);
}

/**
 * Current page for a scroll position: the last page whose top edge is at or above `offset`.
 * `tops` are the pages' top offsets in ascending order; the result is 1-based.
 */
export function pageAtOffset(tops: readonly number[], offset: number): number {
  let low = 0;
  let high = tops.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((tops[mid] ?? 0) <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found + 1;
}

export type PdfErrorKind = "noFile" | "forbidden" | "invalid" | "generic";

/** Classifies a pdf.js loading error (ResponseException carries an HTTP status). */
export function pdfErrorKind(error: unknown): PdfErrorKind {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    const name = (error as { name?: unknown }).name;
    if (status === 404) return "noFile";
    if (status === 401 || status === 403) return "forbidden";
    if (name === "InvalidPDFException" || name === "FormatError") return "invalid";
  }
  return "generic";
}
