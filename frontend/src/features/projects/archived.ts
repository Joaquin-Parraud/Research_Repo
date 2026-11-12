import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";

export const ARCHIVED_CODE = "project.archived";

export function isArchivedConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === ARCHIVED_CODE;
}

/** The server says the project is archived, so our copy of it is stale: refetch everything that depends on it. */
export function refetchProjectState(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["project"] }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["tree"] }),
  ]);
}
