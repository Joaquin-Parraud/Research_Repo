import { useMemo } from "react";
import { projectAccess, type ProjectAccess } from "../../api/projects";
import { useProject } from "./useProjects";

/** What the current user may do in a project; everything is `false` until the project has loaded. */
export function useProjectAccess(projectId: string | null): ProjectAccess | null {
  const project = useProject(projectId);
  const data = project.data;
  return useMemo(() => (data ? projectAccess(data) : null), [data]);
}
