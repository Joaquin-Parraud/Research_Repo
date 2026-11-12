/** A CSL-JSON item. Only the keys the editor manages are interpreted; everything else is carried through untouched. */
export type CslItem = Record<string, unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type MetadataStatus = "pending" | "suggested" | "confirmed";

/** Statuses that still wait for the user to look at the metadata. */
export const NEEDS_REVIEW: readonly MetadataStatus[] = ["pending", "suggested"];

export function needsReview(status: MetadataStatus): boolean {
  return NEEDS_REVIEW.includes(status);
}
