import { useCallback, useEffect, useState } from "react";

const storageKey = (projectId: string) => `rr.expanded.${projectId}`;

function load(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function save(projectId: string, expanded: ReadonlySet<string>) {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify([...expanded]));
  } catch {
    // Storage unavailable (private mode, quota): expansion just is not remembered.
  }
}

/** Which folders are expanded in the tree; remembered per project in localStorage. */
export function useExpandedFolders(projectId: string) {
  const [state, setState] = useState(() => ({ projectId, expanded: load(projectId) }));

  // Switching project loads that project's saved expansion.
  if (state.projectId !== projectId) setState({ projectId, expanded: load(projectId) });

  useEffect(() => {
    save(state.projectId, state.expanded);
  }, [state]);

  const update = useCallback(
    (change: (current: Set<string>) => Set<string>) =>
      setState((current) => ({ ...current, expanded: change(new Set(current.expanded)) })),
    [],
  );

  const toggle = useCallback(
    (id: string) =>
      update((set) => {
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return set;
      }),
    [update],
  );

  const expand = useCallback(
    (ids: readonly string[]) =>
      update((set) => {
        ids.forEach((id) => set.add(id));
        return set;
      }),
    [update],
  );

  const collapse = useCallback(
    (id: string) =>
      update((set) => {
        set.delete(id);
        return set;
      }),
    [update],
  );

  return { expanded: state.expanded, toggle, expand, collapse };
}

export type Expansion = ReturnType<typeof useExpandedFolders>;
