import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { uploadSource } from "../../api/upload";
import { treeKey } from "../library/useLibrary";
import { createUploadQueue, type UploadItem, type UploadQueue } from "./uploadQueue";

const UploadContext = createContext<UploadQueue | null>(null);

/** One queue for the whole session, so uploads continue while you browse. */
export function UploadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [queue] = useState(() =>
    createUploadQueue({
      send: ({ item, onProgress, signal }) =>
        uploadSource({
          projectId: item.projectId,
          folderId: item.folderId,
          file: item.file,
          allowDuplicate: item.allowDuplicate,
          onProgress,
          signal,
        }),
      onItemDone: (item) => {
        // The list refreshes as each upload completes.
        void queryClient.invalidateQueries({ queryKey: treeKey(item.projectId) });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        void queryClient.invalidateQueries({ queryKey: ["project", item.projectId] });
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
