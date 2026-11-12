import { errorFromBody } from "./client";
import { ApiError, NETWORK_ERROR_CODE } from "./errors";
import type { Source } from "./library";

export interface UploadParams {
  projectId: string;
  file: File;
  folderId: string | null;
  allowDuplicate?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const ABORTED_ERROR_CODE = "aborted";

/** Uploads one PDF with XMLHttpRequest so progress can be reported. */
export function uploadSource(params: UploadParams): Promise<Source> {
  return new Promise<Source>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${params.projectId}/sources`);
    xhr.withCredentials = true;
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) params.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON; handled below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed !== undefined) {
        resolve(parsed as Source);
      } else {
        reject(errorFromBody(xhr.status, xhr.statusText, parsed));
      }
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_ERROR_CODE, 0, "Network error"));
    xhr.onabort = () => reject(new ApiError(ABORTED_ERROR_CODE, 0, "Aborted"));

    const onAbort = () => xhr.abort();
    if (params.signal) {
      if (params.signal.aborted) {
        reject(new ApiError(ABORTED_ERROR_CODE, 0, "Aborted"));
        return;
      }
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    const form = new FormData();
    form.append("file", params.file);
    if (params.folderId) form.append("folder_id", params.folderId);
    if (params.allowDuplicate) form.append("allow_duplicate", "true");
    xhr.send(form);
  });
}
