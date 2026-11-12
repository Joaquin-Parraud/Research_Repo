import { apiRequest } from "./client";
import type { CslItem } from "./csl";

export type SuggestOrigin = "doi" | "pdf" | "none";

export interface MetadataSuggestion {
  csl: CslItem | null;
  origin: SuggestOrigin;
  doi: string | null;
}

/** Suggests metadata for a source from its PDF. Nothing is saved. */
export const suggestMetadata = (sourceId: string) =>
  apiRequest<MetadataSuggestion>("POST", `/sources/${sourceId}/metadata/suggest`);

/** Looks a DOI up (Crossref). Nothing is saved. */
export const lookupDoi = (doi: string) =>
  apiRequest<{ csl: CslItem }>("POST", "/metadata/lookup", { doi });
