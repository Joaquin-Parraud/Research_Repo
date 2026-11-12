import { describe, expect, it } from "vitest";
import type { CslItem } from "../../api/csl";
import {
  applyMerge,
  blankEntry,
  citationKeyChange,
  cslToForm,
  defaultSelection,
  describeField,
  diffForms,
  entriesToNames,
  formToCsl,
  isFormChanged,
  mergeUnmanagedKeys,
  moveEntry,
  namesToEntries,
  validateCitationKey,
  validateForm,
  type MetadataForm,
} from "./cslForm";
import { CSL_TYPES, containerLabelKey, showsField, visibleFields, type FieldKey } from "./cslTypes";

const journal: CslItem = {
  id: "doe2020",
  type: "article-journal",
  title: "A study of things",
  author: [
    { family: "Doe", given: "Jane" },
    { family: "Smith", given: "Al", suffix: "Jr.", "non-dropping-particle": "van" },
    { literal: "World Health Organization" },
  ],
  issued: { "date-parts": [[2020, 3, 14]] },
  "container-title": "Journal of Things",
  volume: 12,
  issue: "2",
  page: "3-14",
  DOI: "10.1000/xyz123",
  ISSN: ["1234-5678"],
  abstract: "Something.",
  custom: { nested: [1, 2, 3] },
};

describe("cslToForm", () => {
  it("reads every managed field", () => {
    const form = cslToForm(journal);
    expect(form).toMatchObject({
      type: "article-journal",
      title: "A study of things",
      noDate: false,
      year: "2020",
      month: "3",
      day: "14",
      containerTitle: "Journal of Things",
      volume: "12", // a number in CSL becomes text in the form
      issue: "2",
      page: "3-14",
      doi: "10.1000/xyz123",
    });
    expect(form.authors.map((a) => [a.kind, a.family, a.given, a.literal])).toEqual([
      ["person", "Doe", "Jane", ""],
      ["person", "Smith", "Al", ""],
      ["organisation", "", "", "World Health Organization"],
    ]);
  });

  it("defaults a missing type to document and a missing date to 'no date'", () => {
    const form = cslToForm({ title: "x" });
    expect(form.type).toBe("document");
    expect(form.noDate).toBe(true);
    expect(form.year).toBe("");
  });

  it("reads a year-only date and ignores unusable date parts", () => {
    expect(cslToForm({ issued: { "date-parts": [[1999]] } })).toMatchObject({ year: "1999", month: "", day: "" });
    expect(cslToForm({ issued: { "date-parts": [[null]] } }).noDate).toBe(true);
    expect(cslToForm({ issued: { raw: "spring" } }).noDate).toBe(true);
  });
});

