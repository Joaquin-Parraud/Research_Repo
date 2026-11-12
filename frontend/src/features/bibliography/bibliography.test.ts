import { describe, expect, it } from "vitest";
import {
  bibliographyFile,
  bibliographyText,
  buildBibliographyRequest,
  safeFilenamePart,
  type BibliographyScope,
} from "./bibliography";

const scope = (overrides: Partial<BibliographyScope>): BibliographyScope => ({
  kind: "project",
  sourceIds: [],
  folderId: null,
  includeSubfolders: false,
  ...overrides,
});

describe("buildBibliographyRequest", () => {
  it("whole project: neither source_ids nor folder_id", () => {
    const body = buildBibliographyRequest(scope({ kind: "project", sourceIds: ["a"], folderId: "f" }), "text");
    expect(body).toEqual({ format: "text" });
    expect("source_ids" in body).toBe(false);
    expect("folder_id" in body).toBe(false);
  });

  it("selection: source_ids only", () => {
    expect(buildBibliographyRequest(scope({ kind: "sources", sourceIds: ["a", "b"] }), "bibtex")).toEqual({
      format: "bibtex",
      source_ids: ["a", "b"],
    });
  });

  it("folder: folder_id and include_subfolders", () => {
    expect(buildBibliographyRequest(scope({ kind: "folder", folderId: "f1", includeSubfolders: true }), "csl")).toEqual({
      format: "csl",
      folder_id: "f1",
      include_subfolders: true,
    });
    expect(buildBibliographyRequest(scope({ kind: "folder", folderId: "f1" }), "html")).toEqual({
      format: "html",
      folder_id: "f1",
      include_subfolders: false,
    });
  });
});

describe("export files", () => {
  it("uses a sensible extension and MIME type per format", () => {
    expect(bibliographyFile("text", "Thesis")).toEqual({
      filename: "thesis-bibliography.txt",
      mime: "text/plain;charset=utf-8",
    });
    expect(bibliographyFile("html", "x").filename).toMatch(/\.html$/);
    expect(bibliographyFile("bibtex", "x")).toMatchObject({ filename: "x-bibliography.bib" });
    expect(bibliographyFile("bibtex", "x").mime).toMatch(/bibtex/);
    expect(bibliographyFile("csl", "x")).toMatchObject({
      filename: "x-bibliography.json",
      mime: "application/vnd.citationstyles.csl+json;charset=utf-8",
    });
  });

  it("makes file-system-safe names from folder and project names", () => {
    expect(safeFilenamePart("Teoría & Métodos / 2024")).toBe("teoria-metodos-2024");
    expect(safeFilenamePart("???")).toBe("bibliography");
    expect(safeFilenamePart("x".repeat(100))).toHaveLength(60);
  });

  it("pretty-prints CSL-JSON arrays and passes strings through", () => {
    expect(bibliographyText({ content: "plain" })).toBe("plain");
    expect(bibliographyText({ content: [{ id: "a" }] })).toBe('[\n  {\n    "id": "a"\n  }\n]');
  });
});
