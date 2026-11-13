import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Minimal shape of a keyboard event that the Escape rule needs. */
export interface EscapeEventLike {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
}

/**
 * Whether an Escape key press should leave expanded mode. Handlers that already used the key
 * (for example the search box clearing its text) mark the event as default-prevented, so the
 * first Escape clears the search and only a later one collapses the viewer.
 */
export function shouldCollapseOnEscape(event: EscapeEventLike, expanded: boolean): boolean {
  return expanded && event.key === "Escape" && !event.defaultPrevented && !event.isComposing;
}

export interface ExpandedViewer {
  expanded: boolean;
  toggle: () => void;
  collapse: () => void;
}

/**
 * In-page "expanded" mode for the viewer (a fixed overlay driven by CSS), with the browser
 * Fullscreen API layered on as a progressive enhancement. The in-page mode never depends on it.
 */
export function useExpandedViewer(elementRef: RefObject<HTMLElement | null>): ExpandedViewer {
  const [expanded, setExpanded] = useState(false);
  const inFullscreen = useRef(false);

  const exitFullscreen = useCallback(() => {
    if (!inFullscreen.current) return;
    inFullscreen.current = false;
    if (document.fullscreenElement) {
      void Promise.resolve(document.exitFullscreen?.()).catch(() => undefined);
    }
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
    const element = elementRef.current;
    if (!element || typeof element.requestFullscreen !== "function") return;
    try {
      Promise.resolve(element.requestFullscreen())
        .then(() => {
          inFullscreen.current = true;
        })
        .catch(() => undefined); // Denied or unsupported: the in-page overlay still works.
    } catch {
      // Ignore: progressive enhancement only.
    }
  }, [elementRef]);

  const collapse = useCallback(() => {
    setExpanded(false);
    exitFullscreen();
  }, [exitFullscreen]);

  const toggle = useCallback(() => {
    if (expanded) collapse();
    else expand();
  }, [expanded, collapse, expand]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldCollapseOnEscape(event, true)) collapse();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapse]);

  // The browser leaves fullscreen on its own Escape handling: leave expanded mode with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && inFullscreen.current) {
        inFullscreen.current = false;
        setExpanded(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      exitFullscreen();
    };
  }, [exitFullscreen]);

  return { expanded, toggle, collapse };
}
