import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Source } from "../../api/library";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import { CITATION_KEY_MAX, validateCitationKey, type CitationKeyError } from "./cslForm";
import styles from "./CitationKeyField.module.css";

export type KeyEdit = { mode: "keep" } | { mode: "set"; value: string } | { mode: "reset" };

interface Props {
  source: Pick<Source, "citation_key" | "citation_key_auto">;
  edit: KeyEdit;
  onChange: (edit: KeyEdit) => void;
  /** Whether to show validation problems (after a failed save attempt). */
  showErrors: boolean;
}

export function citationKeyProblem(edit: KeyEdit): CitationKeyError | null {
  return edit.mode === "set" ? validateCitationKey(edit.value) : null;
}

/** The automatic key with an "Edit" affordance; a manual key can be reset to the automatic one. */
export function CitationKeyField({ source, edit, onChange, showErrors }: Props) {
  const { t } = useTranslation("metadata");
  const inputId = useId();
  const hintId = useId();
  const problem = citationKeyProblem(edit);
  const editing = edit.mode === "set";
  const custom = edit.mode === "reset" ? false : editing ? true : !source.citation_key_auto;

  return (
    <div className={styles.field}>
      <div className={styles.label} id={`${inputId}-label`}>
        {t("key.label")}
      </div>
      {editing ? (
        <div className={styles.editor}>
          <input
            id={inputId}
            className={forms.input}
            value={edit.value}
            maxLength={CITATION_KEY_MAX + 8}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            aria-labelledby={`${inputId}-label`}
            aria-describedby={hintId}
            aria-invalid={showErrors && problem ? true : undefined}
            autoFocus
            onChange={(event) => onChange({ mode: "set", value: event.target.value })}
          />
          <Button size="small" onClick={() => onChange({ mode: "keep" })}>
            {t("key.cancelEdit")}
          </Button>
        </div>
      ) : (
        <div className={styles.readout}>
          <code className={styles.key} aria-labelledby={`${inputId}-label`}>
            {edit.mode === "reset" ? t("key.willBeAutomatic") : source.citation_key}
          </code>
          <span className={styles.tag}>{custom ? t("key.custom") : t("key.automatic")}</span>
          <Button
            size="small"
            onClick={() => onChange({ mode: "set", value: source.citation_key })}
            aria-label={t("key.edit")}
          >
            {t("key.editShort")}
          </Button>
        </div>
      )}
      {!source.citation_key_auto && edit.mode !== "reset" && (
        <div>
          <Button size="small" variant="ghost" onClick={() => onChange({ mode: "reset" })}>
            {t("key.reset")}
          </Button>
        </div>
      )}
      <span id={hintId} className={forms.hint}>
        {editing ? t("key.rules", { max: CITATION_KEY_MAX }) : t("key.hint")}
      </span>
      {showErrors && problem && <p className={forms.error}>{t(`validation.key.${problem}`)}</p>}
    </div>
  );
}
