import { apiRequest } from "./client";

export interface Folder {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  position: number;
}

export interface SourceSummary {
  id: string;
  folder_id: string | null;
  title: string;
  authors_text: string | null;
  year: number | null;
  citation_key: string;
  has_file: boolean;
  metadata_status: string;
  text_status: string;
  page_count: number | null;
  created_at: string;
}

export interface LibraryTree {
  folders: Folder[];
  sources: SourceSummary[];
}

export interface SourceFileInfo {
  size_bytes: number;
  page_count: number | null;
  original_filename: string;
}

export interface Source {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  authors_text: string | null;
  year: number | null;
  citation_key: string;
  doi: string | null;
  metadata_status: string;
  text_status: string;
  last_page_read: number;
  has_file: boolean;
  file: SourceFileInfo | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface UpdateSourceInput {
  title?: string;
  folder_id?: string | null;
  last_page_read?: number;
  tags?: string[];
}

export interface UpdateFolderInput {
  name?: string;
  parent_id?: string | null;
  position?: number;
}

export const getTree = (projectId: string) =>
  apiRequest<LibraryTree>("GET", `/projects/${projectId}/tree`);

export const createFolder = (projectId: string, input: { name: string; parent_id?: string | null }) =>
  apiRequest<Folder>("POST", `/projects/${projectId}/folders`, input);
export const updateFolder = (id: string, input: UpdateFolderInput) =>
  apiRequest<Folder>("PATCH", `/folders/${id}`, input);
export const deleteFolder = (id: string) => apiRequest<undefined>("DELETE", `/folders/${id}`);

export const getSource = (id: string) => apiRequest<Source>("GET", `/sources/${id}`);
export const updateSource = (id: string, input: UpdateSourceInput) =>
  apiRequest<Source>("PATCH", `/sources/${id}`, input);
export const deleteSource = (id: string) => apiRequest<undefined>("DELETE", `/sources/${id}`);
export const moveSources = (sourceIds: string[], folderId: string | null) =>
  apiRequest<{ moved: number }>("POST", "/sources/move", {
    source_ids: sourceIds,
    folder_id: folderId,
  });

/** Citation-only source: multipart with a title and no file. */
export function createCitationSource(projectId: string, title: string, folderId: string | null) {
  const form = new FormData();
  form.append("title", title);
  if (folderId) form.append("folder_id", folderId);
  return apiRequest<Source>("POST", `/projects/${projectId}/sources`, form);
}

export const sourceFileUrl = (id: string) => `/api/sources/${id}/file`;
