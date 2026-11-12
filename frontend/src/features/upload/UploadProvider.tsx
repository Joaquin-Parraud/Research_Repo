import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/errors";
import { attachSourceFile, uploadSource } from "../../api/upload";
import { translateError } from "../../api/translateError";
import { useToast } from "../../components/Toast";
import { isArchivedConflict, refetchProjectState } from "../projects/archived";
import { sourceKey, treeKey } from "../library/useLibrary";
import { createUploadQueue, type UploadItem, type UploadQueue } from "./uploadQueue";

const UploadContext = createContext<UploadQueue | null>(null);

/** One queue for the whole session, so uploads continue while you browse. */
export function UploadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { i18n } = useTranslation();
  const [queue] = useState(() =>
    createUploadQueue({
      send: ({ item, onProgress, onUploaded, signal }) =>
        item.attachToSourceId
          ? attachSourceFile({
              sourceId: item.attachToSourceId,
              file: item.file,
              allowDuplicate: item.allowDuplicate,
              onProgress,
              onUploaded,
              signal,
            })
          : uploadSource({
              projectId: item.projectId,
              folderId: item.folderId,
              file: item.file,
              allowDuplicate: item.allowDuplicate,
              onProgress,
              onUploaded,
              signal,
            }),
      onItemDone: (item) => {
        // The list refreshes as each upload completes.
        void queryClient.invalidateQueries({ queryKey: treeKey(item.projectId) });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        void queryClient.invalidateQueries({ queryKey: ["project", item.projectId] });
        if (item.attachToSourceId) {
          void queryClient.invalidateQueries({ queryKey: sourceKey(item.attachToSourceId) });
        }
      },
      onItemFailed: (item, error) => {
        // Someone attached a file meanwhile: our copy of the source is stale.
        if (item.attachToSourceId && error instanceof ApiError && error.code === "source.already_has_file") {
          void queryClient.invalidateQueries({ queryKey: sourceKey(item.attachToSourceId) });
        }
        if (isArchivedConflict(error)) {
          toast.show(translateError(i18n, error), "error");
          void refetchProjectState(queryClient);
        }
      },
    }),
  );
  return <UploadContext.Provider value={queue}>{children}</UploadContext.Provider>;
}

export function useUploadQueue(): UploadQueue {
  const queue = useContext(UploadContext);
  if (!queue) throw new Error("useUploadQueue must be used inside <UploadProvider>");
  return queue;
}

export function useUploadItems(): readonly UploadItem[] {
  const queue = useUploadQueue();
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot);
}
