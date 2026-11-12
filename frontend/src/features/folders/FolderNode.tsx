import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useCallback, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFileDrop } from "../upload/useFileDrop";
import { folderDragId, folderDropId, ROOT_DROP_ID, type TreeNode } from "../library/tree";
import type { LibraryDragData } from "./LibraryDnd";
import { InlineNameInput } from "./InlineNameInput";
import { useFolderTreeContext } from "./FolderTreeContext";
import styles from "./FolderTree.module.css";

function indent(level: number): CSSProperties {
  return { paddingLeft: `${0.2 + (level - 1) * 0.9}rem` };
}

function Twisty({ open, hasChildren, onToggle }: { open: boolean; hasChildren: boolean; onToggle: () => void }) {
  return (
    <span
      className={styles.twisty}
      aria-hidden="true"
      onClick={(event) => {
        event.stopPropagation();
        if (hasChildren) onToggle();
      }}
    >
      {hasChildren ? (open ? "▾" : "▸") : ""}
    </span>
  );
}

function CreateRow({ level }: { level: number }) {
  const { t } = useTranslation("library");
  const ctx = useFolderTreeContext();
  return (
    <li role="none">
      <div className={styles.row} style={indent(level)}>
        <span className={styles.twisty} aria-hidden="true" />
        <InlineNameInput
          initial=""
          label={t("folders.newNameLabel")}
          error={ctx.inlineError}
          busy={ctx.inlineBusy}
          onSubmit={ctx.submitCreate}
          onCancel={ctx.cancelInline}
        />
      </div>
    </li>
  );
}

/** The "Project root" entry; also the drop target for moving things to the top level. */
export function RootNode({ count, children }: { count: number; children: ReactNode }) {
  const { t } = useTranslation("library");
  const ctx = useFolderTreeContext();
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID, disabled: !ctx.canWrite });
  const { isOver: fileOver, dropProps } = useFileDrop(
    (files) => ctx.uploadInto(null, files),
    ctx.canWrite,
  );
  const selected = ctx.selectedFolderId === null;

  return (
    <li
      role="treeitem"
      aria-level={1}
      aria-expanded={true}
      aria-selected={selected}
      aria-labelledby="folder-label-root"
      data-folder-id="root"
      tabIndex={-1}
      className={`${styles.item} ${selected ? styles.selected : ""} ${isOver || fileOver ? styles.dropOver : ""}`}
    >
      <div
        ref={setNodeRef}
        className={styles.row}
        style={indent(1)}
        onClick={() => ctx.select(null)}
        {...dropProps}
      >
        <span className={styles.twisty} aria-hidden="true" />
        <span id="folder-label-root" className={styles.label}>
          {t("folders.root")}
        </span>
        <span className={styles.count} aria-label={t("folders.sourceCount", { count })}>
          {count}
        </span>
      </div>
      <ul role="group" className={styles.group}>
        {children}
        {ctx.creatingParentId === null && <CreateRow level={2} />}
      </ul>
    </li>
  );
}

export function FolderNode({ node, level }: { node: TreeNode; level: number }) {
  const { t } = useTranslation("library");
  const ctx = useFolderTreeContext();
  const { folder } = node;
  const hasChildren = node.children.length > 0 || ctx.creatingParentId === folder.id;
  const open = ctx.expanded.has(folder.id);
  const selected = ctx.selectedFolderId === folder.id;
  const renaming = ctx.renamingId === folder.id;

  const dragData: LibraryDragData = { payload: { type: "folder", id: folder.id }, label: folder.name };
  const drag = useDraggable({
    id: folderDragId(folder.id),
    data: dragData,
    disabled: !ctx.canWrite || renaming,
  });
  const drop = useDroppable({ id: folderDropId(folder.id), disabled: !ctx.canWrite });
  const { isOver: fileOver, dropProps } = useFileDrop(
    (files) => ctx.uploadInto(folder.id, files),
    ctx.canWrite,
  );

  const setRefs = useCallback(
    (element: HTMLElement | null) => {
      drag.setNodeRef(element);
      drop.setNodeRef(element);
    },
    [drag, drop],
  );

  const labelId = `folder-label-${folder.id}`;
  const classes = [
    styles.item,
    selected ? styles.selected : "",
    drop.isOver || fileOver ? styles.dropOver : "",
    drag.isDragging ? styles.dragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={selected}
      aria-labelledby={labelId}
      data-folder-id={folder.id}
      tabIndex={-1}
      className={classes}
    >
      <div
        ref={setRefs}
        className={styles.row}
        style={indent(level)}
        onClick={() => ctx.select(folder.id)}
        {...(renaming ? {} : (drag.listeners ?? {}))}
        {...dropProps}
      >
        <Twisty open={open} hasChildren={node.children.length > 0} onToggle={() => ctx.toggle(folder.id)} />
        {renaming ? (
          <InlineNameInput
            initial={folder.name}
            label={t("folders.renameLabel")}
            error={ctx.inlineError}
            busy={ctx.inlineBusy}
            onSubmit={(name) => ctx.submitRename(folder.id, name)}
            onCancel={ctx.cancelInline}
          />
        ) : (
          <>
            <span id={labelId} className={styles.label}>
              {folder.name}
            </span>
            <span className={styles.count} aria-label={t("folders.sourceCount", { count: node.sourceCount })}>
              {node.sourceCount}
            </span>
          </>
        )}
      </div>
      {hasChildren && open && (
        <ul role="group" className={styles.group}>
          {node.children.map((child) => (
            <FolderNode key={child.folder.id} node={child} level={level + 1} />
          ))}
          {ctx.creatingParentId === folder.id && <CreateRow level={level + 1} />}
        </ul>
      )}
    </li>
  );
}
