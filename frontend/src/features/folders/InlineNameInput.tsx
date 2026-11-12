import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import forms from "../../components/Form.module.css";
import styles from "./FolderTree.module.css";

interface Props {
  initial: string;
  label: string;
  error: string | null;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Small inline text input: Enter saves, Escape or leaving the field cancels. */
export function InlineNameInput({ initial, label, error, busy, onSubmit, onCancel }: Props) {
  const { t } = useTranslation("library");
  const [value, setValue] = useState(initial);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation(); // keep tree keyboard shortcuts out of the text field
    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !busy) onSubmit(trimmed);
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className={styles.inlineWrap}>
      <input
        className={`${forms.input} ${styles.inlineInput}`}
        value={value}
        aria-label={label}
        autoFocus
        maxLength={200}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        onFocus={(event) => event.currentTarget.select()}
        aria-invalid={error ? true : undefined}
      />
      <span className={forms.hint}>{t("folders.inlineHint")}</span>
      {error && (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      )}
    </div>
  );
}
