import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "../../api/projects";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useCopyProject } from "./useProjects";

interface Props {
  project: Pick<Project, "id" | "name">;
  onClose: () => void;
  /** Called after the copy exists, before navigating to it (lets a parent dialog close too). */
  onCopied?: () => void;
}

/** Asks for the new project's name (prefilled "<name> (copy)"), copies, and opens the copy. */
export function CopyProjectDialog({ project, onClose, onCopied }: Props) {
  const { t, i18n } = useTranslation("library");
  const copy = useCopyProject(project.id);
  const { toProject } = useAppNavigation();
  const [name, setName] = useState(() => t("projects.copy.defaultName", { name: project.name }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    copy.mutate(trimmed, {
      onSuccess: (created) => {
        onCopied?.();
        onClose();
        toProject(created.id);
      },
    });
  }

  return (
    <Dialog
      title={t("projects.copy.title")}
      description={t("projects.copy.description")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common:cancel")}</Button>
          <Button variant="primary" type="submit" form="copy-project-form" disabled={copy.isPending || !name.trim()}>
            {t("projects.copy.submit")}
          </Button>
        </>
      }
    >
      <form id="copy-project-form" onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
        <label className={forms.field}>
          {t("projects.copy.nameLabel")}
          <input
            className={forms.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
            data-autofocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <p role="alert" className={forms.error}>
          {copy.isError ? translateError(i18n, copy.error) : null}
        </p>
      </form>
    </Dialog>
  );
}
