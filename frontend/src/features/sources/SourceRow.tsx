import { useDraggable } from "@dnd-kit/core";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SourceSummary } from "../../api/library";
import { Button } from "../../components/Button";
import forms from "../../components/Form.module.css";
import type { LibraryDragData } from "../folders/LibraryDnd";
import { sourceDragId } from "../library/tree";
import { StatusBadge } from "../metadata/StatusBadge";
import styles from "./SourceList.module.css";

interface Props {
  source: SourceSummary;
  canWrite: boolean;
  isOpen: boolean;
  isChecked: boolean;
  showMetadata: boolean;
  /** Ids that move together if this row is dragged. */
  dragIds: string[];
  onOpen: () => void;
  onSelect: (mode: "toggle" | "range") => void;
  onRename: (title: string) => void;
  onMove: () => void;
}

export function SourceRow({
  source,
  canWrite,
  isOpen,
  isChecked,
  showMetadata,
  dragIds,
  onOpen,
  onSelect,
  onRename,
  onMove,
}: Props) {
  const { t } = useTranslation("library");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(source.title);

  const data: LibraryDragData = { payload: { type: "sources", ids: dragIds }, label: source.title };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: sourceDragId(source.id),
    data,
    disabled: !canWrite || renaming,
  });

  function handleTitleClick(event: MouseEvent) {
    if (event.shiftKey) onSelect("range");
    else if (event.metaKey || event.ctrlKey) onSelect("toggle");
    else onOpen();
  }

  function commitRename() {
    const trimmed = draft.trim();
    setRenaming(false);
    if (trimmed && trimmed !== source.title) onRename(trimmed);
  }

  function handleRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      setRenaming(false);
    }
  }

  const classes = [
    styles.row,
    isOpen ? styles.open : "",
    isChecked ? styles.checked : "",
    isDragging ? styles.dragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li ref={setNodeRef} className={classes} aria-current={isOpen ? "true" : undefined} {...(renaming ? {} : (listeners ?? {}))}>
      <input
        type="checkbox"
        checked={isChecked}
        aria-label={t("sources.selectOne", { title: source.title })}
        onChange={() => undefined}
        onClick={(event) => onSelect(event.shiftKey ? "range" : "toggle")}
      />
      {renaming ? (
        <input
          className={`${forms.input} ${styles.renameInput}`}
          value={draft}
          autoFocus
          maxLength={500}
          aria-label={t("sources.renameLabel")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleRenameKey}
          onBlur={() => setRenaming(false)}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : (
        <button type="button" className={styles.titleButton} onClick={handleTitleClick}>
          <span className={styles.title}>{source.title}</span>{" "}
          {!source.has_file && <span className={styles.badge}>{t("sources.citationOnly")}</span>}
        </button>
      )}
      <StatusBadge status={source.metadata_status} />
      {showMetadata && (
        <>
          <span className={styles.authors}>{source.authors_text ?? ""}</span>
          <span className={styles.year}>{source.year ?? ""}</span>
        </>
      )}
      {source.page_count !== null && source.has_file && (
        <span className={styles.pages}>{t("sources.pages", { count: source.page_count })}</span>
      )}
      {canWrite && !renaming && (
        <span className={styles.rowActions}>
          <Button
            size="small"
            variant="ghost"
            aria-label={t("sources.rename", { title: source.title })}
            onClick={() => {
              setDraft(source.title);
              setRenaming(true);
            }}
          >
            {t("sources.renameShort")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-label={t("sources.move", { title: source.title })}
            onClick={onMove}
          >
            {t("sources.moveShort")}
          </Button>
        </span>
      )}
    </li>
  );
}
