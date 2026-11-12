import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryTree } from "../../api/library";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ancestorIds, buildTree, canMoveFolder, descendantIds, type TreeNode } from "../library/tree";
import { useFolderActions } from "../library/useLibrary";
import { useUploadTo } from "../upload/useUploadFiles";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { FolderNode, RootNode } from "./FolderNode";
import { FolderTreeContext, type FolderTreeContextValue } from "./FolderTreeContext";
import type { Expansion } from "./useExpandedFolders";
import styles from "./FolderTree.module.css";

interface Props {
  projectId: string;
  tree: LibraryTree;
  selectedFolderId: string | null;
  canWrite: boolean;
  expansion: Expansion;
}

function findNode(roots: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of roots) {
    if (node.folder.id === id) return node;
    const inChild = findNode(node.children, id);
    if (inChild) return inChild;
  }
  return null;
}

/** Folder tree with ARIA tree semantics, inline create/rename, and Move to… / delete actions. */
export function FolderTree({ projectId, tree, selectedFolderId, canWrite, expansion }: Props) {
  const { t, i18n } = useTranslation("library");
  const { toFolder } = useAppNavigation();
  const actions = useFolderActions(projectId);
  const uploadTo = useUploadTo(projectId);
  const toast = useToast();
  const { expanded, toggle, expand, collapse } = expansion;
  const treeRef = useRef<HTMLUListElement>(null);

  const built = useMemo(() => buildTree(tree.folders, tree.sources), [tree.folders, tree.sources]);
  const selectedNode = selectedFolderId ? findNode(built.roots, selectedFolderId) : null;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Keep the selected folder visible: expand its ancestors.
  useEffect(() => {
    if (!selectedFolderId) return;
    const missing = ancestorIds(tree.folders, selectedFolderId).filter((id) => !expanded.has(id));
    if (missing.length > 0) expand(missing);
  }, [selectedFolderId, tree.folders, expanded, expand]);

  // The selected folder no longer exists (deleted elsewhere): fall back to the root.
  useEffect(() => {
    if (selectedFolderId && !tree.folders.some((folder) => folder.id === selectedFolderId)) {
      toFolder(projectId, null, true);
    }
  }, [selectedFolderId, tree.folders, projectId, toFolder]);

  function cancelInline() {
    setRenamingId(null);
    setCreatingParentId(undefined);
    setInlineError(null);
  }

  const context: FolderTreeContextValue = {
    projectId,
    canWrite,
    selectedFolderId,
    expanded,
    toggle,
    renamingId,
    creatingParentId,
    inlineError,
    inlineBusy: actions.create.isPending || actions.rename.isPending,
    select: (folderId) => toFolder(projectId, folderId),
    submitRename: (id, name) => {
      setInlineError(null);
      actions.rename.mutate(
        { id, name },
        { onSuccess: cancelInline, onError: (error) => setInlineError(translateError(i18n, error)) },
      );
    },
    submitCreate: (name) => {
      if (creatingParentId === undefined) return;
      const parentId = creatingParentId;
      setInlineError(null);
      actions.create.mutate(
        { name, parentId },
        {
          onSuccess: (folder) => {
            cancelInline();
            if (parentId) expand([parentId]);
            toFolder(projectId, folder.id);
          },
          onError: (error) => setInlineError(translateError(i18n, error)),
        },
      );
    },
    cancelInline,
    uploadInto: uploadTo,
  };

  function startCreate() {
    setRenamingId(null);
    setInlineError(null);
    setCreatingParentId(selectedFolderId);
    if (selectedFolderId) expand([selectedFolderId]);
  }

  function startRename(id: string) {
    setCreatingParentId(undefined);
    setInlineError(null);
    setRenamingId(id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName === "INPUT") return;
    const item = target.closest<HTMLElement>('[role="treeitem"]');
    const container = treeRef.current;
    if (!item || !container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = items.indexOf(item);
    const folderId = item.dataset.folderId ?? "root";
    const focusItem = (el: HTMLElement | undefined) => {
      if (el) {
        event.preventDefault();
        el.focus();
      }
    };

    switch (event.key) {
      case "ArrowDown":
        focusItem(items[index + 1]);
        break;
      case "ArrowUp":
        focusItem(items[index - 1]);
        break;
      case "Home":
        focusItem(items[0]);
        break;
      case "End":
        focusItem(items[items.length - 1]);
        break;
      case "ArrowRight":
        if (item.getAttribute("aria-expanded") === "false") {
          event.preventDefault();
          expand([folderId]);
        } else if (item.getAttribute("aria-expanded") === "true") {
          focusItem(items[index + 1]);
        }
        break;
      case "ArrowLeft":
        if (item.getAttribute("aria-expanded") === "true" && folderId !== "root") {
          event.preventDefault();
          collapse(folderId);
        } else {
          focusItem(item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        context.select(folderId === "root" ? null : folderId);
        break;
      case "F2":
        if (canWrite && folderId !== "root") {
          event.preventDefault();
          startRename(folderId);
        }
        break;
      case "Delete":
        if (canWrite && folderId !== "root") {
          event.preventDefault();
          context.select(folderId);
          setDeleting(true);
        }
        break;
    }
  }

  const parentName = selectedNode
    ? (tree.folders.find((folder) => folder.id === selectedNode.folder.parent_id)?.name ??
      t("folders.root"))
    : "";

  const disabledForMove = useMemo(() => {
    const disabled = new Set<string | null>();
    if (!selectedFolderId) return disabled;
    disabled.add(selectedFolderId);
    descendantIds(tree.folders, selectedFolderId).forEach((id) => disabled.add(id));
    return disabled;
  }, [selectedFolderId, tree.folders]);

  return (
    <FolderTreeContext.Provider value={context}>
      {canWrite && (
        <div className={styles.toolbar} role="toolbar" aria-label={t("folders.actions")}>
          <Button size="small" onClick={startCreate}>
            {t("folders.new")}
          </Button>
          <Button size="small" disabled={!selectedNode} onClick={() => selectedNode && startRename(selectedNode.folder.id)}>
            {t("folders.rename")}
          </Button>
          <Button size="small" disabled={!selectedNode} onClick={() => setMoving(true)}>
            {t("folders.move")}
          </Button>
          <Button size="small" variant="danger" disabled={!selectedNode} onClick={() => setDeleting(true)}>
            {t("folders.delete")}
          </Button>
        </div>
      )}

      <ul ref={treeRef} role="tree" aria-label={t("folders.treeLabel")} className={styles.tree} onKeyDown={handleKeyDown}>
        <RootNode count={built.rootSourceCount}>
          {built.roots.map((node) => (
            <FolderNode key={node.folder.id} node={node} level={2} />
          ))}
        </RootNode>
      </ul>

      {moving && selectedNode && (
        <FolderPickerDialog
          title={t("folders.move.title", { name: selectedNode.folder.name })}
          description={t("folders.move.description")}
          roots={built.roots}
          currentId={selectedNode.folder.parent_id}
          disabledIds={disabledForMove}
          onClose={() => setMoving(false)}
          onPick={(parentId) => {
            setMoving(false);
            if (canMoveFolder(tree.folders, selectedNode.folder.id, parentId).ok) {
              actions.move.mutate({ id: selectedNode.folder.id, parentId });
            }
          }}
        />
      )}

      {deleting && selectedNode && (
        <ConfirmDialog
          title={t("folders.delete.title", { name: selectedNode.folder.name })}
          description={t("folders.delete.body", {
            name: selectedNode.folder.name,
            destination: parentName,
            sources: t("folders.delete.sources", { count: selectedNode.sourceCount }),
            folders: t("folders.delete.subfolders", { count: selectedNode.children.length }),
          })}
          confirmLabel={t("folders.delete.confirm")}
          danger
          busy={actions.remove.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            const target = selectedNode;
            actions.remove.mutate(target.folder.id, {
              onSuccess: () => {
                setDeleting(false);
                if (selectedFolderId === target.folder.id) {
                  toFolder(projectId, target.folder.parent_id, true);
                }
              },
              onError: (error) => {
                setDeleting(false);
                toast.show(translateError(i18n, error), "error");
              },
            });
          }}
        />
      )}
    </FolderTreeContext.Provider>
  );

}
