import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { updateSource, type Source } from "../../api/library";
import { sourceKey } from "../library/useLibrary";
import { createDebouncedSaver, type DebouncedSaver } from "./pageSave";

const NOOP_SAVER: DebouncedSaver = { schedule: () => undefined, flush: () => undefined, cancel: () => undefined };

/**
 * Saves the page being read with a debounced PATCH. Returns the debouncer
 * (a no-op when `enabled` is false, e.g. for viewers who cannot write).
 * Pending saves are flushed when the source changes, on unmount and on page hide.
 */
export function useLastPageSaver(sourceId: string, initialPage: number, enabled: boolean): DebouncedSaver {
  const queryClient = useQueryClient();

  const saver = useMemo(() => {
    if (!enabled) return NOOP_SAVER;
    return createDebouncedSaver((page) => {
      updateSource(sourceId, { last_page_read: page })
        .then((source) => queryClient.setQueryData<Source>(sourceKey(sourceId), source))
        .catch(() => undefined); // Reading position is best-effort; never interrupt reading.
    }, initialPage);
    // initialPage is deliberately a snapshot per source: re-creating on every save would reset the baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, enabled, queryClient]);

  useEffect(() => {
    const onHide = () => saver.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      saver.flush();
    };
  }, [saver]);

  return saver;
}
