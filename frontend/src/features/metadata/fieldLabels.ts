import type { TFunction } from "i18next";
import { usesInstitutionLabel } from "./cslTypes";
import type { MergeKey } from "./cslForm";

/** The visible label of a field; some depend on the item type (Journal / Book title / Conference…). */
export function fieldLabel(t: TFunction, key: MergeKey, type: string): string {
  switch (key) {
    case "type":
      return t("field.type");
    case "title":
      return t("field.title");
    case "authors":
      return t("names.author.legend");
    case "editors":
      return t("names.editor.legend");
    case "date":
      return t("date.legend");
    case "containerTitle":
      return t(`field.containerTitle.${type}`, { defaultValue: t("field.containerTitle.document") });
    case "publisher":
      return usesInstitutionLabel(type) ? t("field.institution") : t("field.publisher");
    case "genre":
      return t(`field.genre.${type}`, { defaultValue: t("field.genre") });
    case "number":
      return t(`field.number.${type}`, { defaultValue: t("field.number") });
    default:
      return t(`field.${key}`);
  }
}

/** Label of a CSL type, falling back to the raw value for types the editor does not list. */
export function typeLabel(t: TFunction, type: string): string {
  return t(`type.${type}`, { defaultValue: type });
}
