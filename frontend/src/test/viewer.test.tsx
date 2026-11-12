import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { PdfViewer } from "../features/viewer/PdfViewer";
import { useLastPageSaver } from "../features/viewer/useLastPageSaver";
import { loadPdfjs } from "../features/viewer/pdfjs";
import { baseRoutes, bodyOf, makeSource } from "./fixtures";
import { jsonResponse, mockApi, renderApp } from "./helpers";

// pdf.js needs a real browser (canvas, workers); unit tests drive the viewer with a fake.
vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn() }));

const PAGE_TEXT = "Hello world";

function fakePage() {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    streamTextContent: () => ({}),
    getTextContent: () => Promise.resolve({ items: [{ str: PAGE_TEXT, hasEOL: false }] }),
    cleanup: () => undefined,
  };
}

class FakeTextLayer {
  textDivs: HTMLElement[] = [];
  textContentItemsStr: string[] = [];
  constructor(public options: unknown) {}
  render() {
    return Promise.resolve();
  }
  cancel() {}
}

function installPdfjs(numPages = 3, failWith?: unknown) {
  const destroy = vi.fn(() => Promise.resolve());
  const getDocument = vi.fn(() => ({
    promise: failWith ? Promise.reject(failWith) : Promise.resolve({ numPages, getPage: () => Promise.resolve(fakePage()) }),
    destroy,
  }));
  vi.mocked(loadPdfjs).mockResolvedValue({ getDocument, TextLayer: FakeTextLayer } as unknown as Awaited<ReturnType<typeof loadPdfjs>>);
  return { getDocument, destroy };
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 800 } }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: false }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

describe("PdfViewer", () => {
  it("opens the file URL with credentials and range requests enabled, and shows the page count", async () => {
    const { getDocument } = installPdfjs(3);
    render(<PdfViewer sourceId="s1" initialPage={2} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });

    expect(screen.getByRole("status")).toHaveTextContent("Opening PDF…");
    expect(await screen.findByText("of 3")).toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/sources/s1/file", withCredentials: true, disableRange: false }),
    );
    // Opens at last_page_read.
    expect(screen.getByLabelText("Page number")).toHaveValue("2");
    expect(screen.getByRole("region", { name: "PDF pages" })).toBeInTheDocument();
  });

  it("clamps an out-of-range last page and supports page jump and zoom controls", async () => {
    installPdfjs(3);
    render(<PdfViewer sourceId="s1" initialPage={99} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });
    await screen.findByText("of 3");
    const input = screen.getByLabelText("Page number");
    expect(input).toHaveValue("3");

    await userEvent.clear(input);
    await userEvent.type(input, "1{Enter}");
    expect(screen.getByLabelText("Page number")).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByLabelText("Page number")).toHaveValue("2");

    const zoomText = () => screen.getByRole("group", { name: "Zoom" }).textContent ?? "";
    const before = zoomText();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomText()).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Fit width" }));
    expect(zoomText()).toBe(before);
  });

  it("searches the whole document and steps through matches", async () => {
    installPdfjs(3);
    render(<PdfViewer sourceId="s1" initialPage={1} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });
    await screen.findByText("of 3");

    await userEvent.type(screen.getByLabelText("Search in document"), "WORLD");
    expect(await screen.findByText("1 of 3", undefined, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous match" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search in document"));
    await userEvent.type(screen.getByLabelText("Search in document"), "zzz");
    expect(await screen.findByText("No matches", undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("shows a translated error for a missing file and can retry", async () => {
    const { getDocument } = installPdfjs(3, { status: 404, name: "ResponseException" });
    render(<PdfViewer sourceId="s1" initialPage={1} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });
    expect(await screen.findByRole("alert")).toHaveTextContent("This source has no PDF attached.");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));
  });

  it("shows a generic translated error for other failures", async () => {
    installPdfjs(3, new Error("boom"));
    render(<PdfViewer sourceId="s1" initialPage={1} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });
    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF could not be opened.");
  });

  it("releases the document when closed", async () => {
    const { destroy } = installPdfjs(2);
    const { unmount } = render(<PdfViewer sourceId="s1" initialPage={1} canSaveProgress onClose={() => undefined} />, { wrapper: Providers });
    await screen.findByText("of 2");
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("source pane with the viewer", () => {
  it("opens a PDF source: viewer, details strip, file info", async () => {
    installPdfjs(5);
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s1": () => jsonResponse(200, makeSource({ last_page_read: 4 })),
    });
    renderApp("/p/p1?source=s1");
    expect(await screen.findByText("of 5")).toBeInTheDocument();
    expect(screen.getByLabelText("Page number")).toHaveValue("4");
    expect(screen.getByRole("heading", { name: "Alpha paper" })).toBeInTheDocument();
    expect(screen.getByText("alpha.pdf")).toBeInTheDocument();
  });

  it("closing the viewer returns to the README", async () => {
    installPdfjs(5);
    mockApi({
      ...baseRoutes({ readme: "# Front page" }),
      "GET /api/sources/s1": () => jsonResponse(200, makeSource()),
    });
    renderApp("/p/p1?source=s1");
    await screen.findByText("of 5");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Front page" })).toBeInTheDocument();
  });

  it("shows a translated error when the source does not exist", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/nope": () => jsonResponse(404, { error: { code: "source.not_found", message: "x" } }),
    });
    renderApp("/p/p1?source=nope");
    expect(await screen.findByText("Source not found. It may have been deleted.")).toBeInTheDocument();
  });
});

describe("useLastPageSaver", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient();
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one PATCH with the final page after the debounce", async () => {
    const bodies: unknown[] = [];
    mockApi({
      "PATCH /api/sources/s1": (init) => {
        bodies.push(bodyOf(init));
        return jsonResponse(200, makeSource({ last_page_read: 9 }));
      },
    });
    const { result } = renderHook(() => useLastPageSaver("s1", 1, true), { wrapper });
    act(() => {
      for (const page of [2, 5, 9]) result.current.schedule(page);
    });
    expect(bodies).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(bodies).toEqual([{ last_page_read: 9 }]);
  });

  it("flushes a pending save when the viewer unmounts", async () => {
    const bodies: unknown[] = [];
    mockApi({
      "PATCH /api/sources/s1": (init) => {
        bodies.push(bodyOf(init));
        return jsonResponse(200, makeSource({ last_page_read: 4 }));
      },
    });
    const { result, unmount } = renderHook(() => useLastPageSaver("s1", 1, true), { wrapper });
    act(() => result.current.schedule(4));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(bodies).toEqual([{ last_page_read: 4 }]);
  });

  it("never saves for viewers (disabled)", async () => {
    const fetchMock = mockApi({});
    const { result, unmount } = renderHook(() => useLastPageSaver("s1", 1, false), { wrapper });
    act(() => result.current.schedule(7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
