import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TagsEditor.module.css";
import { addTag, removeTag } from "./tags";

interface Props {
  tags: readonly string[];
  canWrite: boolean;
  busy: boolean;
  /** Called with the complete new tag set. */
  onChange: (tags: string[]) => void;
}

export function TagsEditor({ tags, canWrite, busy, onChange }: Props) {
  const { t } = useTranslation("library");
  const [draft, setDraft] = useState("");

  function commit() {
    const next = addTag(tags, draft);
    setDraft("");
    if (next !== tags) onChange([...next]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      const last = tags[tags.length - 1];
      if (last !== undefined) onChange(removeTag(tags, last));
    }
  }

  return (
    <div className={styles.wrap} role="group" aria-label={t("tags.label")}>
      {tags.length === 0 && !canWrite && <span className={styles.none}>{t("tags.none")}</span>}
      {tags.map((tag) => (
        <span key={tag} className={`${styles.chip} ${canWrite ? "" : styles.chipPlain}`}>
          {tag}
          {canWrite && (
            <button
              type="button"
              className={styles.remove}
              aria-label={t("tags.remove", { tag })}
              disabled={busy}
              onClick={() => onChange(removeTag(tags, tag))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {canWrite && (
        <input
          className={styles.input}
          value={draft}
          placeholder={t("tags.placeholder")}
          aria-label={t("tags.add")}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
      )}
    </div>
  );
}
