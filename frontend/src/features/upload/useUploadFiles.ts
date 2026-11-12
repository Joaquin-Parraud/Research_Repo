import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { useConfig } from "../config/useConfig";
import { useUploadQueue } from "./UploadProvider";
import { partitionUploadable } from "./uploadQueue";

/** Shows why files were skipped; returns the ones that may be uploaded. */
export function useUploadValidation() {
  const toast = useToast();
  const { t } = useTranslation("library");
  const config = useConfig();
  const max = config.data?.max_upload_mb;

  return useCallback(
    (files: readonly File[]): File[] => {
      const { accepted, notPdf, tooLarge } = partitionUploadable(files, max);
      if (notPdf.length > 0) {
        toast.show(
          t("upload.rejected", { count: notPdf.length, names: notPdf.map((f) => f.name).join(", ") }),
          "error",
        );
      }
      if (tooLarge.length > 0) {
        toast.show(
          t("upload.tooLarge", {
            count: tooLarge.length,
            max,
            names: tooLarge.map((f) => f.name).join(", "),
          }),
          "error",
        );
      }
      return accepted;
    },
    [toast, t, max],
  );
}

/** Returns `(folderId, files)`: queues the PDFs and rejects anything else with a message. */
export function useUploadTo(projectId: string) {
  const queue = useUploadQueue();
  const validate = useUploadValidation();

  return useCallback(
    (folderId: string | null, files: readonly File[]) => {
      const accepted = validate(files);
      if (accepted.length > 0) queue.add(projectId, folderId, accepted);
    },
    [queue, validate, projectId],
  );
}

/** Same, bound to one folder. */
export function useUploadFiles(projectId: string, folderId: string | null) {
  const uploadTo = useUploadTo(projectId);
  return useCallback((files: readonly File[]) => uploadTo(folderId, files), [uploadTo, folderId]);
}
