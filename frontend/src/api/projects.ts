import { apiRequest } from "./client";

export type Role = "owner" | "editor" | "viewer";
export type CitationLocale = "en-US" | "es";

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  citation_locale: CitationLocale;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  role: Role;
  source_count: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  citation_locale?: CitationLocale;
  archived?: boolean;
}

export interface Readme {
  readme_md: string;
  updated_at: string;
}

export const listProjects = (includeArchived: boolean) =>
  apiRequest<Project[]>("GET", `/projects?include_archived=${includeArchived}`);
export const getProject = (id: string) => apiRequest<Project>("GET", `/projects/${id}`);
export const createProject = (input: CreateProjectInput) =>
  apiRequest<Project>("POST", "/projects", input);
export const updateProject = (id: string, input: UpdateProjectInput) =>
  apiRequest<Project>("PATCH", `/projects/${id}`, input);
export const deleteProject = (id: string) => apiRequest<undefined>("DELETE", `/projects/${id}`);
export const getReadme = (id: string) => apiRequest<Readme>("GET", `/projects/${id}/readme`);
export const putReadme = (id: string, readme_md: string) =>
  apiRequest<Readme>("PUT", `/projects/${id}/readme`, { readme_md });

/** Editors and owners can change content; viewers can only read. */
export const canWrite = (role: Role) => role === "owner" || role === "editor";
export const canManage = (role: Role) => role === "owner";
