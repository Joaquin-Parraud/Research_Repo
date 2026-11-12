import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  deleteProject,
  getProject,
  getReadme,
  listProjects,
  putReadme,
  updateProject,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "../../api/projects";

export const projectsKey = (includeArchived: boolean) => ["projects", { includeArchived }] as const;
export const projectKey = (id: string) => ["project", id] as const;
export const readmeKey = (id: string) => ["readme", id] as const;

export function useProjects(includeArchived: boolean) {
  return useQuery({
    queryKey: projectsKey(includeArchived),
    queryFn: () => listProjects(includeArchived),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: projectKey(id ?? ""),
    queryFn: () => getProject(id ?? ""),
    enabled: id !== null,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => updateProject(id, input),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKey(id), project);
      return queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: projectKey(id) });
      queryClient.removeQueries({ queryKey: readmeKey(id) });
      queryClient.removeQueries({ queryKey: ["tree", id] });
      return queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useReadme(projectId: string) {
  return useQuery({ queryKey: readmeKey(projectId), queryFn: () => getReadme(projectId) });
}

export function useSaveReadme(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (markdown: string) => putReadme(projectId, markdown),
    onSuccess: (readme) => queryClient.setQueryData(readmeKey(projectId), readme),
  });
}
