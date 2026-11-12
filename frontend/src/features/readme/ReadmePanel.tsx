import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { useDirtyFlag } from "../../hooks/useUnsavedChanges";
import { Markdown } from "./Markdown";
import { useReadme, useSaveReadme } from "../projects/useProjects";
import styles from "./ReadmePanel.module.css";

interface Props {
  projectId: string;
  canEdit: boolean;
}

type EditTab = "write" | "preview";

/** The project front page: README rendered, with an edit mode for editors and owners. */
export function ReadmePanel({ projectId, canEdit }: Props) {
  const { t, i18n } = useTranslation("library");
  const readme = useReadme(projectId);
  const save = useSaveReadme(projectId);
  const [draft, setDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<EditTab>("write");

  const saved = readme.data?.readme_md ?? "";
  const editing = draft !== null;
  useDirtyFlag(`readme:${projectId}`, editing && draft !== saved);

  if (readme.isPending) return <p className={styles.message}>{t("common:loading")}</p>;
  if (readme.isError) {
    return (
      <div role="alert" className={styles.message}>
        {translateError(i18n, readme.error)}{" "}
        <Button size="small" onClick={() => void readme.refetch()}>
          {t("common:retry")}
        </Button>
      </div>
    );
  }

  function startEditing() {
    setDraft(saved);
    setTab("write");
    save.reset();
  }

  function submit() {
    if (draft === null) return;
    save.mutate(draft, { onSuccess: () => setDraft(null) });
  }

  if (draft === null) {
    return (
      <div className={styles.wrap}>
        {canEdit && (
          <div className={styles.toolbar}>
            <span />
            <Button size="small" onClick={startEditing}>
              {saved.trim() ? t("readme.edit") : t("readme.write")}
            </Button>
          </div>
        )}
        <div className={styles.content}>
          {saved.trim() ? (
            <Markdown source={saved} />
          ) : (
            <div className={styles.emptyWrap}>
              <EmptyState
                title={t("readme.empty.title")}
                body={canEdit ? t("readme.empty.bodyEditor") : t("readme.empty.bodyViewer")}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label={t("readme.editorTabs")}>
          <Button
            size="small"
            variant={tab === "write" ? "primary" : "default"}
            role="tab"
            aria-selected={tab === "write"}
            onClick={() => setTab("write")}
          >
            {t("readme.tab.write")}
          </Button>
          <Button
            size="small"
            variant={tab === "preview" ? "primary" : "default"}
            role="tab"
            aria-selected={tab === "preview"}
            onClick={() => setTab("preview")}
          >
            {t("readme.tab.preview")}
          </Button>
        </div>
        <div className={styles.actions}>
          <Button size="small" onClick={() => setDraft(null)} disabled={save.isPending}>
            {t("common:cancel")}
          </Button>
          <Button size="small" variant="primary" onClick={submit} disabled={save.isPending}>
            {t("common:save")}
          </Button>
        </div>
      </div>
      <div className={styles.content}>
        {tab === "write" ? (
          <textarea
            className={styles.textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t("readme.textareaLabel")}
          />
        ) : draft.trim() ? (
          <Markdown source={draft} />
        ) : (
          <p className={styles.message}>{t("readme.previewEmpty")}</p>
        )}
      </div>
      {save.isError && (
        <p role="alert" className={styles.error}>
          {translateError(i18n, save.error)}
        </p>
      )}
    </div>
  );
}
