import type { Folder, SourceSummary } from "../../api/library";

export interface TreeNode {
  folder: Folder;
  children: TreeNode[];
  /** Sources directly inside this folder (not in subfolders). */
  sourceCount: number;
}

export interface BuiltTree {
  roots: TreeNode[];
  rootSourceCount: number;
}

function byPosition(a: Folder, b: Folder): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

/** Builds the nested tree from the API's flat lists. Folders are ordered by `position`. */
export function buildTree(folders: readonly Folder[], sources: readonly SourceSummary[]): BuiltTree {
  const counts = new Map<string | null, number>();
  for (const source of sources) {
    counts.set(source.folder_id, (counts.get(source.folder_id) ?? 0) + 1);
  }
  const known = new Set(folders.map((folder) => folder.id));
  const nodes = new Map<string, TreeNode>();
  for (const folder of [...folders].sort(byPosition)) {
    nodes.set(folder.id, { folder, children: [], sourceCount: counts.get(folder.id) ?? 0 });
  }
  const roots: TreeNode[] = [];
  // Iterating `nodes` keeps the position order inside every sibling list.
  for (const node of nodes.values()) {
    const parent = node.folder.parent_id;
    // A folder whose parent is unknown is shown at the root rather than lost.
    const parentNode = parent && known.has(parent) ? nodes.get(parent) : undefined;
    (parentNode ? parentNode.children : roots).push(node);
  }
  return { roots, rootSourceCount: counts.get(null) ?? 0 };
}

/** All folders below `id` (not including `id` itself). */
export function descendantIds(folders: readonly Folder[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parent_id) {
      childrenOf.set(folder.parent_id, [...(childrenOf.get(folder.parent_id) ?? []), folder.id]);
    }
  }
  const result = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || result.has(next)) continue;
    result.add(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return result;
}

/** Ids from the root-most ancestor down to the parent of `id`. */
export function ancestorIds(folders: readonly Folder[], id: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let parent = byId.get(id)?.parent_id ?? null;
  while (parent && !seen.has(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = byId.get(parent)?.parent_id ?? null;
  }
  return chain;
}

export type MoveCheck = { ok: true } | { ok: false; reason: "self" | "descendant" | "same_parent" };

/** Client-side guard for re-parenting a folder (the server still enforces it too). */
export function canMoveFolder(
  folders: readonly Folder[],
  folderId: string,
  targetParentId: string | null,
): MoveCheck {
  if (targetParentId === folderId) return { ok: false, reason: "self" };
  if (targetParentId !== null && descendantIds(folders, folderId).has(targetParentId)) {
    return { ok: false, reason: "descendant" };
  }
  const current = folders.find((folder) => folder.id === folderId)?.parent_id ?? null;
  if (current === targetParentId) return { ok: false, reason: "same_parent" };
  return { ok: true };
}

export interface PickerEntry {
  folder: Folder;
  depth: number;
}

/** Depth-first list of every folder with its nesting depth, for indented pickers. */
export function flattenForPicker(roots: readonly TreeNode[]): PickerEntry[] {
  const out: PickerEntry[] = [];
  const visit = (nodes: readonly TreeNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ folder: node.folder, depth });
      visit(node.children, depth + 1);
    }
  };
  visit(roots, 0);
  return out;
}

/** Optimistic re-parent: the folder goes to the end of its new siblings. */
export function moveFolderInList(
  folders: readonly Folder[],
  id: string,
  parentId: string | null,
): Folder[] {
  const nextPosition =
    folders.filter((folder) => folder.parent_id === parentId && folder.id !== id).length;
  return folders.map((folder) =>
    folder.id === id ? { ...folder, parent_id: parentId, position: nextPosition } : folder,
  );
}

export function moveSourcesInList(
  sources: readonly SourceSummary[],
  ids: readonly string[],
  folderId: string | null,
): SourceSummary[] {
  const moving = new Set(ids);
  return sources.map((source) => (moving.has(source.id) ? { ...source, folder_id: folderId } : source));
}

/** What is being dragged. */
export type DragPayload =
  | { type: "folder"; id: string }
  | { type: "sources"; ids: string[] };

export const ROOT_DROP_ID = "drop:root";
export const folderDropId = (id: string) => `drop:folder:${id}`;
export const folderDragId = (id: string) => `drag:folder:${id}`;
export const sourceDragId = (id: string) => `drag:source:${id}`;

/** Folder id (or null for the root) from a droppable id; `undefined` if not a drop target. */
export function parseDropTarget(overId: string | number | null | undefined): string | null | undefined {
  if (overId === ROOT_DROP_ID) return null;
  if (typeof overId === "string" && overId.startsWith("drop:folder:")) {
    return overId.slice("drop:folder:".length);
  }
  return undefined;
}

export type DropAction =
  | { kind: "moveFolder"; folderId: string; parentId: string | null }
  | { kind: "moveSources"; ids: string[]; folderId: string | null }
  | { kind: "rejected"; reason: "self" | "descendant" };

/** Decides what a drop means. `null` = nothing to do (no target, or no change). */
export function resolveDrop(
  payload: DragPayload,
  overId: string | number | null | undefined,
  folders: readonly Folder[],
  sources: readonly SourceSummary[],
): DropAction | null {
  const target = parseDropTarget(overId);
  if (target === undefined) return null;

  if (payload.type === "folder") {
    const check = canMoveFolder(folders, payload.id, target);
    if (check.ok) return { kind: "moveFolder", folderId: payload.id, parentId: target };
    return check.reason === "same_parent" ? null : { kind: "rejected", reason: check.reason };
  }

  const known = new Map(sources.map((source) => [source.id, source]));
  const ids = payload.ids.filter((id) => known.get(id)?.folder_id !== target);
  if (ids.length === 0) return null;
  return { kind: "moveSources", ids, folderId: target };
}
