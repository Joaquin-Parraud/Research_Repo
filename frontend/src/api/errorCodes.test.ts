import { describe, expect, it } from "vitest";
import { resources } from "../i18n";

/** Every code the M1 backend contract can return. */
const CODES = [
  "folder.name_conflict",
  "folder.cycle",
  "folder.not_found",
  "validation.invalid",
  "source.invalid_pdf",
  "source.file_too_large",
  "source.duplicate_file",
  "source.no_file",
  "source.move_invalid",
  "source.not_found",
  "project.not_found",
  "resource.not_found",
  "auth.forbidden",
  "server.unavailable",
] as const;

describe("error code translations", () => {
  for (const language of ["en", "es"] as const) {
    it(`has a message for every contract code in ${language}`, () => {
      const catalogue: Record<string, string> = resources[language].errors;
      for (const code of CODES) {
        expect(catalogue[code], code).toBeTruthy();
      }
    });
  }

  it("translates differently in Spanish than English", () => {
    const en: Record<string, string> = resources.en.errors;
    const es: Record<string, string> = resources.es.errors;
    for (const code of CODES) expect(es[code]).not.toBe(en[code]);
  });
});
