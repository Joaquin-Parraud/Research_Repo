import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../api/library";
import { baseRoutes, bodyOf, defaultConfig, makeSource } from "./fixtures";
import { errorResponse, jsonResponse, mockApi, renderApp } from "./helpers";

// The PDF viewer is irrelevant here (and needs a browser); it just never finishes loading.
vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => undefined)) }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const pendingSource = (overrides: Partial<Source> = {}): Source =>
  makeSource({
    has_file: false,
    file: null,
    metadata_status: "pending",
    csl: { type: "document", title: "Alpha paper", abstract: "kept" },
    ...overrides,
  });

interface Setup {
  source?: Source;
  config?: typeof defaultConfig;
  routes?: Parameters<typeof mockApi>[0];
}

async function openEditor({ source = pendingSource(), config, routes = {} }: Setup = {}) {
  const patches: unknown[] = [];
  mockApi({
    ...baseRoutes({ config }),
    "GET /api/sources/s1": () => jsonResponse(200, source),
    "PATCH /api/sources/s1": (init) => {
      patches.push(bodyOf(init));
      return jsonResponse(200, { ...source, ...(bodyOf(init) as object) });
    },
    ...routes,
  });
  renderApp("/p/p1?source=s1");
  await userEvent.click(await screen.findByRole("button", { name: "Edit metadata" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit metadata" });
  return { dialog, patches };
}

describe("metadata editor: fields", () => {
  it("shows only the fields of the chosen type, with labels that adapt", async () => {
    const { dialog } = await openEditor();
    const d = within(dialog);
    expect(d.queryByLabelText("Issue")).not.toBeInTheDocument();
    expect(d.queryByLabelText("Journal")).not.toBeInTheDocument();
    expect(d.getByLabelText("Container (journal, book, website…)")).toBeInTheDocument();

    await userEvent.selectOptions(d.getByLabelText("Type"), "article-journal");
    expect(d.getByLabelText("Journal")).toBeInTheDocument();
    expect(d.getByLabelText("Volume")).toBeInTheDocument();
    expect(d.getByLabelText("Issue")).toBeInTheDocument();
    expect(d.queryByRole("group", { name: "Editors" })).not.toBeInTheDocument();

    await userEvent.selectOptions(d.getByLabelText("Type"), "book");
    expect(d.queryByLabelText("Issue")).not.toBeInTheDocument();
    expect(d.getByText("Editors")).toBeInTheDocument();
    expect(d.getByLabelText("Edition")).toBeInTheDocument();

    await userEvent.selectOptions(d.getByLabelText("Type"), "thesis");
    expect(d.getByLabelText("Institution")).toBeInTheDocument();
    expect(d.getByLabelText(/^Thesis type/)).toBeInTheDocument();

    await userEvent.selectOptions(d.getByLabelText("Type"), "webpage");
    expect(d.getByLabelText("Website")).toBeInTheDocument();
    expect(d.getByLabelText("Accessed on")).toBeInTheDocument();
  });

  it("offers every CSL type with a translated label", async () => {
    const { dialog } = await openEditor();
    const options = within(within(dialog).getByLabelText("Type")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Journal article",
      "Book",
      "Book chapter",
      "Report",
      "Thesis or dissertation",
      "Conference paper",
      "Web page",
      "Preprint",
      "Magazine article",
      "Newspaper article",
      "Dataset",
      "Software",
      "Unpublished manuscript",
      "Other",
    ]);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toContain("article");
  });

  it("keeps a type it does not know instead of silently changing it", async () => {
    const { dialog, patches } = await openEditor({
      source: pendingSource({ csl: { type: "legal_case", title: "Roe v. Wade", authority: "Court" } }),
    });
    expect(within(dialog).getByLabelText("Type")).toHaveValue("legal_case");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ csl: { type: "legal_case", title: "Roe v. Wade", authority: "Court" } });
  });

  it("shows a date hint when there is no year and lets you tick 'No date'", async () => {
    const { dialog } = await openEditor();
    const d = within(dialog);
    expect(d.getByLabelText("Year")).toBeDisabled(); // a source without a date starts as "No date"
    expect(d.queryByText(/n\.d\./)).not.toBeInTheDocument();
    await userEvent.click(d.getByLabelText("No date"));
    expect(d.getByLabelText("Year")).toBeEnabled();
    expect(d.getByText(/n\.d\./)).toBeInTheDocument(); // a year is expected unless "No date" is ticked
  });
});

