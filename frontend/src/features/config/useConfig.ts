import { useQuery } from "@tanstack/react-query";
import { getConfig } from "../../api/config";

export const configKey = ["config"] as const;

/** Server limits and switches. Fetched once per session; a failure just means "unknown", never an error screen. */
export function useConfig() {
  return useQuery({
    queryKey: configKey,
    queryFn: getConfig,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