describe("formToCsl round trip", () => {
  it("returns the same item when nothing was edited, keeping unknown keys, numbers and extra name keys", () => {
    const out = formToCsl(cslToForm(journal), journal);
    expect(out).toEqual(journal);
    expect(out.volume).toBe(12);
    expect(out.ISSN).toEqual(["1234-5678"]);
    expect((out.author as Record<string, unknown>[])[1]).toMatchObject({ suffix: "Jr.", "non-dropping-particle": "van" });
  });

  it("does not drop fields hidden for the type, nor values the form cannot show", () => {
    const odd: CslItem = {
      type: "legal_case", // not in the editor's list
      title: "Roe v. Wade",
      authority: "Supreme Court",
      accessed: { "date-parts": [[2021]] }, // partial: the date input cannot hold it
      issued: { "date-parts": [[1973]], season: 2 },
      edition: { weird: true },
    };
    expect(formToCsl(cslToForm(odd), odd)).toEqual(odd);
  });

  it("writes only what changed and never touches the other keys", () => {
    const form = cslToForm(journal);
    form.title = "  New title  ";
    form.page = "";
    form.issue = "5";
    const out = formToCsl(form, journal);
    expect(out.title).toBe("New title");
    expect(out.page).toBeUndefined();
    expect("page" in out).toBe(false);
    expect(out.issue).toBe("5");
    expect(out.volume).toBe(12);
    expect(out.abstract).toBe("Something.");
    expect(out.custom).toEqual({ nested: [1, 2, 3] });
  });

  it("always writes the required type and title, even for an item that lacked them", () => {
    const out = formToCsl(cslToForm({}), {});
    expect(out).toEqual({ type: "document", title: "" });
  });

  it("changing the type keeps values that the new type hides", () => {
    const form = cslToForm(journal);
    form.type = "book";
    const out = formToCsl(form, journal);
    expect(out.type).toBe("book");
    expect(out["container-title"]).toBe("Journal of Things");
    expect(out.volume).toBe(12);
  });

  it("normalises a DOI typed as a URL", () => {
    const form = cslToForm({ type: "book", title: "t" });
    form.doi = " https://doi.org/10.5555/abc ";
    expect(formToCsl(form, { type: "book", title: "t" }).DOI).toBe("10.5555/abc");
  });

  it("maps institution and genre onto publisher and genre for a thesis", () => {
    const form = cslToForm({ type: "thesis", title: "Ni" });
    form.publisher = "Universidad del Desarrollo";
    form.genre = "Tesis de pregrado";
    expect(formToCsl(form, { type: "thesis", title: "Ni" })).toEqual({
      type: "thesis",
      title: "Ni",
      publisher: "Universidad del Desarrollo",
      genre: "Tesis de pregrado",
    });
  });

  it("writes dates as date-parts, keeps extra issued keys, and removes the date for 'no date'", () => {
    const base: CslItem = { type: "book", title: "t", issued: { "date-parts": [[2001, 5]], circa: true } };
    const form = cslToForm(base);
    form.year = "2002";
    form.month = "";
    expect(formToCsl(form, base).issued).toEqual({ "date-parts": [[2002]], circa: true });
    form.noDate = true;
    expect(formToCsl(form, base).issued).toEqual({ circa: true });
    expect("issued" in formToCsl(form, { type: "book", title: "t", issued: { "date-parts": [[2001]] } })).toBe(false);
  });

  it("writes the accessed date from the date input", () => {
    const base: CslItem = { type: "webpage", title: "t" };
    const form = cslToForm(base);
    form.accessed = "2024-02-09";
    expect(formToCsl(form, base).accessed).toEqual({ "date-parts": [[2024, 2, 9]] });
  });

  it("writes people as {family, given} and organisations as {literal}; blank rows are dropped", () => {
    const base: CslItem = { type: "book", title: "t" };
    const form = cslToForm(base);
    const person = blankEntry("person");
    person.family = " García ";
    person.given = "";
    const org = blankEntry("organisation");
    org.literal = "OECD";
    form.authors = [person, blankEntry("person"), org, blankEntry("organisation")];
    expect(formToCsl(form, base).author).toEqual([{ family: "García" }, { literal: "OECD" }]);
    form.authors = [];
    expect("author" in formToCsl(form, { ...base, author: [{ family: "X" }] })).toBe(false);
  });

  it("detects whether the form differs from the stored item", () => {
    const form = cslToForm(journal);
    expect(isFormChanged(form, journal)).toBe(false);
    form.title += "!";
    expect(isFormChanged(form, journal)).toBe(true);
  });
});

