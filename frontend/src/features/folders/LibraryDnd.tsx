import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Folder, SourceSummary } from "../../api/library";
import { useToast } from "../../components/Toast";
import { resolveDrop, type DragPayload } from "../library/tree";
import { useFolderActions, useSourceActions } from "../library/useLibrary";
import styles from "./FolderTree.module.css";

export interface LibraryDragData {
  payload: DragPayload;
  label: string;
}

function isDragData(value: unknown): value is LibraryDragData {
  return typeof value === "object" && value !== null && "payload" in value && "label" in value;
}

interface Props {
  projectId: string;
  folders: readonly Folder[];
  sources: readonly SourceSummary[];
  /** Called with the folder that received a dropped folder, so the tree can open it. */
  onFolderReceived?: (folderId: string) => void;
  children: ReactNode;
}

/** Drag folders (to re-parent) and sources (to move) between the tree and the list. */
export function LibraryDnd({ projectId, folders, sources, onFolderReceived, children }: Props) {
  const { t } = useTranslation("library");
  const toast = useToast();
  const folderActions = useFolderActions(projectId);
  const sourceActions = useSourceActions(projectId);
  const [active, setActive] = useState<LibraryDragData | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleStart(event: DragStartEvent) {
    const data: unknown = event.active.data.current;
    setActive(isDragData(data) ? data : null);
  }

  function handleEnd(event: DragEndEvent) {
    setActive(null);
    const data: unknown = event.active.data.current;
    if (!isDragData(data)) return;
    const action = resolveDrop(data.payload, event.over?.id, folders, sources);
    if (!action) return;
    switch (action.kind) {
      case "moveFolder":
        folderActions.move.mutate({ id: action.folderId, parentId: action.parentId });
        if (action.parentId) onFolderReceived?.(action.parentId);
        break;
      case "moveSources":
        sourceActions.move.mutate({ ids: action.ids, folderId: action.folderId });
        break;
      case "rejected":
        toast.show(t(`folders.move.rejected.${action.reason}`), "error");
        break;
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActive(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className={styles.overlay}>
            {active.payload.type === "sources" && active.payload.ids.length > 1
              ? t("sources.dragMany", { count: active.payload.ids.length })
              : active.label}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
