import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

export function formatBytes(bytes: number, language: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: BYTE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

export function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date);
}

/** Date and size formatters bound to the active interface language. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "en";
  return useMemo(
    () => ({
      language,
      bytes: (value: number) => formatBytes(value, language),
      date: (iso: string) => formatDate(iso, language),
      compare: new Intl.Collator(language, { numeric: true, sensitivity: "base" }).compare,
    }),
    [language],
  );
}
