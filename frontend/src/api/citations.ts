import { apiRequest } from "./client";
import type { CslItem } from "./csl";

export interface Citation {
  style: string;
  locale: string;
  reference_text: string;
  reference_html: string;
  in_text_parenthetical: string;
  in_text_narrative: string;
}

export const getCitation = (sourceId: string) =>
  apiRequest<Citation>("GET", `/sources/${sourceId}/citation`);

export type BibliographyFormat = "text" | "html" | "bibtex" | "csl";

export interface BibliographyRequest {
  format: BibliographyFormat;
  source_ids?: string[];
  folder_id?: string | null;
  include_subfolders?: boolean;
}

export interface Bibliography {
  format: BibliographyFormat;
  count: number;
  /** A string, or an array of CSL items for the `csl` format. */
  content: string | CslItem[];
}

export const getBibliography = (projectId: string, request: BibliographyRequest) =>
  apiRequest<Bibliography>("POST", `/projects/${projectId}/bibliography`, request);
