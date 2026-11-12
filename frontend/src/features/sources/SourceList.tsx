import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryTree } from "../../api/library";
import type { ScopeKind } from "../bibliography/bibliography";
import { BibliographyDialog } from "../bibliography/BibliographyDialog";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { translateError } from "../../api/translateError";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useFormatters } from "../../hooks/useFormatters";
import { FolderPickerDialog } from "../folders/FolderPickerDialog";
import { buildTree } from "../library/tree";
import { useSourceActions, useUpdateSource } from "../library/useLibrary";
import { useFileDrop } from "../upload/useFileDrop";
import { useUploadFiles } from "../upload/useUploadFiles";
import { AddSourceDialog } from "./AddSourceDialog";
import { SourceRow } from "./SourceRow";
import {
  applySelection,
  filterNeedsReview,
  hasMetadataColumns,
  sortSources,
  type SelectionState,
  type SortDirection,
  type SortKey,
} from "./selection";
import styles from "./SourceList.module.css";

const SORT_KEYS: readonly SortKey[] = ["title", "authors", "year", "added"];

interface FolderSelection extends SelectionState {
  folderId: string | null;
}

interface Props {
  project: { id: string; name: string; slug: string };
  projectId: string;
  folderId: string | null;
  tree: LibraryTree;
  canWrite: boolean;
  openSourceId: string | null;
}

