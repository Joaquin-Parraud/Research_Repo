import { errorFromBody } from "./client";
import { ApiError, NETWORK_ERROR_CODE } from "./errors";
import type { Source } from "./library";

interface TransferCallbacks {
  onProgress?: (fraction: number) => void;
  /** All bytes have been sent; the server may still be working (metadata lookup). */
  onUploaded?: () => void;
  signal?: AbortSignal;
}

export interface UploadParams extends TransferCallbacks {
  projectId: string;
  file: File;
  folderId: string | null;
  allowDuplicate?: boolean;
}

export interface AttachParams extends TransferCallbacks {
  sourceId: string;
  file: File;
  allowDuplicate?: boolean;
}

export const ABORTED_ERROR_CODE = "aborted";

/** Sends a multipart form with XMLHttpRequest so upload progress can be reported. */
function sendForm(
  method: "POST" | "PUT",
  url: string,
  form: FormData,
  callbacks: TransferCallbacks,
): Promise<Source> {
  return new Promise<Source>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) callbacks.onProgress?.(event.loaded / event.total);
    };
    xhr.upload.onload = () => callbacks.onUploaded?.();
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
    if (callbacks.signal) {
      if (callbacks.signal.aborted) {
        reject(new ApiError(ABORTED_ERROR_CODE, 0, "Aborted"));
        return;
      }
      callbacks.signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.send(form);
  });
}

/** Uploads one PDF as a new source. */
export function uploadSource(params: UploadParams): Promise<Source> {
  const form = new FormData();
  form.append("file", params.file);
  if (params.folderId) form.append("folder_id", params.folderId);
  if (params.allowDuplicate) form.append("allow_duplicate", "true");
  return sendForm("POST", `/api/projects/${params.projectId}/sources`, form, params);
}

/** Attaches a PDF to a citation-only source. */
export function attachSourceFile(params: AttachParams): Promise<Source> {
  const form = new FormData();
  form.append("file", params.file);
  if (params.allowDuplicate) form.append("allow_duplicate", "true");
  return sendForm("PUT", `/api/sources/${params.sourceId}/file`, form, params);
}
