import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MetadataStatus } from "../../api/csl";
import { getCitation } from "../../api/citations";
import { citationKey } from "../library/useLibrary";

interface Args {
  sourceId: string;
  /** Changes whenever the metadata does, so the citation is fetched again. */
  updatedAt: string;
  /** The project's citation language; a change re-renders every reference. */
  locale: string | undefined;
  status: MetadataStatus;
}

/**
 * APA 7 reference and in-text forms. Not requested while there is no metadata to cite from.
 * `updatedAt` and `locale` are part of the key, so saving metadata or changing the project's citation
 * language fetches a fresh citation by itself (the previous one stays on screen meanwhile).
 */
export function useCitation({ sourceId, updatedAt, locale, status }: Args) {
  return useQuery({
    queryKey: [...citationKey(sourceId), updatedAt, locale ?? null],
    queryFn: () => getCitation(sourceId),
    enabled: status !== "pending",
    placeholderData: keepPreviousData,
  });
}
