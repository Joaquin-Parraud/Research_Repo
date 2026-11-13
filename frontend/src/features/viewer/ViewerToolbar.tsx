import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import type { PdfSearch } from "./usePdfSearch";
import styles from "./ViewerToolbar.module.css";

interface Props {
  page: number;
  pageCount: number;
  scale: number;
  search: PdfSearch;
  query: string;
  onQueryChange: (query: string) => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}

export function ViewerToolbar({
  page,
  pageCount,
  scale,
  search,
  query,
  onQueryChange,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  expanded,
  onToggleExpanded,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation("viewer");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  // Follow the scroll position unless the user is typing a page number.
  const shownPage = editing ? draft : String(page);

  function submitPage(event: FormEvent) {
    event.preventDefault();
    const value = Number.parseInt(draft, 10);
    if (Number.isFinite(value)) onGoToPage(value);
    setEditing(false);
  }

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) search.previous();
      else search.next();
    } else if (event.key === "Escape" && query !== "") {
      // Clear the search first; marking the event handled keeps the viewer expanded.
      event.preventDefault();
      onQueryChange("");
    }
  }

  const percent = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en", { style: "percent" }).format(scale);

  let searchStatus = "";
  if (query.trim()) {
    if (search.total > 0 && search.current !== null) {
      searchStatus = t("search.position", { current: search.current + 1, total: search.total });
    } else if (search.searching) {
      searchStatus = t("search.searching");
    } else {
      searchStatus = t("search.none");
    }
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t("toolbar.label")}>
      <div className={styles.group}>
        <Button size="small" onClick={() => onGoToPage(page - 1)} disabled={page <= 1} aria-label={t("toolbar.previousPage")}>
          ‹
        </Button>
        <form onSubmit={submitPage} className={styles.group}>
          <input
            className={styles.pageInput}
            inputMode="numeric"
            value={shownPage}
            aria-label={t("toolbar.pageNumber")}
            onFocus={(event) => {
              setDraft(String(page));
              setEditing(true);
              event.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className={styles.text}>{t("toolbar.ofPages", { total: pageCount })}</span>
        </form>
        <Button size="small" onClick={() => onGoToPage(page + 1)} disabled={page >= pageCount} aria-label={t("toolbar.nextPage")}>
          ›
        </Button>
      </div>

      <div className={styles.group} role="group" aria-label={t("toolbar.zoom")}>
        <Button size="small" onClick={onZoomOut} aria-label={t("toolbar.zoomOut")}>
          −
        </Button>
        <span className={styles.text} aria-live="polite">
          {percent}
        </span>
        <Button size="small" onClick={onZoomIn} aria-label={t("toolbar.zoomIn")}>
          +
        </Button>
        <Button size="small" onClick={onFitWidth}>
          {t("toolbar.fitWidth")}
        </Button>
      </div>

      <div className={styles.group} role="search">
        <input
          className={styles.search}
          type="search"
          value={query}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={searchKeyDown}
        />
        <Button size="small" onClick={search.previous} disabled={search.total === 0} aria-label={t("search.previous")}>
          ↑
        </Button>
        <Button size="small" onClick={search.next} disabled={search.total === 0} aria-label={t("search.next")}>
          ↓
        </Button>
        <span className={styles.text} role="status">
          {searchStatus}
        </span>
      </div>

      <span className={styles.spacer} />
      <Button
        size="small"
        aria-pressed={expanded}
        title={expanded ? t("toolbar.collapseHint") : t("toolbar.expandHint")}
        onClick={onToggleExpanded}
      >
        {expanded ? t("toolbar.collapse") : t("toolbar.expand")}
      </Button>
      <Button size="small" variant="ghost" onClick={onClose}>
        {t("toolbar.close")}
      </Button>
    </div>
  );
}
