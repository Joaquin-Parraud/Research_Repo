import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "./api/auth";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enLibrary from "./locales/en/library.json";
import enMetadata from "./locales/en/metadata.json";
import enShell from "./locales/en/shell.json";
import enViewer from "./locales/en/viewer.json";
import esAuth from "./locales/es/auth.json";
import esCommon from "./locales/es/common.json";
import esErrors from "./locales/es/errors.json";
import esLibrary from "./locales/es/library.json";
import esMetadata from "./locales/es/metadata.json";
import esShell from "./locales/es/shell.json";
import esViewer from "./locales/es/viewer.json";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["en", "es"];

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Browser language reduced to a supported language, defaulting to English. */
export function detectBrowserLanguage(): Language {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split("-")[0] ?? "";
    if (isLanguage(base)) return base;
  }
  return "en";
}

export const resources = {
  en: { auth: enAuth, common: enCommon, errors: enErrors, library: enLibrary, metadata: enMetadata, shell: enShell, viewer: enViewer },
  es: { auth: esAuth, common: esCommon, errors: esErrors, library: esLibrary, metadata: esMetadata, shell: esShell, viewer: esViewer },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: detectBrowserLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "auth", "shell", "errors", "library", "viewer", "metadata"],
  keySeparator: false,
  interpolation: { escapeValue: false },
});

export default i18n;
