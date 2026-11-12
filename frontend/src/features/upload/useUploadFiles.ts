import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { useUploadQueue } from "./UploadProvider";
import { partitionPdfs } from "./uploadQueue";

/** Returns `(folderId, files)`: queues the PDFs and rejects anything else with a message. */
export function useUploadTo(projectId: string) {
  const queue = useUploadQueue();
  const toast = useToast();
  const { t } = useTranslation("library");

  return useCallback(
    (folderId: string | null, files: readonly File[]) => {
      const { accepted, rejected } = partitionPdfs(files);
      if (rejected.length > 0) {
        toast.show(
          t("upload.rejected", { count: rejected.length, names: rejected.map((f) => f.name).join(", ") }),
          "error",
        );
      }
      if (accepted.length > 0) queue.add(projectId, folderId, accepted);
    },
    [queue, toast, t, projectId],
  );
}

/** Same, bound to one folder. */
export function useUploadFiles(projectId: string, folderId: string | null) {
  const uploadTo = useUploadTo(projectId);
  return useCallback((files: readonly File[]) => uploadTo(folderId, files), [uploadTo, folderId]);
}
