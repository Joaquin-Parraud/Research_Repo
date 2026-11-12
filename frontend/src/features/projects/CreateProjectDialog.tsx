import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import forms from "../../components/Form.module.css";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useCreateProject } from "./useProjects";

export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation("library");
  const create = useCreateProject();
  const { toProject } = useAppNavigation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, description: description.trim() || undefined },
      {
        onSuccess: (project) => {
          onClose();
          toProject(project.id);
        },
      },
    );
  }

  return (
    <Dialog
      title={t("projects.create.title")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common:cancel")}</Button>
          <Button variant="primary" type="submit" form="create-project-form" disabled={create.isPending || !name.trim()}>
            {t("projects.create.submit")}
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
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
        <p role="alert" className={forms.error}>
          {create.isError ? translateError(i18n, create.error) : null}
        </p>
      </form>
    </Dialog>
  );
}
