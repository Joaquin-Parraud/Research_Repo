import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import { useFormatters } from "../../hooks/useFormatters";
import { CSL_TYPES, isKnownType, showsField, type FieldKey } from "./cslTypes";
import type { FormError, FormErrorField, MetadataForm } from "./cslForm";
import { fieldLabel, typeLabel } from "./fieldLabels";
import { NamesEditor } from "./NamesEditor";
import styles from "./MetadataFields.module.css";

interface Props {
  form: MetadataForm;
  onChange: (patch: Partial<MetadataForm>) => void;
  errors: readonly FormError[];
  showErrors: boolean;
  /** Whether the "Look up DOI" action is offered at all (the server can switch lookups off). */
  lookupEnabled: boolean;
  lookupBusy: boolean;
  onLookup: () => void;
}

type TextKey = Exclude<FieldKey, "editors" | "accessed">;

/** The type-dependent part of the editor: only the fields that make sense for the chosen CSL type are shown. */
export function MetadataFields({ form, onChange, errors, showErrors, lookupEnabled, lookupBusy, onLookup }: Props) {
  const { t } = useTranslation("metadata");
  const { language } = useFormatters();
  const type = form.type;
  const show = (field: FieldKey) => showsField(type, field);
  const errorsFor = (field: FormErrorField) => (showErrors ? errors.filter((error) => error.field === field) : []);

  const text = (key: TextKey, extra?: { wide?: boolean; hint?: string; action?: ReactNode; inputMode?: "url" }) =>
    show(key) && (
      <TextField
        key={key}
        label={fieldLabel(t, key, type)}
        value={form[key]}
        wide={extra?.wide}
        hint={extra?.hint}
        action={extra?.action}
        inputMode={extra?.inputMode}
        error={key === "url" ? errorsFor("url")[0] : undefined}
        onChange={(value) => onChange({ [key]: value })}
      />
    );

  const months = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(language, { month: "long" }).format(new Date(2000, index, 1)),
  );
  const dateErrors = errorsFor("date");
  const yearMissing = !form.noDate && !form.year.trim();

  return (
    <div className={styles.fields}>
      <label className={forms.field}>
        {t("field.type")}
        <select
          className={forms.select}
          value={form.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          {!isKnownType(form.type) && <option value={form.type}>{typeLabel(t, form.type)}</option>}
          {CSL_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabel(t, value)}
            </option>
          ))}
        </select>
      </label>

      <TextField
        label={t("field.title")}
        value={form.title}
        wide
        required
        error={errorsFor("title")[0]}
        onChange={(value) => onChange({ title: value })}
      />

      <div className={styles.wide}>
        <NamesEditor
          role="author"
          entries={form.authors}
          errors={errorsFor("authors")}
          onChange={(authors) => onChange({ authors })}
        />
      </div>
      {show("editors") && (
        <div className={styles.wide}>
          <NamesEditor
            role="editor"
            entries={form.editors}
            errors={errorsFor("editors")}
            onChange={(editors) => onChange({ editors })}
          />
        </div>
      )}

      <fieldset className={`${styles.wide} ${styles.date}`}>
        <legend className={styles.legend}>{t("date.legend")}</legend>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={form.noDate}
            onChange={(event) => onChange({ noDate: event.target.checked })}
          />
          {t("date.none")}
        </label>
        <div className={styles.dateRow}>
          <label className={forms.field}>
            {t("date.year")}
            <input
              className={forms.input}
              value={form.year}
              inputMode="numeric"
              maxLength={4}
              disabled={form.noDate}
              onChange={(event) => onChange({ year: event.target.value })}
            />
          </label>
          <label className={forms.field}>
            {t("date.month")}
            <select
              className={forms.select}
              value={form.month}
              disabled={form.noDate}
              onChange={(event) => onChange({ month: event.target.value })}
            >
              <option value="">{t("date.optional")}</option>
              {months.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={forms.field}>
            {t("date.day")}
            <input
              className={forms.input}
              value={form.day}
              inputMode="numeric"
              maxLength={2}
              disabled={form.noDate}
              placeholder={t("date.optional")}
              onChange={(event) => onChange({ day: event.target.value })}
            />
          </label>
        </div>
        {dateErrors[0] && <p className={forms.error}>{t(`validation.${dateErrors[0].code}`)}</p>}
        {yearMissing && <p className={forms.hint}>{t("date.missingHint")}</p>}
      </fieldset>

      {text("containerTitle", { wide: true })}
      {text("volume")}
      {text("issue")}
      {text("page")}
      {text("edition")}
      {text("number")}
      {text("version")}
      {text("publisher", { wide: true })}
      {text("publisherPlace")}
      {text("genre", { wide: true })}
      {text("doi", {
        wide: true,
        action: lookupEnabled && (
          <Button size="small" disabled={!form.doi.trim() || lookupBusy} onClick={onLookup}>
            {lookupBusy ? t("lookup.busy") : t("lookup.button")}
          </Button>
        ),
      })}
      {text("url", { wide: true, inputMode: "url" })}
      {show("accessed") && (
        <label className={forms.field}>
          {t("field.accessed")}
          <input
            className={forms.input}
            type="date"
            value={form.accessed}
            onChange={(event) => onChange({ accessed: event.target.value })}
          />
        </label>
      )}
      {text("language", { hint: t("field.languageHint") })}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean | undefined;
  required?: boolean;
  hint?: string | undefined;
  action?: ReactNode;
  inputMode?: "url" | undefined;
  error?: FormError | undefined;
}

function TextField({ label, value, onChange, wide, required, hint, action, inputMode, error }: TextFieldProps) {
  const { t } = useTranslation("metadata");
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={`${forms.field} ${wide ? styles.wide : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputRow}>
        <input
          id={id}
          className={forms.input}
          value={value}
          required={required}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {action}
      </div>
      {hint && (
        <span id={hintId} className={forms.hint}>
          {hint}
        </span>
      )}
      {error && (
        <p id={errorId} className={forms.error}>
          {t(`validation.${error.code}`)}
        </p>
      )}
    </div>
  );
}
