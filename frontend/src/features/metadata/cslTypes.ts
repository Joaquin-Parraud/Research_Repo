/** CSL item types offered in the editor. `document` is the catch-all ("other"). */
export const CSL_TYPES = [
  "article-journal",
  "book",
  "chapter",
  "report",
  "thesis",
  "paper-conference",
  "webpage",
  "article",
  "article-magazine",
  "article-newspaper",
  "dataset",
  "software",
  "manuscript",
  "document",
] as const;

export type KnownCslType = (typeof CSL_TYPES)[number];

export const DEFAULT_CSL_TYPE: KnownCslType = "document";

export function isKnownType(type: string): type is KnownCslType {
  return (CSL_TYPES as readonly string[]).includes(type);
}

/** Optional fields; title, authors and the date are shown for every type. */
export type FieldKey =
  | "editors"
  | "containerTitle"
  | "volume"
  | "issue"
  | "page"
  | "publisher"
  | "publisherPlace"
  | "edition"
  | "number"
  | "version"
  | "doi"
  | "url"
  | "language"
  | "genre"
  | "accessed";

const FIELDS: Record<KnownCslType, readonly FieldKey[]> = {
  "article-journal": ["containerTitle", "volume", "issue", "page", "doi", "url", "language"],
  book: ["editors", "edition", "volume", "publisher", "publisherPlace", "doi", "url", "language"],
  chapter: [
    "containerTitle",
    "editors",
    "edition",
    "volume",
    "page",
    "publisher",
    "publisherPlace",
    "doi",
    "url",
    "language",
  ],
  report: ["number", "genre", "publisher", "publisherPlace", "doi", "url", "language"],
  thesis: ["genre", "publisher", "doi", "url", "language"],
  "paper-conference": [
    "containerTitle",
    "editors",
    "volume",
    "page",
    "publisher",
    "publisherPlace",
    "doi",
    "url",
    "language",
  ],
  webpage: ["containerTitle", "accessed", "url", "language"],
  article: ["containerTitle", "number", "publisher", "doi", "url", "language"],
  "article-magazine": ["containerTitle", "volume", "issue", "page", "doi", "url", "language"],
  "article-newspaper": ["containerTitle", "edition", "page", "doi", "url", "language"],
  dataset: ["version", "publisher", "doi", "url", "language"],
  software: ["version", "publisher", "doi", "url", "language"],
  manuscript: ["genre", "publisher", "publisherPlace", "url", "language"],
  document: ["containerTitle", "publisher", "publisherPlace", "doi", "url", "language"],
};

/** Optional fields for a type. A type the editor does not know (kept as-is) behaves like `document`. */
export function visibleFields(type: string): readonly FieldKey[] {
  return FIELDS[isKnownType(type) ? type : DEFAULT_CSL_TYPE];
}

export function showsField(type: string, field: FieldKey): boolean {
  return visibleFields(type).includes(field);
}

/** Types where CSL keeps the institution in `publisher`; the label says so. */
const INSTITUTION_TYPES: readonly string[] = ["thesis", "report", "manuscript"];
export const usesInstitutionLabel = (type: string) => INSTITUTION_TYPES.includes(type);

/** Translation key suffix for the container-title label (Journal / Book title / Conference…). */
export function containerLabelKey(type: string): string {
  return isKnownType(type) ? type : DEFAULT_CSL_TYPE;
}
