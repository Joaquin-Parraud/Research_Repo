import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getBibliography, type BibliographyRequest } from "../../api/citations";

/** Previews an export. Read-only on the server (a POST only because of the body), so it is a query. */
export function useBibliography(projectId: string, request: BibliographyRequest) {
  return useQuery({
    queryKey: ["bibliography", projectId, request],
    queryFn: () => getBibliography(projectId, request),
    placeholderData: keepPreviousData,
    // Metadata may change between two openings of the dialog: never show a cached list as current.
    gcTime: 0,
  });
}