describe("metadata editor: authors list", () => {
  it("adds people and organisations, reorders them with buttons and the keyboard, and saves them in order", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);

    await userEvent.click(d.getByRole("button", { name: "Add person" }));
    const first = d.getByRole("group", { name: "Author 1" });
    // The new row's first input has focus.
    expect(within(first).getByLabelText("Family name")).toHaveFocus();
    await userEvent.type(within(first).getByLabelText("Family name"), "Doe");
    await userEvent.type(within(first).getByLabelText("Given name(s)"), "Jane");

    await userEvent.click(d.getByRole("button", { name: "Add organisation" }));
    const second = d.getByRole("group", { name: "Author 2" });
    await userEvent.type(within(second).getByLabelText("Organisation name"), "OECD");

    await userEvent.click(d.getByRole("button", { name: "Add person" }));
    const third = d.getByRole("group", { name: "Author 3" });
    await userEvent.type(within(third).getByLabelText("Family name"), "Smith");

    // Boundaries: first can't go up, last can't go down.
    expect(d.getByRole("button", { name: "Move author 1 up" })).toBeDisabled();
    expect(d.getByRole("button", { name: "Move author 3 down" })).toBeDisabled();

    // Button: move OECD to the top. Focus follows the moved row.
    await userEvent.click(d.getByRole("button", { name: "Move author 2 up" }));
    expect(d.getByRole("group", { name: "Author 1" })).toHaveTextContent("Organisation name");
    expect(d.getByRole("button", { name: "Move author 1 down" })).toHaveFocus(); // up is disabled now

    // Keyboard: Alt+ArrowDown inside Smith's row ... first move Smith up twice.
    const smithFamily = within(d.getByRole("group", { name: "Author 3" })).getByLabelText("Family name");
    smithFamily.focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(within(d.getByRole("group", { name: "Author 2" })).getByLabelText("Family name")).toHaveValue("Smith");
    expect(within(d.getByRole("group", { name: "Author 2" })).getByLabelText("Family name")).toHaveFocus();

    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      csl: {
        type: "document",
        title: "Alpha paper",
        abstract: "kept",
        author: [{ literal: "OECD" }, { family: "Smith" }, { family: "Doe", given: "Jane" }],
      },
    });
  });

  it("announces moves to screen readers and removes rows", async () => {
    const { dialog } = await openEditor({
      source: pendingSource({
        csl: { type: "document", title: "T", author: [{ family: "A" }, { family: "B" }] },
      }),
    });
    const d = within(dialog);
    await userEvent.click(d.getByRole("button", { name: "Move author 1 down" }));
    expect(d.getByText("Author moved to position 2 of 2.")).toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Remove author 1" }));
    expect(d.getAllByRole("group", { name: /^Author \d+$/ })).toHaveLength(1);
    expect(d.getByRole("button", { name: "Add person" })).toHaveFocus();
  });

  it("switches a row between person and organisation", async () => {
    const { dialog, patches } = await openEditor({
      source: pendingSource({ csl: { type: "document", title: "T", author: [{ family: "Doe", given: "J" }] } }),
    });
    const d = within(dialog);
    const row = d.getByRole("group", { name: "Author 1" });
    await userEvent.selectOptions(within(row).getByLabelText("Kind"), "organisation");
    await userEvent.type(within(row).getByLabelText("Organisation name"), "WHO");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { csl: { author: unknown } }).csl.author).toEqual([{ literal: "WHO" }]);
  });

  it("blocks saving a person who only has a given name, with an inline error", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);
    await userEvent.click(d.getByRole("button", { name: "Add person" }));
    await userEvent.type(d.getByLabelText("Given name(s)"), "Ana");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    expect(await d.findByText("Enter a family name, or switch the kind to Organisation.")).toBeInTheDocument();
    expect(d.getByLabelText("Family name")).toHaveAttribute("aria-invalid", "true");
    expect(patches).toHaveLength(0);
  });
});

