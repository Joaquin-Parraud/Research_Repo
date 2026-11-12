import { useState, type DragEvent } from "react";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Native file-drop handlers (files dragged in from the OS), ignoring in-app drags. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [isOver, setIsOver] = useState(false);

  if (!enabled) return { isOver: false, dropProps: {} };

  return {
    isOver,
    dropProps: {
      onDragEnter: (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setIsOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setIsOver(false);
        onFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}
