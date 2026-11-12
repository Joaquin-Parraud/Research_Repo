import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BibliographyFormat } from "../../api/citations";
import type { Folder } from "../../api/library";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useToast } from "../../components/Toast";
import { copyText } from "../citation/clipboard";
import {
  bibliographyFile,
  bibliographyText,
  buildBibliographyRequest,
  type ScopeKind,
} from "./bibliography";
import { downloadTextFile } from "./download";
import { useBibliography } from "./useBibliography";
import styles from "./BibliographyDialog.module.css";

interface Props {
  project: { id: string; name: string; slug: string };
  folders: readonly Folder[];
  /** The folder being browsed; `null` is the project root (offered only as "whole project"). */
  folderId: string | null;
  selectedIds: readonly string[];
  initialScope: ScopeKind;
  onClose: () => void;
}

const FORMATS: readonly BibliographyFormat[] = ["text", "html", "bibtex", "csl"];

/** Export a bibliography for the selection, a folder or the whole project: preview, copy, download. */
export function BibliographyDialog({ project, folders, folderId, selectedIds, initialScope, onClose }: Props) {
  const { t, i18n } = useTranslation("metadata");
  const toast = useToast();
  const scopeName = useId();
  const folder = folderId ? folders.find((candidate) => candidate.id === folderId) : undefined;

  const available: ScopeKind[] = [
    ...(selectedIds.length > 0 ? (["sources"] as const) : []),
    ...(folder ? (["folder"] as const) : []),
    "project",
  ];
  const [kind, setKind] = useState<ScopeKind>(available.includes(initialScope) ? initialScope : "project");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [format, setFormat] = useState<BibliographyFormat>("text");

  const request = buildBibliographyRequest(
    { kind, sourceIds: selectedIds, folderId: folder?.id ?? null, includeSubfolders },
    format,
  );
  const result = useBibliography(project.id, request);
  const data = result.data;
  const content = data ? bibliographyText(data) : "";
  const empty = data !== undefined && data.count === 0;

  const label = kind === "folder" && folder ? folder.name : project.slug || project.name;

  async function copy() {
    const ok = await copyText(content);
    toast.show(ok ? t("bibliography.copied") : t("citation.copyFailed"), ok ? "info" : "error");
  }

  function download() {
    const { filename, mime } = bibliographyFile(format, label);
    downloadTextFile(filename, mime, content);
  }

  return (
    <Dialog
      title={t("bibliography.title")}
      description={t("bibliography.description")}
      onClose={onClose}
      xwide
      footer={
        <>
          <Button onClick={onClose}>{t("common:close")}</Button>
          <Button disabled={!data || empty} onClick={() => void copy()}>
            {t("bibliography.copy")}
          </Button>
          <Button variant="primary" disabled={!data || empty} onClick={download}>
            {t("bibliography.download")}
          </Button>
        </>
      }
    >
      <fieldset className={styles.scope}>
        <legend className={styles.legend}>{t("bibliography.scope")}</legend>
        {available.map((option) => (
          <label key={option} className={styles.radio}>
            <input
              type="radio"
              name={scopeName}
              checked={kind === option}
              onChange={() => setKind(option)}
              data-autofocus={option === kind ? "" : undefined}
            />
            {option === "sources"
              ? t("bibliography.scopeSources", { count: selectedIds.length })
              : option === "folder"
                ? t("bibliography.scopeFolder", { name: folder?.name ?? "" })
                : t("bibliography.scopeProject", { name: project.name })}
          </label>
        ))}
        {kind === "folder" && (
          <label className={`${styles.radio} ${styles.nested}`}>
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(event) => setIncludeSubfolders(event.target.checked)}
            />
            {t("bibliography.includeSubfolders")}
          </label>
        )}
      </fieldset>

      <label className={forms.field}>
        {t("bibliography.format")}
        <select
          className={forms.select}
          value={format}
          onChange={(event) => setFormat(FORMATS.find((option) => option === event.target.value) ?? "text")}
        >
          {FORMATS.map((option) => (
            <option key={option} value={option}>
              {t(`bibliography.format.${option}`)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.preview} aria-busy={result.isFetching}>
        {result.isPending && <p role="status">{t("bibliography.loading")}</p>}
        {result.isError && (
          <p role="alert" className={forms.error}>
            {translateError(i18n, result.error)}
          </p>
        )}
        {data && (
          <p role="status" className={styles.count}>
            {t("bibliography.count", { count: data.count })}
          </p>
        )}
        {empty && <p className={forms.hint}>{t("bibliography.empty")}</p>}
        {data && !empty && (
          <pre className={styles.pre} tabIndex={0} aria-label={t("bibliography.previewLabel")}>
            {content}
          </pre>
        )}
      </div>
    </Dialog>
  );
}
