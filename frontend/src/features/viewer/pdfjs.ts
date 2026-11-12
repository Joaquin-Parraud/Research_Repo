import type * as PdfJs from "pdfjs-dist";
// Vite emits the worker as a hashed asset and gives us its URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let loaded: Promise<typeof PdfJs> | null = null;

/** Loads pdf.js on first use (kept out of the main bundle) and points it at the bundled worker. */
export function loadPdfjs(): Promise<typeof PdfJs> {
  loaded ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return loaded;
}
