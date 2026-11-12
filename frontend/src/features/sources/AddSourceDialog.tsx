import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useConfig } from "../config/useConfig";
import { useSourceActions } from "../library/useLibrary";
import { useAppNavigation } from "../../hooks/useAppNavigation";

interface Props {
  projectId: string;
  folderId: string | null;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}

/** Add a source: choose PDFs (several at once) or create a citation-only source. */
export function AddSourceDialog({ projectId, folderId, onFiles, onClose }: Props) {
  const { t, i18n } = useTranslation("library");
  const { createCitation } = useSourceActions(projectId);
  const { openSource } = useAppNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const config = useConfig();
  const [title, setTitle] = useState("");

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    onFiles(files);
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    createCitation.mutate(
      { title: trimmed, folderId },
      {
        onSuccess: (source) => {
          onClose();
          openSource(source.id);
        },
      },
    );
  }

  return (
    <Dialog
      title={t("sources.add.title")}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("common:close")}</Button>}
    >
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <h3 className={forms.sectionTitle}>{t("sources.add.pdfHeading")}</h3>
        <p className={forms.hint}>{t("sources.add.pdfHint")}</p>
        {config.data && (
          <p className={forms.hint}>{t("sources.add.limitHint", { max: config.data.max_upload_mb })}</p>
        )}
        <div>
          <Button variant="primary" onClick={() => inputRef.current?.click()} data-autofocus>
            {t("sources.add.choose")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            aria-label={t("sources.add.fileInput")}
            onChange={handleFiles}
          />
        </div>
      </div>

      <form className={forms.section} onSubmit={submit}>
        <h3 className={forms.sectionTitle}>{t("sources.add.citationHeading")}</h3>
        <p className={forms.hint}>{t("sources.add.citationHint")}</p>
        <label className={forms.field}>
          {t("sources.add.titleLabel")}
          <input
            className={forms.input}
            value={title}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <p role="alert" className={forms.error}>
          {createCitation.isError ? translateError(i18n, createCitation.error) : null}
        </p>
        <div>
          <Button type="submit" disabled={!title.trim() || createCitation.isPending}>
            {t("sources.add.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
