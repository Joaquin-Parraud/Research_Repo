import { apiRequest } from "./client";
import type { CslItem, MetadataStatus } from "./csl";

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
  metadata_status: MetadataStatus;
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
  /** True while the key is derived from the metadata; false once edited by hand. */
  citation_key_auto: boolean;
  doi: string | null;
  /** Canonical CSL-JSON metadata. `title`, `authors_text` and `year` are derived from it by the server. */
  csl: CslItem;
  metadata_status: MetadataStatus;
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
  /** Complete CSL-JSON item; replaces the stored one. */
  csl?: CslItem;
  metadata_status?: "confirmed";
  /** A manual key, or `null` to go back to the automatic one. */
  citation_key?: string | null;
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