describe("names", () => {
  it("round-trips unknown name keys and a person's literal", () => {
    const names = [{ family: "Li", given: "Wei", literal: "Li Wei", isni: "0000" }];
    expect(entriesToNames(namesToEntries(names))).toEqual(names);
  });

  it("moves entries without mutating and ignores out-of-range moves", () => {
    const list = ["a", "b", "c"];
    expect(moveEntry(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveEntry(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveEntry(list, 0, 3)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("visibility per CSL type", () => {
  const expected: Record<string, { shown: FieldKey[]; hidden: FieldKey[] }> = {
    "article-journal": { shown: ["containerTitle", "volume", "issue", "page", "doi"], hidden: ["publisher", "edition", "editors", "accessed"] },
    book: { shown: ["editors", "edition", "publisher", "publisherPlace", "doi"], hidden: ["containerTitle", "issue", "page"] },
    chapter: { shown: ["containerTitle", "editors", "page", "publisher"], hidden: ["issue", "accessed"] },
    report: { shown: ["number", "genre", "publisher", "publisherPlace"], hidden: ["containerTitle", "volume", "editors"] },
    thesis: { shown: ["genre", "publisher", "url"], hidden: ["containerTitle", "volume", "publisherPlace"] },
    "paper-conference": { shown: ["containerTitle", "editors", "page", "publisher"], hidden: ["issue", "genre"] },
    webpage: { shown: ["containerTitle", "accessed", "url"], hidden: ["volume", "publisher", "doi"] },
    article: { shown: ["containerTitle", "number", "doi"], hidden: ["volume", "editors"] },
    "article-magazine": { shown: ["containerTitle", "volume", "issue", "page"], hidden: ["publisher", "editors"] },
    "article-newspaper": { shown: ["containerTitle", "edition", "page"], hidden: ["volume", "issue", "publisher"] },
    dataset: { shown: ["version", "publisher", "doi"], hidden: ["containerTitle", "page"] },
    software: { shown: ["version", "publisher", "doi"], hidden: ["containerTitle", "issue"] },
    manuscript: { shown: ["genre", "publisher", "publisherPlace"], hidden: ["containerTitle", "doi"] },
    document: { shown: ["containerTitle", "publisher", "doi"], hidden: ["volume", "editors"] },
  };

  it("covers every offered type", () => {
    expect(Object.keys(expected).sort()).toEqual([...CSL_TYPES].sort());
  });

  for (const [type, { shown, hidden }] of Object.entries(expected)) {
    it(`${type}: shows ${shown.join(", ")}; hides ${hidden.join(", ")}`, () => {
      for (const field of shown) expect(showsField(type, field), field).toBe(true);
      for (const field of hidden) expect(showsField(type, field), field).toBe(false);
      expect(showsField(type, "language")).toBe(true);
    });
  }

  it("treats an unknown type like 'document'", () => {
    expect(visibleFields("legal_case")).toEqual(visibleFields("document"));
    expect(containerLabelKey("legal_case")).toBe("document");
    expect(containerLabelKey("chapter")).toBe("chapter");
  });
});

describe("validateForm", () => {
  const valid = (): MetadataForm => cslToForm(journal);

  it("accepts a complete form", () => {
    expect(validateForm(valid())).toEqual([]);
  });

  it("requires a title", () => {
    const form = valid();
    form.title = "   ";
    expect(validateForm(form)).toEqual([{ field: "title", code: "title.required" }]);
  });

  it("requires a family name for a person with only a given name, but ignores blank rows", () => {
    const form = valid();
    const p = blankEntry("person");
    p.given = "Ana";
    form.authors = [blankEntry("person"), p];
    expect(validateForm(form)).toEqual([{ field: "authors", code: "name.familyRequired", index: 1 }]);
  });

  it.each([
    [{ year: "20x4" }, "date.year"],
    [{ year: "0" }, "date.year"],
    [{ year: "12345" }, "date.year"],
    [{ month: "13" }, "date.month"],
    [{ day: "32" }, "date.day"],
    [{ month: "2", day: "30" }, "date.invalid"],
    [{ year: "", month: "3" }, "date.yearNeeded"],
    [{ month: "", day: "3" }, "date.monthNeeded"],
  ] as const)("rejects the date %j", (patch, code) => {
    const form = { ...valid(), ...patch };
    expect(validateForm(form).map((e) => e.code)).toEqual([code]);
  });

  it("accepts 29 February in a leap year only, and ignores the date when 'no date' is set", () => {
    expect(validateForm({ ...valid(), year: "2024", month: "2", day: "29" })).toEqual([]);
    expect(validateForm({ ...valid(), year: "2023", month: "2", day: "29" }).map((e) => e.code)).toEqual(["date.invalid"]);
    expect(validateForm({ ...valid(), noDate: true, year: "abc" })).toEqual([]);
  });

  it("checks that the URL is http(s)", () => {
    expect(validateForm({ ...valid(), url: "https://example.org/a" })).toEqual([]);
    expect(validateForm({ ...valid(), url: "javascript:alert(1)" }).map((e) => e.code)).toEqual(["url.invalid"]);
    expect(validateForm({ ...valid(), url: "example.org" }).map((e) => e.code)).toEqual(["url.invalid"]);
  });
});

describe("citation key", () => {
  it("accepts lowercase letters, digits, - and _ up to 64 characters", () => {
    for (const key of ["garcia2021", "a", "a-b_c", "x".repeat(64), "2021_a"]) {
      expect(validateCitationKey(key), key).toBeNull();
    }
  });

  it("rejects empty, too long and other characters", () => {
    expect(validateCitationKey("")).toBe("empty");
    expect(validateCitationKey("x".repeat(65))).toBe("tooLong");
    for (const key of ["Garcia", "garcía", "a b", "a.b", "a/b", "a:b"]) {
      expect(validateCitationKey(key), key).toBe("characters");
    }
  });

  it("builds the PATCH part: manual value, reset to automatic, or nothing", () => {
    expect(citationKeyChange("doe2020", { mode: "keep" })).toEqual({});
    expect(citationKeyChange("doe2020", { mode: "set", value: "doe2020" })).toEqual({});
    expect(citationKeyChange("doe2020", { mode: "set", value: "my-key" })).toEqual({ citation_key: "my-key" });
    expect(citationKeyChange("doe2020", { mode: "reset" })).toEqual({ citation_key: null });
  });
});

describe("merging a suggestion", () => {
  const current = cslToForm({ type: "document", title: "Typed title", "container-title": "" });
  const incoming = cslToForm({
    type: "article-journal",
    title: "Crossref title",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020, 3]] },
    "container-title": "Journal of Things",
    volume: "12",
    DOI: "10.1/x",
    ISSN: ["1111-2222"],
    abstract: "Abstract",
    id: "10.1/x",
  });

  it("lists only fields where the suggestion has something different", () => {
    const keys = diffForms(current, incoming).map((item) => item.key);
    expect(keys).toEqual(["type", "title", "authors", "date", "containerTitle", "volume", "doi"]);
    const unchanged = diffForms(incoming, incoming);
    expect(unchanged).toEqual([]);
  });

  it("describes values for display", () => {
    expect(describeField(incoming, "authors")).toBe("Doe, Jane");
    expect(describeField(incoming, "date")).toBe("2020-03");
    expect(describeField(current, "date")).toBe("");
  });

  it("selects by default only what would not overwrite typed values", () => {
    const items = diffForms(current, incoming);
    const selected = defaultSelection(items);
    expect(selected.has("title")).toBe(false); // the user typed a title
    expect(selected.has("type")).toBe(true); // 'document' is just the default
    expect(selected.has("authors")).toBe(true);
    expect(selected.has("doi")).toBe(true);
  });

  it("applies exactly the chosen fields", () => {
    const merged = applyMerge(current, incoming, new Set(["authors", "date", "containerTitle"]));
    expect(merged.title).toBe("Typed title");
    expect(merged.type).toBe("document");
    expect(merged.authors.map((a) => a.family)).toEqual(["Doe"]);
    expect(merged).toMatchObject({ year: "2020", month: "3", day: "", noDate: false, containerTitle: "Journal of Things" });
    expect(merged.volume).toBe("");
    // Copied rows are new rows (their ids must not collide with the suggestion's).
    expect(merged.authors[0]?.id).not.toBe(incoming.authors[0]?.id);
  });

  it("'use all' replaces typed values too", () => {
    const items = diffForms(current, incoming);
    const merged = applyMerge(current, incoming, new Set(items.map((i) => i.key)));
    expect(merged.title).toBe("Crossref title");
    expect(merged.type).toBe("article-journal");
  });

  it("adds unmanaged keys the stored item lacks, without replacing anything or importing the id", () => {
    const base: CslItem = { type: "document", title: "Typed", abstract: "Mine" };
    const merged = mergeUnmanagedKeys(base, {
      type: "article-journal",
      title: "Other",
      ISSN: ["1111-2222"],
      abstract: "Theirs",
      id: "10.1/x",
    });
    expect(merged).toEqual({ type: "document", title: "Typed", abstract: "Mine", ISSN: ["1111-2222"] });
  });
});
