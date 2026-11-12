import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { CopyProjectDialog } from "./CopyProjectDialog";
import styles from "./ArchivedBanner.module.css";
import { useProjectAccess } from "./useProjectAccess";
import { useProject, useUpdateProject } from "./useProjects";

/** Shown above the panes of an archived project. Reading, citing and exporting stay available. */
export function ArchivedBanner({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation("library");
  const toast = useToast();
  const project = useProject(projectId);
  const access = useProjectAccess(projectId);
  const update = useUpdateProject(projectId);
  const [copying, setCopying] = useState(false);

  if (!project.data || !access?.archived) return null;

  return (
    <div className={styles.banner} role="region" aria-label={t("projects.archived.region")}>
      <div className={styles.text}>
        <strong>{t("projects.archived.title")}</strong>
        <span>{access.canManage ? t("projects.archived.bodyOwner") : t("projects.archived.bodyOther")}</span>
      </div>
      <div className={styles.actions}>
        {access.canManage && (
          <Button
            size="small"
            variant="primary"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { archived: false },
                { onError: (error) => toast.show(translateError(i18n, error), "error") },
              )
            }
          >
            {t("projects.archived.unarchive")}
          </Button>
        )}
        {access.canCopy && (
          <Button size="small" onClick={() => setCopying(true)}>
            {t("projects.copy.action")}
          </Button>
        )}
      </div>
      {copying && <CopyProjectDialog project={project.data} onClose={() => setCopying(false)} />}
    </div>
  );
}