describe("metadata editor: saving", () => {
  it("Save sends the whole csl only; Save and confirm also sends metadata_status", async () => {
    const first = await openEditor();
    await userEvent.type(within(first.dialog).getByLabelText("Title"), " (2nd ed.)");
    await userEvent.click(within(first.dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(first.patches).toHaveLength(1));
    expect(first.patches[0]).toEqual({
      csl: { type: "document", title: "Alpha paper (2nd ed.)", abstract: "kept" },
    });
    expect("metadata_status" in (first.patches[0] as object)).toBe(false);
    expect(await screen.findByText("Metadata saved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Save and confirm is the primary action and sends metadata_status: confirmed", async () => {
    const { dialog, patches } = await openEditor();
    await userEvent.selectOptions(within(dialog).getByLabelText("Type"), "book");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save and confirm" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      csl: { type: "book", title: "Alpha paper", abstract: "kept" },
      metadata_status: "confirmed",
    });
    expect(await screen.findByText("Metadata saved and confirmed.")).toBeInTheDocument();
  });

  it("requires a title", async () => {
    const { dialog, patches } = await openEditor();
    await userEvent.clear(within(dialog).getByLabelText("Title"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save and confirm" }));
    expect(await within(dialog).findByText("A title is required.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(patches).toHaveLength(0);
  });

  it("validates the date and does not send", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);
    await userEvent.click(d.getByLabelText("No date"));
    await userEvent.type(d.getByLabelText("Year"), "2023");
    await userEvent.selectOptions(d.getByLabelText("Month"), "2");
    await userEvent.type(d.getByLabelText("Day"), "30");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    expect(await d.findByText("That date does not exist.")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("writes the date as date-parts", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);
    await userEvent.click(d.getByLabelText("No date"));
    await userEvent.type(d.getByLabelText("Year"), "2021");
    await userEvent.selectOptions(d.getByLabelText("Month"), "3");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { csl: { issued: unknown } }).csl.issued).toEqual({ "date-parts": [[2021, 3]] });
  });

  it("shows a translated server error and stays open", async () => {
    const { dialog } = await openEditor({
      routes: { "PATCH /api/sources/s1": () => errorResponse(422, "metadata.invalid_csl") },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/The metadata is not valid/)).toBeInTheDocument();
    expect(within(dialog).queryByText("English fallback")).not.toBeInTheDocument();
  });

  it("asks before discarding edits, but closes straight away when nothing changed", async () => {
    const { dialog } = await openEditor();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit metadata" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    const again = await screen.findByRole("dialog", { name: "Edit metadata" });
    await userEvent.type(within(again).getByLabelText("Title"), "!");
    await userEvent.click(within(again).getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Edit metadata" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog", { name: "Edit metadata" })).getByRole("button", { name: "Cancel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("metadata editor: DOI lookup and merge", () => {
  const crossref = {
    type: "article-journal",
    title: "Crossref title",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020, 3]] },
    "container-title": "Journal of Things",
    DOI: "10.1000/xyz",
    ISSN: ["1111-2222"],
  };

  it("shows a per-field diff instead of overwriting, and applies only the chosen fields", async () => {
    let lookupBody: unknown;
    const { dialog, patches } = await openEditor({
      routes: {
        "POST /api/metadata/lookup": (init) => {
          lookupBody = bodyOf(init);
          return jsonResponse(200, { csl: crossref });
        },
      },
    });
    const d = within(dialog);
    expect(d.getByRole("button", { name: "Look up DOI" })).toBeDisabled();
    await userEvent.type(d.getByLabelText("DOI"), "10.1000/xyz");
    await userEvent.click(d.getByRole("button", { name: "Look up DOI" }));

    const merge = await d.findByRole("region", { name: "Metadata from the DOI" });
    expect(lookupBody).toEqual({ doi: "10.1000/xyz" });
    // The typed title is still there: nothing was applied.
    expect(d.getByLabelText("Title")).toHaveValue("Alpha paper");
    const table = within(merge);
    // Empty fields are ticked by default; the conflicting title is not.
    expect(table.getByRole("checkbox", { name: "Use suggested Title" })).not.toBeChecked();
    expect(table.getByRole("checkbox", { name: "Use suggested Authors" })).toBeChecked();
    expect(table.getByRole("checkbox", { name: "Use suggested Type" })).toBeChecked();
    expect(table.getByText("Crossref title")).toBeInTheDocument();
    expect(table.getByText("Doe, Jane")).toBeInTheDocument();
    expect(table.getByText("Journal article")).toBeInTheDocument();

    await userEvent.click(table.getByRole("checkbox", { name: "Use suggested Authors" })); // untick
    await userEvent.click(table.getByRole("button", { name: /^Apply \d+ fields?$/ }));

    expect(d.queryByRole("region", { name: "Metadata from the DOI" })).not.toBeInTheDocument();
    expect(d.getByLabelText("Title")).toHaveValue("Alpha paper"); // kept
    expect(d.getByLabelText("Journal")).toHaveValue("Journal of Things"); // taken
    expect(d.queryByRole("group", { name: "Author 1" })).not.toBeInTheDocument(); // not taken

    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    const saved = (patches[0] as { csl: Record<string, unknown> }).csl;
    expect(saved).toMatchObject({
      type: "article-journal",
      title: "Alpha paper",
      "container-title": "Journal of Things",
      DOI: "10.1000/xyz",
      issued: { "date-parts": [[2020, 3]] },
      abstract: "kept",
      ISSN: ["1111-2222"], // extra keys the suggestion brings are added...
    });
    expect("author" in saved).toBe(false);
    expect("id" in saved).toBe(false);
  });

  it("'Use all' takes every field, including the ones that would overwrite", async () => {
    const { dialog, patches } = await openEditor({
      routes: { "POST /api/metadata/lookup": () => jsonResponse(200, { csl: crossref }) },
    });
    const d = within(dialog);
    await userEvent.type(d.getByLabelText("DOI"), "10.1000/xyz");
    await userEvent.click(d.getByRole("button", { name: "Look up DOI" }));
    await userEvent.click(await d.findByRole("button", { name: "Use all" }));
    expect(d.getByLabelText("Title")).toHaveValue("Crossref title");
    expect(within(d.getByRole("group", { name: "Author 1" })).getByLabelText("Family name")).toHaveValue("Doe");
    expect(d.getByText("Applied 5 fields. Review them, then save.")).toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Save and confirm" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { csl: Record<string, unknown> }).csl.title).toBe("Crossref title");
  });

  it("dismissing the suggestion changes nothing", async () => {
    const { dialog } = await openEditor({
      routes: { "POST /api/metadata/lookup": () => jsonResponse(200, { csl: crossref }) },
    });
    const d = within(dialog);
    await userEvent.type(d.getByLabelText("DOI"), "10.1000/xyz");
    await userEvent.click(d.getByRole("button", { name: "Look up DOI" }));
    await userEvent.click(await d.findByRole("button", { name: "Dismiss" }));
    expect(d.queryByRole("region", { name: "Metadata from the DOI" })).not.toBeInTheDocument();
    expect(d.getByLabelText("Title")).toHaveValue("Alpha paper");
  });

  it("says so when the lookup has nothing new", async () => {
    const same = { type: "document", title: "Alpha paper" };
    const { dialog } = await openEditor({
      routes: { "POST /api/metadata/lookup": () => jsonResponse(200, { csl: same }) },
    });
    await userEvent.type(within(dialog).getByLabelText("DOI"), "10.1/a");
    await userEvent.click(within(dialog).getByRole("button", { name: "Look up DOI" }));
    expect(await within(dialog).findByText(/Nothing new/)).toBeInTheDocument();
  });

  it.each([
    [422, "metadata.invalid_doi", "That does not look like a valid DOI."],
    [404, "metadata.doi_not_found", "No record was found for that DOI."],
    [502, "metadata.lookup_failed", "The DOI service could not be reached. Try again later."],
    [503, "metadata.lookup_disabled", "DOI lookup is turned off on this server."],
  ])("translates %i %s", async (status, code, message) => {
    const { dialog } = await openEditor({
      routes: { "POST /api/metadata/lookup": () => errorResponse(status, code) },
    });
    await userEvent.type(within(dialog).getByLabelText("DOI"), "10.1/a");
    await userEvent.click(within(dialog).getByRole("button", { name: "Look up DOI" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it("hides the DOI lookup when the server has it turned off", async () => {
    const { dialog } = await openEditor({ config: { ...defaultConfig, metadata_lookup_enabled: false } });
    expect(within(dialog).getByLabelText("DOI")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Look up DOI" })).not.toBeInTheDocument();
  });
});

describe("metadata editor: suggest from PDF", () => {
  const withFile = () =>
    pendingSource({ has_file: true, file: { size_bytes: 10, page_count: 3, original_filename: "a.pdf" } });

  it("is offered only when the source has a file", async () => {
    const { dialog } = await openEditor();
    expect(within(dialog).queryByRole("button", { name: "Suggest from PDF" })).not.toBeInTheDocument();
  });

  it("explains when nothing was found (origin none)", async () => {
    const { dialog } = await openEditor({
      source: withFile(),
      routes: {
        "POST /api/sources/s1/metadata/suggest": () => jsonResponse(200, { csl: null, origin: "none", doi: null }),
      },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Suggest from PDF" }));
    expect(await within(dialog).findByText(/No metadata could be found in this PDF/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: /Metadata from/ })).not.toBeInTheDocument();
  });

  it("merges a suggestion from the PDF's own properties, flagged as less reliable", async () => {
    const { dialog } = await openEditor({
      source: withFile(),
      routes: {
        "POST /api/sources/s1/metadata/suggest": () =>
          jsonResponse(200, { csl: { type: "article-journal", title: "From PDF", author: [{ family: "Pdf" }] }, origin: "pdf", doi: null }),
      },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Suggest from PDF" }));
    const merge = await within(dialog).findByRole("region", { name: "Metadata from the PDF" });
    expect(within(merge).getByText(/less reliable than a DOI lookup/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Alpha paper");
  });

  it("mentions the DOI found in the PDF", async () => {
    const { dialog } = await openEditor({
      source: withFile(),
      routes: {
        "POST /api/sources/s1/metadata/suggest": () =>
          jsonResponse(200, { csl: { type: "book", title: "Crossref" }, origin: "doi", doi: "10.9/abc" }),
      },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Suggest from PDF" }));
    expect(await within(dialog).findByText(/A DOI \(10\.9\/abc\) was found in the PDF/)).toBeInTheDocument();
  });
});

describe("metadata editor: citation key", () => {
  it("shows the automatic key with an Edit affordance and sends a manual key", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);
    expect(d.getByText("alpha")).toBeInTheDocument();
    expect(d.getByText("Automatic")).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "Use automatic key" })).not.toBeInTheDocument();

    await userEvent.click(d.getByRole("button", { name: "Edit citation key" }));
    const input = d.getByRole("textbox", { name: "Citation key" });
    await userEvent.clear(input);
    await userEvent.type(input, "my-key_1");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ citation_key: "my-key_1" });
  });

  it("validates a manual key and blocks saving until it is valid", async () => {
    const { dialog, patches } = await openEditor();
    const d = within(dialog);
    await userEvent.click(d.getByRole("button", { name: "Edit citation key" }));
    const input = d.getByRole("textbox", { name: "Citation key" });

    await userEvent.clear(input);
    await userEvent.type(input, "Has Spaces");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    expect(await d.findByText("Use only lowercase letters, digits, - and _.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(input);
    expect(await d.findByText("Enter a citation key.")).toBeInTheDocument();

    await userEvent.type(input, "x".repeat(65));
    expect(await d.findByText("The citation key is too long.")).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    await userEvent.clear(input);
    await userEvent.type(input, "fine");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
  });

  it("does not send a key when it was not changed", async () => {
    const { dialog, patches } = await openEditor();
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit citation key" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect("citation_key" in (patches[0] as object)).toBe(false);
  });

  it("a manual key can be reset to automatic (citation_key: null)", async () => {
    const { dialog, patches } = await openEditor({
      source: pendingSource({ citation_key: "my-own", citation_key_auto: false }),
    });
    const d = within(dialog);
    expect(d.getByText("Custom")).toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Use automatic key" }));
    expect(d.getByText("Set automatically when saved")).toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { citation_key: unknown }).citation_key).toBeNull();
  });

  it("shows a translated message for a key conflict (409)", async () => {
    const { dialog } = await openEditor({
      routes: { "PATCH /api/sources/s1": () => errorResponse(409, "source.citation_key_conflict") },
    });
    const d = within(dialog);
    await userEvent.click(d.getByRole("button", { name: "Edit citation key" }));
    const input = d.getByRole("textbox", { name: "Citation key" });
    await userEvent.clear(input);
    await userEvent.type(input, "taken");
    await userEvent.click(d.getByRole("button", { name: "Save" }));
    expect(await d.findByText("Another source in this project already uses that citation key.")).toBeInTheDocument();
  });
});

describe("viewer role", () => {
  it("cannot open the metadata editor", async () => {
    mockApi({
      ...baseRoutes({ role: "viewer" }),
      "GET /api/sources/s1": () => jsonResponse(200, pendingSource()),
    });
    renderApp("/p/p1?source=s1");
    await screen.findByRole("heading", { name: "Alpha paper" });
    expect(screen.queryByRole("button", { name: "Edit metadata" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add metadata" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
});
