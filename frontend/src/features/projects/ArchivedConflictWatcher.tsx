import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { useToast } from "../../components/Toast";
import { isArchivedConflict, refetchProjectState } from "./archived";

/**
 * Safety net for a stray `409 project.archived` (the project was archived in another tab, or our copy
 * was stale): whichever mutation hit it, say so in the user's language and refetch the project state,
 * so the banner appears and the write buttons disappear.
 */
export function ArchivedConflictWatcher() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { i18n } = useTranslation();

  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      if (!isArchivedConflict(event.action.error)) return;
      toast.show(translateError(i18n, event.action.error), "error");
      void refetchProjectState(queryClient);
    });
  }, [queryClient, toast, i18n]);

  return null;
}
