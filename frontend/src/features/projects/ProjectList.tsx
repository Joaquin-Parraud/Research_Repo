import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canManage, type Project } from "../../api/projects";
import { translateError } from "../../api/translateError";
import { AppLink } from "../../components/AppLink";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { projectPath } from "../../hooks/useAppNavigation";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { useProjects } from "./useProjects";
import styles from "./ProjectList.module.css";

interface ProjectListProps {
  selectedId: string | null;
  /** Called when a project link is activated (e.g. to close the overlay sidebar). */
  onSelect?: () => void;
}

export function ProjectList({ selectedId, onSelect }: ProjectListProps) {
  const { t, i18n } = useTranslation("library");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Project | null>(null);
  const projects = useProjects(showArchived);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <Button variant="primary" size="small" onClick={() => setCreating(true)}>
          {t("projects.new")}
        </Button>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {t("projects.showArchived")}
        </label>
      </div>

      {projects.isPending && <p className={styles.message}>{t("common:loading")}</p>}
      {projects.isError && (
        <p role="alert" className={styles.error}>
          {translateError(i18n, projects.error)}{" "}
          <Button size="small" onClick={() => void projects.refetch()}>
            {t("common:retry")}
          </Button>
        </p>
      )}
      {projects.data && projects.data.length === 0 && (
        <EmptyState title={t("projects.empty.title")} body={t("projects.empty.body")} />
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className={styles.list} aria-label={t("projects.listLabel")}>
          {projects.data.map((project) => {
            const selected = project.id === selectedId;
            return (
              <li key={project.id} className={`${styles.item} ${selected ? styles.selected : ""}`}>
                <AppLink
                  to={projectPath(project.id)}
                  className={styles.link}
                  onClick={onSelect}
                  aria-current={selected ? "page" : undefined}
                >
                  <span className={styles.name}>{project.name}</span>
                  <span className={styles.meta}>
                    {project.archived_at && <span className={styles.badge}>{t("projects.archivedBadge")}</span>}
                    <span aria-label={t("projects.sourceCount", { count: project.source_count })}>
                      {project.source_count}
                    </span>
                  </span>
                </AppLink>
                {selected && canManage(project.role) && (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => setSettingsFor(project)}
                    aria-label={t("projects.settings.open", { name: project.name })}
                  >
                    {t("projects.settings.button")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
      {settingsFor && (
        <ProjectSettingsDialog project={settingsFor} onClose={() => setSettingsFor(null)} />
      )}
    </div>
  );
}
