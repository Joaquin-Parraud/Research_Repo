import { useTranslation } from "react-i18next";
import type { User } from "../api/auth";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { Pane } from "../components/Pane";
import { ToastProvider } from "../components/Toast";
import { ArchivedBanner } from "../features/projects/ArchivedBanner";
import { ArchivedConflictWatcher } from "../features/projects/ArchivedConflictWatcher";
import { ProjectList } from "../features/projects/ProjectList";
import { UploadPanel } from "../features/upload/UploadPanel";
import { UploadProvider } from "../features/upload/UploadProvider";
import { useSidebar } from "../hooks/useSidebar";
import { useRouteSelection } from "../hooks/useAppNavigation";
import { UnsavedChangesProvider } from "../hooks/useUnsavedChanges";
import styles from "./AppShell.module.css";
import { ProjectWorkspace } from "./ProjectWorkspace";

const SIDEBAR_ID = "project-sidebar";

function HomePanes() {
  const { t } = useTranslation("shell");
  return (
    <>
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
  const { t } = useTranslation("shell");
  const sidebar = useSidebar();

  return (
    <ToastProvider>
      <UnsavedChangesProvider>
        <UploadProvider>
          <div className={styles.shell}>
            <Header
              user={user}
              sidebarOpen={sidebar.open}
              sidebarId={SIDEBAR_ID}
              onToggleSidebar={sidebar.toggle}
            />
            <ArchivedConflictWatcher />
            <div className={styles.body}>
              {sidebar.overlay && sidebar.open && (
                <div className={styles.backdrop} data-testid="sidebar-backdrop" onClick={sidebar.close} />
              )}
              <aside
                id={SIDEBAR_ID}
                className={`${styles.sidebar} ${sidebar.overlay ? styles.overlay : ""}`}
                aria-label={t("projects.title")}
                hidden={!sidebar.open}
              >
                <Pane title={t("projects.title")}>
                  <ProjectList selectedId={projectId} onSelect={sidebar.onProjectChosen} />
                </Pane>
              </aside>
              <main className={styles.main}>
                {projectId && <ArchivedBanner projectId={projectId} />}
                <div className={`${styles.panes} ${projectId ? "" : styles.home}`}>
                  {projectId ? (
                    <ProjectWorkspace projectId={projectId} folderId={folderId} sourceId={sourceId} />
                  ) : (
                    <HomePanes />
                  )}
                </div>
              </main>
            </div>
          </div>
          <UploadPanel />
        </UploadProvider>
      </UnsavedChangesProvider>
    </ToastProvider>
  );
}
