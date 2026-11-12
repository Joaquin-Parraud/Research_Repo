import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Source } from "../../api/library";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import { useToast } from "../../components/Toast";
import { useFormatters } from "../../hooks/useFormatters";
import { CitationPanel } from "../citation/CitationPanel";
import { useUpdateSource } from "../library/useLibrary";
import { MetadataEditor } from "../metadata/MetadataEditor";
import { StatusBadge } from "../metadata/StatusBadge";
import { useUploadValidation } from "../upload/useUploadFiles";
import { useUploadItems, useUploadQueue } from "../upload/UploadProvider";
import { TagsEditor } from "./TagsEditor";
import styles from "./SourceDetails.module.css";

interface Props {
  projectId: string;
  source: Source;
  canWrite: boolean;
}

/** Title (editable), metadata status and editor, tags, file info, attach-PDF and the citation panel. */
export function SourceDetails({ projectId, source, canWrite }: Props) {
  const { t, i18n } = useTranslation("library");
  const { t: tm } = useTranslation("metadata");
  const queue = useUploadQueue();
  const validate = useUploadValidation();
  const attachInput = useRef<HTMLInputElement>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const attaching = useUploadItems().find(
    (item) =>
      item.attachToSourceId === source.id &&
      (item.status === "queued" || item.status === "uploading" || item.status === "processing"),
  );

  function attachFile(event: ChangeEvent<HTMLInputElement>) {
    const [file] = validate(Array.from(event.target.files ?? []).slice(0, 1));
    event.target.value = "";
    if (file) queue.attach(projectId, source.id, file);
  }

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

      <div className={styles.metaRow}>
        <StatusBadge status={source.metadata_status} />
        {canWrite && (
          <Button
            size="small"
            variant={source.metadata_status === "confirmed" ? "default" : "primary"}
            onClick={() => setEditingMetadata(true)}
          >
            {tm("details.editMetadata")}
          </Button>
        )}
        {canWrite && !source.has_file && (
          <>
            <Button size="small" disabled={attaching !== undefined} onClick={() => attachInput.current?.click()}>
              {tm("details.attachPdf")}
            </Button>
            <input
              ref={attachInput}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              aria-label={tm("details.attachInput")}
              onChange={attachFile}
            />
          </>
        )}
        {attaching && (
          <span role="status" className={styles.progress}>
            {attaching.status === "processing"
              ? t("upload.status.processing")
              : t("upload.status.uploading", { percent: Math.round(attaching.progress * 100) })}
          </span>
        )}
      </div>

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

      <CitationPanel
        projectId={projectId}
        sourceId={source.id}
        updatedAt={source.updated_at}
        status={source.metadata_status}
        onEditMetadata={canWrite ? () => setEditingMetadata(true) : undefined}
      />

      {editingMetadata && (
        <MetadataEditor projectId={projectId} source={source} onClose={() => setEditingMetadata(false)} />
      )}
    </div>
  );
}
