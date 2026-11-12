import { useMutation } from "@tanstack/react-query";
import { lookupDoi, suggestMetadata } from "../../api/metadata";

export function useLookupDoi() {
  return useMutation({ mutationFn: (doi: string) => lookupDoi(doi) });
}

export function useSuggestMetadata() {
  return useMutation({ mutationFn: (sourceId: string) => suggestMetadata(sourceId) });
}
