import { ApiError } from "../../api/errors";

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "duplicate";

export interface UploadItem {
  id: string;
  projectId: string;
  folderId: string | null;
  file: File;
  status: UploadStatus;
  /** 0..1 */
  progress: number;
  error: unknown;
  /** Set when the server reported the same file already exists. */
  existingSourceId: string | null;
  allowDuplicate: boolean;
}

export interface SendArgs {
  item: UploadItem;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export interface UploadQueueOptions {
  send: (args: SendArgs) => Promise<unknown>;
  onItemDone?: (item: UploadItem) => void;
  concurrency?: number;
}

export interface UploadQueue {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly UploadItem[];
  add: (projectId: string, folderId: string | null, files: readonly File[]) => void;
  retry: (id: string) => void;
  /** Duplicate flow: upload again with `allow_duplicate`. */
  addAnyway: (id: string) => void;
  /** Removes an item; aborts it first if it is uploading. */
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

export const DUPLICATE_CODE = "source.duplicate_file";

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Splits files into PDFs and everything else (rejected client-side). */
export function partitionPdfs(files: readonly File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) (isPdfFile(file) ? accepted : rejected).push(file);
  return { accepted, rejected };
}

/** Framework-free upload queue with limited concurrency; plugs into useSyncExternalStore. */
export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const concurrency = options.concurrency ?? 3;
  let items: readonly UploadItem[] = [];
  let counter = 0;
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();

  const emit = () => listeners.forEach((listener) => listener());
  const update = (id: string, patch: Partial<UploadItem>) => {
    items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    emit();
  };

  function pump() {
    let active = items.filter((item) => item.status === "uploading").length;
    for (const item of items) {
      if (active >= concurrency) break;
      if (item.status !== "queued") continue;
      active += 1;
      void start(item.id);
    }
  }

  async function start(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    const controller = new AbortController();
    controllers.set(id, controller);
    update(id, { status: "uploading", progress: 0, error: null });
    const current = { ...item, status: "uploading" as const, progress: 0 };
    try {
      await options.send({
        item: current,
        signal: controller.signal,
        onProgress: (fraction) => update(id, { progress: Math.min(1, Math.max(0, fraction)) }),
      });
      update(id, { status: "done", progress: 1 });
      options.onItemDone?.(current);
    } catch (error) {
      if (!controllers.has(id)) return; // dismissed while uploading
      if (error instanceof ApiError && error.code === DUPLICATE_CODE) {
        const existing = error.details?.existing_source_id;
        update(id, {
          status: "duplicate",
          error,
          existingSourceId: typeof existing === "string" ? existing : null,
        });
      } else {
        update(id, { status: "failed", error });
      }
    } finally {
      controllers.delete(id);
      pump();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => items,
    add(projectId, folderId, files) {
      const created = files.map<UploadItem>((file) => ({
        id: `upload-${++counter}`,
        projectId,
        folderId,
        file,
        status: "queued",
        progress: 0,
        error: null,
        existingSourceId: null,
        allowDuplicate: false,
      }));
      items = [...items, ...created];
      emit();
      pump();
    },
    retry(id) {
      update(id, { status: "queued", progress: 0, error: null });
      pump();
    },
    addAnyway(id) {
      update(id, { status: "queued", progress: 0, error: null, allowDuplicate: true });
      pump();
    },
    dismiss(id) {
      controllers.get(id)?.abort();
      controllers.delete(id);
      items = items.filter((item) => item.id !== id);
      emit();
      pump();
    },
    clearFinished() {
      items = items.filter((item) => item.status === "queued" || item.status === "uploading");
      emit();
    },
  };
}
