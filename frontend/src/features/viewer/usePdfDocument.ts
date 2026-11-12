import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { sourceFileUrl } from "../../api/library";
import { loadPdfjs } from "./pdfjs";
import { pdfErrorKind, type PdfErrorKind } from "./viewerMath";

export type PdfDocumentState =
  | { status: "loading" }
  | { status: "ready"; doc: PDFDocumentProxy }
  | { status: "error"; kind: PdfErrorKind };

/** Opens `/api/sources/{id}/file` with range requests and the session cookie. */
export function usePdfDocument(sourceId: string, attempt: number): PdfDocumentState {
  const [state, setState] = useState<{ key: string; value: PdfDocumentState } | null>(null);
  const key = `${sourceId}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    loadPdfjs()
      .then((lib) => {
        task = lib.getDocument({
          url: sourceFileUrl(sourceId),
          withCredentials: true,
          disableRange: false,
          disableStream: false,
        });
        return task.promise;
      })
      .then((doc) => {
        if (!cancelled) setState({ key, value: { status: "ready", doc } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key, value: { status: "error", kind: pdfErrorKind(error) } });
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [sourceId, key]);

  return state && state.key === key ? state.value : { status: "loading" };
}
