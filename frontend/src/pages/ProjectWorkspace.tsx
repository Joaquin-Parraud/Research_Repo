import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../api/translateError";
import { AppLink } from "../components/AppLink";
import { EmptyState } from "../components/EmptyState";
import { Pane } from "../components/Pane";
import { FolderTree } from "../features/folders/FolderTree";
import { LibraryDnd } from "../features/folders/LibraryDnd";
import { useExpandedFolders } from "../features/folders/useExpandedFolders";
import { useTree } from "../features/library/useLibrary";
import { BibliographyDialog } from "../features/bibliography/BibliographyDialog";
import { Button } from "../components/Button";
import { ProjectList } from "../features/projects/ProjectList";
import { useProjectAccess } from "../features/projects/useProjectAccess";
import { useProject } from "../features/projects/useProjects";
import { ReadmePanel } from "../features/readme/ReadmePanel";
import { SourceList } from "../features/sources/SourceList";
import { SourcePane } from "../features/sources/SourcePane";
import styles from "./AppShell.module.css";

interface Props {
  projectId: string;
  folderId: string | null;
  sourceId: string | null;
}

/** The three panes for one selected project. */
export function ProjectWorkspace({ projectId, folderId, sourceId }: Props) {
  const { t, i18n } = useTranslation("shell");
  const project = useProject(projectId);
  const tree = useTree(projectId);
  const expansion = useExpandedFolders(projectId);
  const access = useProjectAccess(projectId);
  // One derived flag for every write affordance: role allows it AND the project is not archived.
  const writable = access?.canWrite ?? false;
  const [exportingProject, setExportingProject] = useState(false);

  const leftTop = (
    <div className={styles.projects}>
      <Pane title={t("projects.title")}>
        <ProjectList selectedId={projectId} />
      </Pane>
    </div>
  );

  if (project.isError) {
    return (
      <>
        <div className={styles.left}>{leftTop}</div>
        <div className={styles.wide}>
          <Pane title={t("projects.title")}>
            <EmptyState
              title={t("projects.unavailable")}
              body={translateError(i18n, project.error)}
            />
            <p style={{ textAlign: "center" }}>
              <AppLink to="/">{t("projects.backToList")}</AppLink>
            </p>
          </Pane>
        </div>
      </>
    );
  }

  return (
    <LibraryDnd
      projectId={projectId}
      folders={tree.data?.folders ?? []}
      sources={tree.data?.sources ?? []}
      onFolderReceived={(folderId) => expansion.expand([folderId])}
    >
      <div className={styles.left}>
        {leftTop}
        <div className={styles.folders}>
          <Pane title={t("folders.title")}>
            {tree.data && project.data ? (
              <>
                <FolderTree
                  projectId={projectId}
                  tree={tree.data}
                  selectedFolderId={folderId}
                  canWrite={writable}
                  expansion={expansion}
                />
                <div className={styles.paneFooter}>
                  <Button size="small" onClick={() => setExportingProject(true)}>
                    {t("metadata:bibliography.exportProject")}
                  </Button>
                </div>
                {exportingProject && (
                  <BibliographyDialog
                    project={project.data}
                    folders={tree.data.folders}
                    folderId={folderId}
                    selectedIds={[]}
                    initialScope="project"
                    onClose={() => setExportingProject(false)}
                  />
                )}
              </>
            ) : tree.isError ? (
              <EmptyState body={translateError(i18n, tree.error)} />
            ) : (
              <p className={styles.status}>{t("common:loading")}</p>
            )}
          </Pane>
        </div>
      </div>
      <div className={styles.middle}>
        <Pane title={t("sources.title")}>
          {tree.data && project.data ? (
            <SourceList
              project={project.data}
              projectId={projectId}
              folderId={folderId}
              tree={tree.data}
              canWrite={writable}
              openSourceId={sourceId}
            />
          ) : tree.isError ? (
            <EmptyState body={translateError(i18n, tree.error)} />
          ) : (
            <p className={styles.status}>{t("common:loading")}</p>
          )}
        </Pane>
      </div>
      <div className={styles.right}>
        {sourceId ? (
          <SourcePane
            projectId={projectId}
            sourceId={sourceId}
            canWrite={writable}
            canSaveProgress={access?.canSaveProgress ?? false}
          />
        ) : (
          <Pane title={t("readme.title")}>
            {project.data ? (
              <ReadmePanel key={projectId} projectId={projectId} canEdit={writable} />
            ) : (
              <p className={styles.status}>{t("common:loading")}</p>
            )}
          </Pane>
        )}
      </div>
    </LibraryDnd>
  );
}
