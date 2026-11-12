import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Source } from "../../api/library";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import { useToast } from "../../components/Toast";
import { useFormatters } from "../../hooks/useFormatters";
import { useUpdateSource } from "../library/useLibrary";
import { TagsEditor } from "./TagsEditor";
import styles from "./SourceDetails.module.css";

interface Props {
  projectId: string;
  source: Source;
  canWrite: boolean;
}

/** Title (editable), tags editor and file info for the open source. */
export function SourceDetails({ projectId, source, canWrite }: Props) {
  const { t, i18n } = useTranslation("library");
  const { bytes } = useFormatters();
  const toast = useToast();
  const update = useUpdateSource(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.title);

  function fail(error: unknown) {
    toast.show(translateError(i18n, error), "error");
  }

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title || title === source.title) {
      setEditing(false);
      return;
    }
    update.mutate({ id: source.id, input: { title } }, { onSuccess: () => setEditing(false), onError: fail });
  }

  return (
    <div className={styles.wrap}>
      {editing ? (
        <form className={styles.titleRow} onSubmit={saveTitle}>
          <input
            className={`${forms.input} ${styles.titleInput}`}
            value={draft}
            maxLength={500}
            autoFocus
            aria-label={t("details.titleLabel")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <Button size="small" variant="primary" type="submit" disabled={update.isPending}>
            {t("common:save")}
          </Button>
          <Button size="small" onClick={() => setEditing(false)}>
            {t("common:cancel")}
          </Button>
        </form>
      ) : (
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{source.title}</h3>
          {canWrite && (
            <Button
              size="small"
              onClick={() => {
                setDraft(source.title);
                setEditing(true);
              }}
            >
              {t("details.editTitle")}
            </Button>
          )}
        </div>
      )}

      <div>
        <div className={styles.label}>{t("tags.heading")}</div>
        <TagsEditor
          tags={source.tags}
          canWrite={canWrite}
          busy={update.isPending}
          onChange={(tags) => update.mutate({ id: source.id, input: { tags } }, { onError: fail })}
        />
      </div>

      <dl className={styles.facts}>
        {source.file ? (
          <>
            <div className={styles.fact}>
              <dt>{t("details.file")}</dt>
              <dd>{source.file.original_filename}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{t("details.size")}</dt>
              <dd>{bytes(source.file.size_bytes)}</dd>
            </div>
            {source.file.page_count !== null && (
              <div className={styles.fact}>
                <dt>{t("details.pages")}</dt>
                <dd>{source.file.page_count}</dd>
              </div>
            )}
          </>
        ) : (
          <div className={styles.fact}>
            <dd>{t("details.noPdf")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