export function SourceList({ project, projectId, folderId, tree, canWrite, openSourceId }: Props) {
  const { t, i18n } = useTranslation("library");
  const toast = useToast();
  const { compare } = useFormatters();
  const { openSource, closeSource } = useAppNavigation();
  const actions = useSourceActions(projectId);
  const update = useUpdateSource(projectId);
  const uploadFiles = useUploadFiles(projectId, folderId);
  const { isOver, dropProps } = useFileDrop(uploadFiles, canWrite);

  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [rawSelection, setSelection] = useState<FolderSelection>({
    folderId,
    selected: new Set(),
    anchor: null,
  });
  const [adding, setAdding] = useState(false);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [exporting, setExporting] = useState<ScopeKind | null>(null);

  const inFolder = useMemo(
    () => tree.sources.filter((source) => source.folder_id === folderId),
    [tree.sources, folderId],
  );
  const reviewCount = useMemo(() => filterNeedsReview(inFolder).length, [inFolder]);
  const shown = useMemo(
    () => (onlyNeedsReview ? filterNeedsReview(inFolder) : inFolder),
    [inFolder, onlyNeedsReview],
  );
  const sorted = useMemo(
    () => sortSources(shown, sortKey, direction, compare),
    [shown, sortKey, direction, compare],
  );
  const orderedIds = useMemo(() => sorted.map((source) => source.id), [sorted]);
  const showMetadata = hasMetadataColumns(inFolder);
  const roots = useMemo(() => buildTree(tree.folders, tree.sources).roots, [tree.folders, tree.sources]);

  // Selection belongs to one folder and only counts ids still listed there
  // (after a move, delete or folder change the stale ids are simply ignored).
  const selection: SelectionState = useMemo(
    () =>
      rawSelection.folderId === folderId
        ? {
            selected: new Set(orderedIds.filter((id) => rawSelection.selected.has(id))),
            anchor: rawSelection.anchor,
          }
        : { selected: new Set(), anchor: null },
    [rawSelection, folderId, orderedIds],
  );
  const selectedIds = orderedIds.filter((id) => selection.selected.has(id));
  const clearSelection = () => setSelection({ folderId, selected: new Set(), anchor: null });
  const allSelected = orderedIds.length > 0 && selectedIds.length === orderedIds.length;

  function dragIdsFor(id: string): string[] {
    return selection.selected.has(id) ? selectedIds : [id];
  }

  const moveCurrent = (() => {
    if (!moveIds) return undefined;
    const folders = new Set(moveIds.map((id) => tree.sources.find((s) => s.id === id)?.folder_id ?? null));
    return folders.size === 1 ? ([...folders][0] ?? null) : undefined;
  })();

  function deleteSelected() {
    const ids = selectedIds;
    actions.remove.mutate(ids, {
      onSuccess: (result) => {
        setConfirmDelete(false);
        clearSelection();
        if (openSourceId && ids.includes(openSourceId)) closeSource();
        if (result.failed > 0) toast.show(t("sources.delete.partial", { count: result.failed }), "error");
      },
      onError: (error) => {
        setConfirmDelete(false);
        toast.show(translateError(i18n, error), "error");
      },
    });
  }

  return (
    <div className={`${styles.drop} ${isOver ? styles.dropOver : ""}`} {...dropProps}>
      <div className={styles.header}>
        <div className={styles.controls}>
          {canWrite && (
            <Button variant="primary" size="small" onClick={() => setAdding(true)}>
              {t("sources.add")}
            </Button>
          )}
          <Button size="small" onClick={() => setExporting(folderId ? "folder" : "project")}>
            {t("sources.export")}
          </Button>
          <span className={styles.spacer} />
          <label className={styles.sort}>
            {t("sources.sort.label")}
            <select
              className={styles.sortSelect}
              value={sortKey}
              onChange={(event) => setSortKey(SORT_KEYS.find((key) => key === event.target.value) ?? "title")}
            >
              <option value="title">{t("sources.sort.title")}</option>
              <option value="authors">{t("sources.sort.authors")}</option>
              <option value="year">{t("sources.sort.year")}</option>
              <option value="added">{t("sources.sort.added")}</option>
            </select>
          </label>
          <Button
            size="small"
            variant="ghost"
            onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={direction === "asc" ? t("sources.sort.ascending") : t("sources.sort.descending")}
          >
            {direction === "asc" ? "↑" : "↓"}
          </Button>
        </div>
        <div className={styles.controls}>
          {orderedIds.length > 0 && (
            <label className={styles.sort}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelection({
                    folderId,
                    selected: allSelected ? new Set() : new Set(orderedIds),
                    anchor: null,
                  })
                }
              />
              {t("sources.selectAll")}
            </label>
          )}
          <label className={styles.sort}>
            <input
              type="checkbox"
              checked={onlyNeedsReview}
              onChange={(event) => setOnlyNeedsReview(event.target.checked)}
            />
            {t("sources.filter.needsReview", { count: reviewCount })}
          </label>
          <span className={styles.summary}>{t("sources.count", { count: shown.length })}</span>
        </div>
        {selectedIds.length > 0 && (
          <div className={styles.bulk} role="group" aria-label={t("sources.bulk.label")}>
            <span>{t("sources.bulk.selected", { count: selectedIds.length })}</span>
            {canWrite && (
              <Button size="small" onClick={() => setMoveIds(selectedIds)}>
                {t("sources.bulk.move")}
              </Button>
            )}
            <Button size="small" onClick={() => setExporting("sources")}>
              {t("sources.bulk.export")}
            </Button>
            {canWrite && (
              <Button size="small" variant="danger" onClick={() => setConfirmDelete(true)}>
                {t("sources.bulk.delete")}
              </Button>
            )}
            <Button size="small" variant="ghost" onClick={clearSelection}>
              {t("sources.bulk.clear")}
            </Button>
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        onlyNeedsReview && inFolder.length > 0 ? (
          <EmptyState title={t("sources.filter.emptyTitle")} body={t("sources.filter.emptyBody")} />
        ) : (
          <EmptyState
            title={t("sources.empty.title")}
            body={canWrite ? t("sources.empty.bodyEditor") : t("sources.empty.bodyViewer")}
          />
        )
      ) : (
        <ul className={styles.list} aria-label={t("sources.listLabel")}>
          {sorted.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              canWrite={canWrite}
              isOpen={source.id === openSourceId}
              isChecked={selection.selected.has(source.id)}
              showMetadata={showMetadata}
              dragIds={dragIdsFor(source.id)}
              onOpen={() => openSource(source.id)}
              onSelect={(mode) =>
                setSelection({ folderId, ...applySelection(selection, orderedIds, source.id, mode) })
              }
              onRename={(title) =>
                update.mutate(
                  { id: source.id, input: { title } },
                  { onError: (error) => toast.show(translateError(i18n, error), "error") },
                )
              }
              onMove={() => setMoveIds(dragIdsFor(source.id))}
            />
          ))}
        </ul>
      )}

      {adding && (
        <AddSourceDialog
          projectId={projectId}
          folderId={folderId}
          onFiles={uploadFiles}
          onClose={() => setAdding(false)}
        />
      )}

      {moveIds && (
        <FolderPickerDialog
          title={t("sources.move.title", { count: moveIds.length })}
          description={t("sources.move.description")}
          roots={roots}
          currentId={moveCurrent}
          onClose={() => setMoveIds(null)}
          onPick={(target) => {
            const ids = moveIds;
            setMoveIds(null);
            actions.move.mutate({ ids, folderId: target });
          }}
        />
      )}

      {exporting && (
        <BibliographyDialog
          project={project}
          folders={tree.folders}
          folderId={folderId}
          selectedIds={selectedIds}
          initialScope={exporting}
          onClose={() => setExporting(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("sources.delete.title", { count: selectedIds.length })}
          description={t("sources.delete.body", { count: selectedIds.length })}
          confirmLabel={t("sources.delete.confirm")}
          danger
          busy={actions.remove.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteSelected}
        />
      )}
    </div>
  );
}
