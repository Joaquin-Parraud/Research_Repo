import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import { applyHighlights } from "./applyHighlights";
import { loadPdfjs } from "./pdfjs";
import styles from "./PdfPage.module.css";

export interface PageSize {
  width: number;
  height: number;
}

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Size at scale 1: the real one once measured, else the first page's. */
  size: PageSize;
  /** The scroll container that clips the pages (for visibility tracking). */
  rootRef: RefObject<HTMLElement | null>;
  query: string;
  /** Index of the current match within this page, if the current match is here. */
  currentMatch: number | null;
  register: (pageNumber: number, element: HTMLElement | null) => void;
  onMeasured: (pageNumber: number, size: PageSize) => void;
  onHighlightShown: (element: HTMLElement) => void;
}

function isCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "RenderingCancelledException";
}

/**
 * One page. The box is always laid out (so scrolling is stable) but the canvas and text
 * layer exist only while the page is near the viewport, which keeps 300-page files light.
 */
function PdfPageView({
  doc,
  pageNumber,
  scale,
  size,
  rootRef,
  query,
  currentMatch,
  register,
  onMeasured,
  onHighlightShown,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<TextLayer | null>(null);
  const [near, setNear] = useState(false);
  const [layerVersion, setLayerVersion] = useState(0);

  useLayoutEffect(() => {
    register(pageNumber, boxRef.current);
    return () => register(pageNumber, null);
  }, [pageNumber, register]);

  useEffect(() => {
    const box = boxRef.current;
    const root = rootRef.current;
    if (!box || !root || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setNear(entry.isIntersecting);
      },
      { root, rootMargin: "150% 0px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let pageProxy: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | null = null;
    const canvas = canvasRef.current;
    const textHost = textRef.current;

    void (async () => {
      const [lib, page] = await Promise.all([loadPdfjs(), doc.getPage(pageNumber)]);
      pageProxy = page;
      if (cancelled || !canvas || !textHost) return;
      const base = page.getViewport({ scale: 1 });
      onMeasured(pageNumber, { width: base.width, height: base.height });
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      renderTask = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
      if (cancelled) return;

      textHost.replaceChildren();
      textLayer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textHost,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      textLayerRef.current = textLayer;
      setLayerVersion((version) => version + 1);
    })().catch((error: unknown) => {
      // Cancelled renders are expected when scrolling fast or zooming; other
      // failures leave the page blank rather than breaking the viewer.
      if (!isCancellation(error) && !cancelled) console.warn("PDF page render failed", error);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      textLayerRef.current = null;
      textHost?.replaceChildren();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      pageProxy?.cleanup();
    };
  }, [near, scale, doc, pageNumber, onMeasured]);

  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;
    const current = applyHighlights(layer.textDivs, layer.textContentItemsStr, query, currentMatch, {
      hit: styles.hit ?? "",
      current: styles.current ?? "",
    });
    if (current) onHighlightShown(current);
  }, [layerVersion, query, currentMatch, onHighlightShown]);

  const width = size.width * scale;
  const height = size.height * scale;
  const style = {
    width,
    height,
    "--scale-factor": scale,
    "--user-unit": 1,
    "--total-scale-factor": scale,
  } as CSSProperties;

  return (
    <div ref={boxRef} className={styles.page} style={style} data-page={pageNumber}>
      <canvas ref={canvasRef} className={styles.canvas} width={0} height={0} />
      <div ref={textRef} className={`${styles.textLayer} textLayer`} />
    </div>
  );
}

export const PdfPage = memo(PdfPageView);
