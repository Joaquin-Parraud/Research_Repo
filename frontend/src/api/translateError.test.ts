import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ApiError } from "./errors";
import { translateError } from "./translateError";

describe("translateError", () => {
  it("translates known codes in the active language", async () => {
    const error = new ApiError("auth.rate_limited", 429, "Too many");
    await i18n.changeLanguage("es");
    expect(translateError(i18n, error)).toBe(
      "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
    );
    await i18n.changeLanguage("en");
    expect(translateError(i18n, error)).toBe("Too many attempts. Please wait a moment and try again.");
  });

  it("falls back to the generic message for unknown codes, ignoring the English message", async () => {
    await i18n.changeLanguage("es");
    const text = translateError(i18n, new ApiError("brand.new_code", 400, "English only"));
    expect(text).toBe("Algo salió mal. Inténtalo de nuevo.");
  });

  it("handles network and non-API errors", () => {
    expect(translateError(i18n, new ApiError("network", 0, "x"))).toMatch(/Could not reach/);
    expect(translateError(i18n, new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
