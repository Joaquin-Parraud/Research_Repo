import type { Bibliography, BibliographyFormat, BibliographyRequest } from "../../api/citations";

export type ScopeKind = "sources" | "folder" | "project";

export interface BibliographyScope {
  kind: ScopeKind;
  /** For `sources`. */
  sourceIds: readonly string[];
  /** For `folder`: a real folder (the project root is exported as the whole project). */
  folderId: string | null;
  includeSubfolders: boolean;
}

/** Request body for the bibliography endpoint. Omitting both `source_ids` and `folder_id` means the whole project. */
export function buildBibliographyRequest(scope: BibliographyScope, format: BibliographyFormat): BibliographyRequest {
  switch (scope.kind) {
    case "sources":
      return { format, source_ids: [...scope.sourceIds] };
    case "folder":
      return { format, folder_id: scope.folderId, include_subfolders: scope.includeSubfolders };
    case "project":
      return { format };
  }
}

/** The exported text; CSL-JSON arrives as an array and is pretty-printed. */
export function bibliographyText(bibliography: Pick<Bibliography, "content">): string {
  return typeof bibliography.content === "string"
    ? bibliography.content
    : JSON.stringify(bibliography.content, null, 2);
}

const FILE_TYPES: Record<BibliographyFormat, { extension: string; mime: string }> = {
  text: { extension: "txt", mime: "text/plain;charset=utf-8" },
  html: { extension: "html", mime: "text/html;charset=utf-8" },
  bibtex: { extension: "bib", mime: "application/x-bibtex;charset=utf-8" },
  csl: { extension: "json", mime: "application/vnd.citationstyles.csl+json;charset=utf-8" },
};

/** A name that is safe on every file system: letters, digits, dashes. */
export function safeFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || "bibliography";
}

export function bibliographyFile(format: BibliographyFormat, label: string): { filename: string; mime: string } {
  const type = FILE_TYPES[format];
  return { filename: `${safeFilenamePart(label)}-bibliography.${type.extension}`, mime: type.mime };
}
