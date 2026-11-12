import { isRecord, type CslItem } from "../../api/csl";
import { DEFAULT_CSL_TYPE, visibleFields, type FieldKey } from "./cslTypes";

export type NameKind = "person" | "organisation";

/** One author or editor row. Values typed for the inactive kind are kept so toggling back loses nothing. */
export interface NameEntry {
  id: string;
  kind: NameKind;
  family: string;
  given: string;
  literal: string;
  /** Other CSL name keys (suffix, particles…) that the editor does not show but must not lose. */
  extra: Record<string, unknown>;
}

export interface MetadataForm {
  type: string;
  title: string;
  authors: NameEntry[];
  editors: NameEntry[];
  noDate: boolean;
  year: string;
  month: string;
  day: string;
  containerTitle: string;
  volume: string;
  issue: string;
  page: string;
  publisher: string;
  publisherPlace: string;
  edition: string;
  number: string;
  version: string;
  doi: string;
  url: string;
  language: string;
  genre: string;
  /** `YYYY-MM-DD`, or empty. */
  accessed: string;
}

type ScalarKey = Exclude<FieldKey, "editors" | "accessed">;

/** Form field → CSL key for the plain text fields. */
const SCALARS: readonly { key: ScalarKey; csl: string }[] = [
  { key: "containerTitle", csl: "container-title" },
  { key: "volume", csl: "volume" },
  { key: "issue", csl: "issue" },
  { key: "page", csl: "page" },
  { key: "publisher", csl: "publisher" },
  { key: "publisherPlace", csl: "publisher-place" },
  { key: "edition", csl: "edition" },
  { key: "number", csl: "number" },
  { key: "version", csl: "version" },
  { key: "doi", csl: "DOI" },
  { key: "url", csl: "URL" },
  { key: "language", csl: "language" },
  { key: "genre", csl: "genre" },
];

// ---------------------------------------------------------------------------------------------
// Names

let entryCounter = 0;
export const newEntryId = () => `name-${++entryCounter}`;

export function blankEntry(kind: NameKind = "person"): NameEntry {
  return { id: newEntryId(), kind, family: "", given: "", literal: "", extra: {} };
}

export function isBlankEntry(entry: NameEntry): boolean {
  return entry.kind === "person"
    ? !entry.family.trim() && !entry.given.trim()
    : !entry.literal.trim();
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

export function namesToEntries(value: unknown): NameEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: NameEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { family, given, literal, ...rest } = item;
    const isOrganisation = text(literal) !== "" && text(family) === "" && text(given) === "";
    entries.push({
      id: newEntryId(),
      kind: isOrganisation ? "organisation" : "person",
      family: text(family),
      given: text(given),
      literal: text(literal),
      // A person that also carries a `literal` keeps it, so it survives a round trip.
      extra: isOrganisation ? rest : { ...rest, ...(text(literal) ? { literal } : {}) },
    });
  }
  return entries;
}

/** CSL names for the non-blank entries, in order. People become `{family, given}`, organisations `{literal}`. */
export function entriesToNames(entries: readonly NameEntry[]): Record<string, unknown>[] {
  const names: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (isBlankEntry(entry)) continue;
    if (entry.kind === "organisation") {
      names.push({ literal: entry.literal.trim() });
    } else {
      const given = entry.given.trim();
      names.push({ ...entry.extra, family: entry.family.trim(), ...(given ? { given } : {}) });
    }
  }
  return names;
}

export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** "García, Ana; OECD" – used for the merge view. */
export function describeNames(entries: readonly NameEntry[]): string {
  return entriesToNames(entries)
    .map((name) =>
      typeof name.literal === "string" && name.family === undefined
        ? name.literal
        : [name.family, name.given].filter((part) => typeof part === "string" && part).join(", "),
    )
    .join("; ");
}

// ---------------------------------------------------------------------------------------------
// Dates

function parseParts(value: unknown): number[] {
  if (!isRecord(value)) return [];
  const outer = value["date-parts"];
  const inner = Array.isArray(outer) ? outer[0] : undefined;
  if (!Array.isArray(inner)) return [];
  const parts: number[] = [];
  for (const raw of inner) {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isInteger(n)) break;
    parts.push(n);
  }
  return parts;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function accessedToInput(value: unknown): string {
  const [y, m, d] = parseParts(value);
  return y !== undefined && m !== undefined && d !== undefined ? `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` : "";
}

