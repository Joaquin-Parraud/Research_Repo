import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { PdfPage, type PageSize } from "./PdfPage";
import { useLastPageSaver } from "./useLastPageSaver";
import { usePdfDocument } from "./usePdfDocument";
import { usePdfSearch } from "./usePdfSearch";
import { ViewerToolbar } from "./ViewerToolbar";
import { clampPage, fitWidthScale, pageAtOffset, zoomIn, zoomOut, PAGE_GAP_PX } from "./viewerMath";
import styles from "./PdfViewer.module.css";

interface Props {
  sourceId: string;
  /** Page to open at (1-based), taken from `last_page_read`. */
  initialPage: number;
  /** Whether reading progress may be saved (editors and owners). */
  canSaveProgress: boolean;
  onClose: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;

/** Continuous-scroll PDF viewer; only pages near the viewport are rendered. */
export function PdfViewer({ sourceId, initialPage, canSaveProgress, onClose }: Props) {
  const { t } = useTranslation("viewer");
  const [attempt, setAttempt] = useState(0);
  const state = usePdfDocument(sourceId, attempt);

  return (
    <div className={styles.viewer}>
      {state.status === "loading" && (
        <div className={styles.state} role="status">
          {t("loading")}
        </div>
      )}
      {state.status === "error" && (
        <div className={styles.state}>
          <p role="alert" className={styles.errorText}>
            {t(`error.${state.kind}`)}
          </p>
          <div>
            <Button onClick={() => setAttempt((value) => value + 1)}>{t("retry")}</Button>{" "}
            <Button variant="ghost" onClick={onClose}>
              {t("toolbar.close")}
            </Button>
          </div>
        </div>
      )}
      {state.status === "ready" && (
        <LoadedViewer
          key={`${sourceId}:${attempt}`}
          doc={state.doc}
          sourceId={sourceId}
          initialPage={initialPage}
          canSaveProgress={canSaveProgress}
          onClose={onClose}
        />
      )}
    </div>
  );
}

type Loaded = Extract<ReturnType<typeof usePdfDocument>, { status: "ready" }>;

interface LoadedProps {
  doc: Loaded["doc"];
  sourceId: string;
  initialPage: number;
  canSaveProgress: boolean;
  onClose: () => void;
}

function LoadedViewer({ doc, sourceId, initialPage, canSaveProgress, onClose }: LoadedProps) {
  const { t } = useTranslation("viewer");
  const pageCount = doc.numPages;
  const startPage = clampPage(initialPage, pageCount);
  const saver = useLastPageSaver(sourceId, startPage, canSaveProgress);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageElements = useRef(new Map<number, HTMLElement>());
  const [baseSize, setBaseSize] = useState<PageSize | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<number, PageSize>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  /** null = fit to width (follows the pane width); a number = the user's zoom. */
  const [userScale, setUserScale] = useState<number | null>(null);
  const [page, setPage] = useState(startPage);
  const pageRef = useRef(startPage);
  const ready = useRef(false);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const search = usePdfSearch(doc, debouncedQuery);

  // First page's size gives every placeholder a sensible height before it is measured.
  useEffect(() => {
    let cancelled = false;
    void doc.getPage(1).then((first) => {
      if (cancelled) return;
      const view = first.getViewport({ scale: 1 });
      first.cleanup();
      setBaseSize({ width: view.width, height: view.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = baseSize && containerWidth > 0 ? fitWidthScale(containerWidth, baseSize.width) : null;
  const scale = userScale ?? fitScale;

  const register = useCallback((pageNumber: number, element: HTMLElement | null) => {
    if (element) pageElements.current.set(pageNumber, element);
    else pageElements.current.delete(pageNumber);
  }, []);

  const onMeasured = useCallback((pageNumber: number, size: PageSize) => {
    setSizes((current) => {
      const known = current.get(pageNumber);
      if (known && known.width === size.width && known.height === size.height) return current;
      const next = new Map(current);
      next.set(pageNumber, size);
      return next;
    });
  }, []);

  const scrollToPage = useCallback((target: number) => {
    const element = pageElements.current.get(target);
    const scroller = scrollerRef.current;
    if (scroller && element) scroller.scrollTop = element.offsetTop - PAGE_GAP_PX;
  }, []);

  // After the layout changes (first layout, zoom, resize), stay on the page being read.
  useLayoutEffect(() => {
    if (scale === null) return;
    scrollToPage(pageRef.current);
    const frame = requestAnimationFrame(() => {
      ready.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [scale, scrollToPage]);

  const updateCurrentPage = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const tops: number[] = [];
    for (let number = 1; number <= pageCount; number += 1) {
      tops.push(pageElements.current.get(number)?.offsetTop ?? Number.MAX_SAFE_INTEGER);
    }
    const current = pageAtOffset(tops, scroller.scrollTop + scroller.clientHeight / 3);
    if (current === pageRef.current) return;
    pageRef.current = current;
    setPage(current);
    if (ready.current) saver.schedule(current);
  }, [pageCount, saver]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateCurrentPage);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [updateCurrentPage]);

  // Go to the current search match.
  const location = search.location;
  const matchPage = location?.page ?? null;
  const matchIndex = search.current;
  useEffect(() => {
    // Keyed on primitives so progress updates during the scan do not re-scroll.
    if (matchPage !== null) scrollToPage(matchPage);
  }, [matchPage, matchIndex, scrollToPage]);

  const onHighlightShown = useCallback((element: HTMLElement) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) {
      scroller.scrollTop += rect.top - box.top - box.height / 3;
    }
  }, []);

  const goToPage = useCallback(
    (target: number) => {
      const clamped = clampPage(target, pageCount);
      pageRef.current = clamped;
      setPage(clamped);
      scrollToPage(clamped);
      if (ready.current) saver.schedule(clamped);
    },
    [pageCount, scrollToPage, saver],
  );

  const pageNumbers = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const fallback = baseSize ?? { width: 612, height: 792 };

  return (
    <>
      <ViewerToolbar
        page={page}
        pageCount={pageCount}
        scale={scale ?? 1}
        search={search}
        query={query}
        onQueryChange={setQuery}
        onGoToPage={goToPage}
        onZoomIn={() => setUserScale(zoomIn(scale ?? 1))}
        onZoomOut={() => setUserScale(zoomOut(scale ?? 1))}
        onFitWidth={() => setUserScale(null)}
        onClose={onClose}
      />
      <div
        ref={scrollerRef}
        className={styles.scroller}
        tabIndex={0}
        role="region"
        aria-label={t("pages.label")}
      >
        <div className={styles.pages}>
          {scale !== null &&
            pageNumbers.map((number) => (
              <PdfPage
                key={number}
                doc={doc}
                pageNumber={number}
                scale={scale}
                size={sizes.get(number) ?? fallback}
                rootRef={scrollerRef}
                query={debouncedQuery}
                currentMatch={location && location.page === number ? location.indexInPage : null}
                register={register}
                onMeasured={onMeasured}
                onHighlightShown={onHighlightShown}
              />
            ))}
        </div>
      </div>
    </>
  );
}
