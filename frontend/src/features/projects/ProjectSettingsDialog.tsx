import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CitationLocale, Project } from "../../api/projects";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { CopyProjectDialog } from "./CopyProjectDialog";
import { useDeleteProject, useUpdateProject } from "./useProjects";

interface Props {
  project: Project;
  onClose: () => void;
}

export function ProjectSettingsDialog({ project, onClose }: Props) {
  const { t, i18n } = useTranslation("library");
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject(project.id);
  const { toHome } = useAppNavigation();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [locale, setLocale] = useState<CitationLocale>(project.citation_locale);
  const [confirmName, setConfirmName] = useState("");
  const [copying, setCopying] = useState(false);
  const archived = project.archived_at !== null;

  function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    update.mutate(
      { name: trimmed, description: description.trim(), citation_locale: locale },
      { onSuccess: onClose },
    );
  }

  const error = update.isError ? update.error : remove.isError ? remove.error : null;

  return (
    <Dialog
      title={t("projects.settings.title")}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{archived ? t("common:close") : t("common:cancel")}</Button>
          {!archived && (
            <Button variant="primary" type="submit" form="project-settings-form" disabled={update.isPending || !name.trim()}>
              {t("common:save")}
            </Button>
          )}
        </>
      }
    >
      {archived && <p className={forms.hint}>{t("projects.settings.archivedNote")}</p>}
      {!archived && (
      <form id="project-settings-form" onSubmit={save} style={{ display: "grid", gap: "0.75rem" }}>
        <label className={forms.field}>
          {t("projects.field.name")}
          <input
            className={forms.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
            data-autofocus
          />
        </label>
        <label className={forms.field}>
          {t("projects.field.description")}
          <textarea
            className={forms.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className={forms.field}>
          <label htmlFor="project-citation-locale">{t("projects.field.citationLocale")}</label>
          <select
            id="project-citation-locale"
            className={forms.select}
            value={locale}
            aria-describedby="project-citation-locale-hint"
            onChange={(event) => setLocale(event.target.value === "es" ? "es" : "en-US")}
          >
            <option value="en-US">{t("projects.locale.en-US")}</option>
            <option value="es">{t("projects.locale.es")}</option>
          </select>
          <span id="project-citation-locale-hint" className={forms.hint}>
            {t("projects.field.citationLocaleHint")}
          </span>
        </div>
      </form>
      )}

      <div className={forms.section}>
        <h3 className={forms.sectionTitle}>{t("projects.copy.title")}</h3>
        <p className={forms.hint}>{t("projects.copy.description")}</p>
        <div>
          <Button onClick={() => setCopying(true)}>{t("projects.copy.action")}</Button>
        </div>
      </div>

      <div className={forms.section}>
        <h3 className={forms.sectionTitle}>
          {archived ? t("projects.unarchive.title") : t("projects.archive.title")}
        </h3>
        <p className={forms.hint}>
          {archived ? t("projects.unarchive.body") : t("projects.archive.body")}
        </p>
        <div>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({ archived: !archived }, { onSuccess: onClose })}
          >
            {archived ? t("projects.unarchive.action") : t("projects.archive.action")}
          </Button>
        </div>
      </div>

      <div className={forms.section}>
        <h3 className={forms.sectionTitle}>{t("projects.delete.title")}</h3>
        <p className={forms.hint}>{t("projects.delete.body")}</p>
        <label className={forms.field}>
          {t("projects.delete.confirmLabel", { name: project.name })}
          <input
            className={forms.input}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div>
          <Button
            variant="danger"
            disabled={confirmName !== project.name || remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  toHome();
                },
              })
            }
          >
            {t("projects.delete.action")}
          </Button>
        </div>
      </div>

      <p role="alert" className={forms.error}>
        {error ? translateError(i18n, error) : null}
      </p>
      {copying && <CopyProjectDialog project={project} onClose={() => setCopying(false)} onCopied={onClose} />}
    </Dialog>
  );
}
