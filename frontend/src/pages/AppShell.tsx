import { useTranslation } from "react-i18next";
import type { User } from "../api/auth";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { Pane } from "../components/Pane";
import { ToastProvider } from "../components/Toast";
import { ProjectList } from "../features/projects/ProjectList";
import { UploadPanel } from "../features/upload/UploadPanel";
import { UploadProvider } from "../features/upload/UploadProvider";
import { useRouteSelection } from "../hooks/useAppNavigation";
import { UnsavedChangesProvider } from "../hooks/useUnsavedChanges";
import styles from "./AppShell.module.css";
import { ProjectWorkspace } from "./ProjectWorkspace";

function HomePanes() {
  const { t } = useTranslation("shell");
  return (
    <>
      <div className={styles.left}>
        <div className={styles.projects}>
          <Pane title={t("projects.title")}>
            <ProjectList selectedId={null} />
          </Pane>
        </div>
      </div>
      <div className={styles.middle}>
        <Pane title={t("sources.title")}>
          <EmptyState title={t("sources.empty.title")} body={t("sources.empty.body")} />
        </Pane>
      </div>
      <div className={styles.right}>
        <Pane title={t("viewer.title")}>
          <EmptyState title={t("viewer.empty.title")} body={t("viewer.empty.body")} />
        </Pane>
      </div>
    </>
  );
}

export function AppShell({ user }: { user: User }) {
  const { projectId, folderId, sourceId } = useRouteSelection();

  return (
    <ToastProvider>
      <UnsavedChangesProvider>
        <UploadProvider>
          <div className={styles.shell}>
            <Header user={user} />
            <main className={styles.panes}>
              {projectId ? (
                <ProjectWorkspace projectId={projectId} folderId={folderId} sourceId={sourceId} />
              ) : (
                <HomePanes />
              )}
            </main>
          </div>
          <UploadPanel />
        </UploadProvider>
      </UnsavedChangesProvider>
    </ToastProvider>
  );
}
