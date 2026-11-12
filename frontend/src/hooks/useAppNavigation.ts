import { useCallback, useMemo } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { useUnsavedGuard } from "./useUnsavedChanges";

export const ROOT_FOLDER_SEGMENT = "root";

export function projectPath(projectId: string): string {
  return `/p/${projectId}`;
}

export function folderPath(projectId: string, folderId: string | null): string {
  return `/p/${projectId}/f/${folderId ?? ROOT_FOLDER_SEGMENT}`;
}

const projectOf = (path: string) => /^\/p\/([^/?#]+)/.exec(path)?.[1] ?? null;

/** Whether going from the current URL to `to` replaces what the right pane shows. */
export function replacesReadme(pathname: string, search: string, to: string): boolean {
  const target = new URL(to, "http://localhost");
  if (projectOf(target.pathname) !== projectOf(pathname)) return true;
  const hadSource = new URLSearchParams(search).has("source");
  return !hadSource && target.searchParams.has("source");
}

/** Reads the current selection out of the URL. */
export function useRouteSelection() {
  // Matched here rather than with useParams: the shell is a layout route above them.
  const folderMatch = useMatch("/p/:projectId/f/:folderId");
  const projectMatch = useMatch("/p/:projectId");
  const [searchParams] = useSearchParams();
  const projectId = folderMatch?.params.projectId ?? projectMatch?.params.projectId ?? null;
  const folderId = folderMatch?.params.folderId;
  return {
    projectId,
    /** `null` is the project root; also the case when no folder segment is present. */
    folderId: folderId && folderId !== ROOT_FOLDER_SEGMENT ? folderId : null,
    sourceId: searchParams.get("source"),
  };
}

/** Navigation helpers. Every move goes through the unsaved-changes guard. */
export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { guard } = useUnsavedGuard();

  const go = useCallback(
    (to: string, replace = false) => {
      const move = () => void navigate(to, { replace });
      // Only moves that replace the README panel can lose an open editor: another
      // project, or opening a source. Browsing folders keeps it on screen.
      if (replacesReadme(location.pathname, location.search, to)) guard(move);
      else move();
    },
    [guard, navigate, location.pathname, location.search],
  );

  return useMemo(() => {
    const keepSource = (path: string) => {
      const source = new URLSearchParams(location.search).get("source");
      return source ? `${path}?source=${encodeURIComponent(source)}` : path;
    };
    return {
      go,
      toHome: () => go("/"),
      toProject: (projectId: string) => go(projectPath(projectId)),
      /** Changing folder keeps the open source, so you can read while browsing. */
      toFolder: (projectId: string, folderId: string | null, replace = false) =>
        go(keepSource(folderPath(projectId, folderId)), replace),
      openSource: (sourceId: string) =>
        go(`${location.pathname}?source=${encodeURIComponent(sourceId)}`),
      closeSource: () => go(location.pathname),
    };
  }, [go, location.pathname, location.search]);
}