/** Year, month and day of `YYYY-MM-DD`, or nothing. */
function inputToParts(value: string): number[] | null {
  const match = /^(\d{1,4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function withDateParts(existing: unknown, parts: number[] | null): Record<string, unknown> | undefined {
  const rest: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  delete rest["date-parts"];
  if (parts) return { ...rest, "date-parts": [parts] };
  return Object.keys(rest).length > 0 ? rest : undefined;
}

// ---------------------------------------------------------------------------------------------
// CSL <-> form

export function cslToForm(csl: CslItem): MetadataForm {
  const [year, month, day] = parseParts(csl.issued);
  const form: MetadataForm = {
    type: typeof csl.type === "string" && csl.type ? csl.type : DEFAULT_CSL_TYPE,
    title: text(csl.title),
    authors: namesToEntries(csl.author),
    editors: namesToEntries(csl.editor),
    noDate: year === undefined,
    year: year === undefined ? "" : String(year),
    month: month === undefined ? "" : String(month),
    day: day === undefined ? "" : String(day),
    containerTitle: "",
    volume: "",
    issue: "",
    page: "",
    publisher: "",
    publisherPlace: "",
    edition: "",
    number: "",
    version: "",
    doi: "",
    url: "",
    language: "",
    genre: "",
    accessed: accessedToInput(csl.accessed),
  };
  for (const { key, csl: cslKey } of SCALARS) form[key] = text(csl[cslKey]);
  return form;
}

const DOI_URL_PREFIX = /^https?:\/\/(?:dx\.)?doi\.org\//i;

function normaliseScalar(key: ScalarKey, value: string): string {
  const trimmed = value.trim();
  return key === "doi" ? trimmed.replace(DOI_URL_PREFIX, "") : trimmed;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dateParts(form: MetadataForm): number[] | null {
  if (form.noDate || !form.year.trim()) return null;
  const parts = [Number(form.year)];
  if (form.month.trim()) {
    parts.push(Number(form.month));
    if (form.day.trim()) parts.push(Number(form.day));
  }
  return parts;
}

/**
 * The complete CSL item to save. It starts from `base` (the stored item) and only writes what the
 * user changed, so unknown keys, fields hidden for the type, numbers stored as numbers and partial
 * dates all survive untouched; opening and saving without edits yields the same item.
 * `type` and `title` are always written because the server requires them.
 */
export function formToCsl(form: MetadataForm, base: CslItem): CslItem {
  const initial = cslToForm(base);
  const out: CslItem = { ...base, type: form.type, title: form.title.trim() };

  for (const { key, csl } of SCALARS) {
    if (form[key] === initial[key]) continue;
    const value = normaliseScalar(key, form[key]);
    if (value) out[csl] = value;
    else Reflect.deleteProperty(out, csl);
  }

  for (const [key, csl] of [["authors", "author"], ["editors", "editor"]] as const) {
    const names = entriesToNames(form[key]);
    if (sameJson(names, entriesToNames(initial[key]))) continue;
    if (names.length > 0) out[csl] = names;
    else Reflect.deleteProperty(out, csl);
  }

  const dateChanged =
    form.noDate !== initial.noDate ||
    form.year !== initial.year ||
    form.month !== initial.month ||
    form.day !== initial.day;
  if (dateChanged) {
    const issued = withDateParts(base.issued, dateParts(form));
    if (issued) out.issued = issued;
    else delete out.issued;
  }

  if (form.accessed !== initial.accessed) {
    const accessed = withDateParts(base.accessed, inputToParts(form.accessed));
    if (accessed) out.accessed = accessed;
    else delete out.accessed;
  }

  return out;
}

export function isFormChanged(form: MetadataForm, base: CslItem): boolean {
  return !sameJson(normaliseForCompare(form), normaliseForCompare(cslToForm(base)));
}

function normaliseForCompare(form: MetadataForm) {
  const { authors, editors, ...rest } = form;
  return { ...rest, authors: entriesToNames(authors), editors: entriesToNames(editors) };
}

// ---------------------------------------------------------------------------------------------
// Validation

export type FormErrorField = "title" | "authors" | "editors" | "date" | "url";
export type FormErrorCode =
  | "title.required"
  | "name.familyRequired"
  | "date.year"
  | "date.month"
  | "date.day"
  | "date.monthNeeded"
  | "date.yearNeeded"
  | "date.invalid"
  | "url.invalid";

export interface FormError {
  field: FormErrorField;
  code: FormErrorCode;
  /** Position of the offending name, for author/editor errors. */
  index?: number;
}

const INTEGER = /^\d+$/;

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateErrors(form: MetadataForm): FormError[] {
  if (form.noDate) return [];
  const year = form.year.trim();
  const month = form.month.trim();
  const day = form.day.trim();
  const errors: FormError[] = [];
  if (!year) {
    if (month || day) errors.push({ field: "date", code: "date.yearNeeded" });
    return errors;
  }
  if (!INTEGER.test(year) || year.length > 4 || Number(year) < 1) {
    return [{ field: "date", code: "date.year" }];
  }
  if (!month) {
    if (day) errors.push({ field: "date", code: "date.monthNeeded" });
    return errors;
  }
  if (!INTEGER.test(month) || Number(month) < 1 || Number(month) > 12) {
    return [{ field: "date", code: "date.month" }];
  }
  if (day) {
    if (!INTEGER.test(day) || Number(day) < 1 || Number(day) > 31) return [{ field: "date", code: "date.day" }];
    if (!isRealDate(Number(year), Number(month), Number(day))) return [{ field: "date", code: "date.invalid" }];
  }
  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateForm(form: MetadataForm): FormError[] {
  const errors: FormError[] = [];
  if (!form.title.trim()) errors.push({ field: "title", code: "title.required" });
  for (const field of ["authors", "editors"] as const) {
    form[field].forEach((entry, index) => {
      if (entry.kind === "person" && !entry.family.trim() && entry.given.trim()) {
        errors.push({ field, code: "name.familyRequired", index });
      }
    });
  }
  errors.push(...dateErrors(form));
  if (form.url.trim() && !isHttpUrl(form.url.trim())) errors.push({ field: "url", code: "url.invalid" });
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Citation key

export const CITATION_KEY_MAX = 64;
export type CitationKeyError = "empty" | "tooLong" | "characters";

/** Lowercase letters, digits, `-` and `_`; 1–64 characters. Returns what is wrong, or `null`. */
export function validateCitationKey(value: string): CitationKeyError | null {
  if (value.length === 0) return "empty";
  if (value.length > CITATION_KEY_MAX) return "tooLong";
  return /^[a-z0-9_-]+$/.test(value) ? null : "characters";
}

export interface CitationKeyChange {
  /** `undefined`: leave the key alone; `null`: back to automatic; string: set by hand. */
  citation_key?: string | null;
}

/** What to send for the key, given the stored key and what the user did in the key field. */
export function citationKeyChange(
  current: string,
  edit: { mode: "keep" } | { mode: "set"; value: string } | { mode: "reset" },
): CitationKeyChange {
  if (edit.mode === "reset") return { citation_key: null };
  if (edit.mode === "set" && edit.value !== current) return { citation_key: edit.value };
  return {};
}

// ---------------------------------------------------------------------------------------------
// Merging a suggestion (DOI lookup, PDF) into the form

export type MergeKey = "type" | "title" | "authors" | "date" | FieldKey;

export interface MergeItem {
  key: MergeKey;
  current: string;
  incoming: string;
  /** The form has nothing worth protecting here, so taking the suggestion is risk-free. */
  currentEmpty: boolean;
}

const DATE_KEYS = ["noDate", "year", "month", "day"] as const;

/** Text for one field group, as shown in the merge table. Empty string = nothing there. */
export function describeField(form: MetadataForm, key: MergeKey): string {
  switch (key) {
    case "authors":
    case "editors":
      return describeNames(form[key]);
    case "date":
      return form.noDate || !form.year.trim()
        ? ""
        : [form.year.trim(), form.month.trim() && pad(Number(form.month), 2), form.day.trim() && pad(Number(form.day), 2)]
            .filter(Boolean)
            .join("-");
    default:
      return String(form[key]).trim();
  }
}

/** Fields that differ and are worth offering: the suggestion has a value and it is not what is there. */
export function diffForms(current: MetadataForm, incoming: MetadataForm): MergeItem[] {
  const optional = new Set<FieldKey>([...visibleFields(current.type), ...visibleFields(incoming.type)]);
  const keys: MergeKey[] = ["type", "title", "authors", "date"];
  for (const key of ALL_OPTIONAL) if (optional.has(key)) keys.push(key);

  const items: MergeItem[] = [];
  for (const key of keys) {
    const next = describeField(incoming, key);
    const now = describeField(current, key);
    if (!next || next === now) continue;
    items.push({
      key,
      current: now,
      incoming: next,
      currentEmpty: key === "type" ? now === DEFAULT_CSL_TYPE : now === "",
    });
  }
  return items;
}

const ALL_OPTIONAL: readonly FieldKey[] = [
  "editors",
  "containerTitle",
  "volume",
  "issue",
  "page",
  "publisher",
  "publisherPlace",
  "edition",
  "number",
  "version",
  "doi",
  "url",
  "language",
  "genre",
  "accessed",
];

/** Keys taken by default: those where the form has nothing yet. Conflicts are left for the user to choose. */
export function defaultSelection(items: readonly MergeItem[]): Set<MergeKey> {
  return new Set(items.filter((item) => item.currentEmpty).map((item) => item.key));
}

/** Copies the chosen field groups from `incoming` into `current`; everything else is untouched. */
export function applyMerge(
  current: MetadataForm,
  incoming: MetadataForm,
  keys: ReadonlySet<MergeKey>,
): MetadataForm {
  const next: MetadataForm = { ...current };
  for (const key of keys) {
    if (key === "date") {
      for (const dateKey of DATE_KEYS) Object.assign(next, { [dateKey]: incoming[dateKey] });
    } else if (key === "authors" || key === "editors") {
      next[key] = incoming[key].map((entry) => ({ ...entry, id: newEntryId() }));
    } else {
      Object.assign(next, { [key]: incoming[key] });
    }
  }
  return next;
}

/** Keys the editor does not manage. */
const MANAGED_CSL_KEYS = new Set([
  "id",
  "type",
  "title",
  "author",
  "editor",
  "issued",
  "accessed",
  ...SCALARS.map((scalar) => scalar.csl),
]);

/**
 * Adds keys from a suggestion that the stored item does not have at all (ISSN, abstract…), so a DOI
 * lookup enriches the record without ever replacing something already there.
 */
export function mergeUnmanagedKeys(base: CslItem, incoming: CslItem): CslItem {
  const out: CslItem = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (MANAGED_CSL_KEYS.has(key) || key in out) continue;
    out[key] = value;
  }
  return out;
}
