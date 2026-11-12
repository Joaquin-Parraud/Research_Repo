import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createCitationSource,
  createFolder,
  deleteFolder,
  deleteSource,
  getSource,
  getTree,
  moveSources,
  updateFolder,
  updateSource,
  type LibraryTree,
  type UpdateSourceInput,
} from "../../api/library";
import { translateError } from "../../api/translateError";
import { useToast } from "../../components/Toast";
import { moveFolderInList, moveSourcesInList } from "./tree";

export const treeKey = (projectId: string) => ["tree", projectId] as const;
export const sourceKey = (id: string) => ["source", id] as const;

export function useTree(projectId: string) {
  return useQuery({ queryKey: treeKey(projectId), queryFn: () => getTree(projectId) });
}

export function useSource(id: string | null) {
  return useQuery({
    queryKey: sourceKey(id ?? ""),
    queryFn: () => getSource(id ?? ""),
    enabled: id !== null,
  });
}

function invalidateCounts(queryClient: QueryClient, projectId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: treeKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
  ]);
}

/** Folder create / rename / delete / move. Moves are optimistic with rollback and a toast. */
export function useFolderActions(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { i18n } = useTranslation();
  const key = treeKey(projectId);

  const create = useMutation({
    mutationFn: (input: { name: string; parentId: string | null }) =>
      createFolder(projectId, { name: input.name, parent_id: input.parentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => updateFolder(input.id, { name: input.name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => invalidateCounts(queryClient, projectId),
  });

  const move = useMutation({
    mutationFn: (input: { id: string; parentId: string | null }) =>
      updateFolder(input.id, { parent_id: input.parentId }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LibraryTree>(key);
      queryClient.setQueryData<LibraryTree>(key, (tree) =>
        tree ? { ...tree, folders: moveFolderInList(tree.folders, input.id, input.parentId) } : tree,
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.show(translateError(i18n, error), "error");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return { create, rename, remove, move };
}

/** Source move / delete / update / citation-only create. */
export function useSourceActions(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { i18n } = useTranslation();
  const key = treeKey(projectId);

  const move = useMutation({
    mutationFn: (input: { ids: string[]; folderId: string | null }) =>
      moveSources(input.ids, input.folderId),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LibraryTree>(key);
      queryClient.setQueryData<LibraryTree>(key, (tree) =>
        tree
          ? { ...tree, sources: moveSourcesInList(tree.sources, input.ids, input.folderId) }
          : tree,
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.show(translateError(i18n, error), "error");
    },
    onSettled: (_data, _error, input) => {
      for (const id of input.ids) void queryClient.invalidateQueries({ queryKey: sourceKey(id) });
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });

  /** Deletes several sources; reports how many failed. */
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteSource(id)));
      const failed = results.filter((result) => result.status === "rejected");
      const firstFailure = failed[0];
      if (firstFailure && firstFailure.status === "rejected" && failed.length === ids.length) {
        throw firstFailure.reason;
      }
      return { deleted: ids.length - failed.length, failed: failed.length };
    },
    onSettled: (_data, _error, ids) => {
      for (const id of ids) queryClient.removeQueries({ queryKey: sourceKey(id) });
      return invalidateCounts(queryClient, projectId);
    },
  });

  const createCitation = useMutation({
    mutationFn: (input: { title: string; folderId: string | null }) =>
      createCitationSource(projectId, input.title, input.folderId),
    onSuccess: () => invalidateCounts(queryClient, projectId),
  });

  return { move, remove, createCitation };
}

export const citationKey = (id: string) => ["citation", id] as const;

/** Changes to these fields alter what the list shows (title, authors, year, key, status). */
const LISTED_FIELDS = ["title", "csl", "metadata_status", "citation_key"] as const;

/** PATCH one source (title, tags, metadata, last_page_read) and keep the caches in step. */
export function useUpdateSource(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { id: string; input: UpdateSourceInput }) =>
      updateSource(variables.id, variables.input),
    onSuccess: (source, variables) => {
      queryClient.setQueryData(sourceKey(variables.id), source);
      // The citation needs no explicit invalidation: its query key includes `updated_at`, which the
      // fresh source in the cache has just changed, so it is fetched again exactly once.
      if (LISTED_FIELDS.some((field) => variables.input[field] !== undefined)) {
        return queryClient.invalidateQueries({ queryKey: treeKey(projectId) });
      }
      return undefined;
    },
  });
}
