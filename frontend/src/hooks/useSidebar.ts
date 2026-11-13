import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_STORAGE_KEY = "researchRepo.sidebarOpen";
export const NARROW_QUERY = "(max-width: 800px)";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStored(open: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
  } catch {
    // Storage can be blocked (private mode); the sidebar still works for this session.
  }
}

function isNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

export interface SidebarState {
  open: boolean;
  /** True on narrow screens, where the sidebar overlays the content. */
  overlay: boolean;
  toggle: () => void;
  close: () => void;
  /** Call after a project is chosen: closes the overlay on narrow screens only. */
  onProjectChosen: () => void;
}

/**
 * Sidebar visibility. On wide screens the choice is remembered per browser; on narrow screens the
 * sidebar is a transient overlay that always starts closed and is never persisted.
 */
export function useSidebar(): SidebarState {
  const [desktopOpen, setDesktopOpen] = useState(readStored);
  const [overlay, setOverlay] = useState(isNarrow);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      setOverlay(query.matches);
      setOverlayOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const open = overlay ? overlayOpen : desktopOpen;

  const toggle = useCallback(() => {
    if (overlay) {
      setOverlayOpen((value) => !value);
    } else {
      const next = !desktopOpen;
      setDesktopOpen(next);
      writeStored(next);
    }
  }, [overlay, desktopOpen]);

  const close = useCallback(() => {
    if (overlay) setOverlayOpen(false);
  }, [overlay]);

  useEffect(() => {
    if (!overlay || !overlayOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlayOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, overlayOpen]);

  return { open, overlay, toggle, close, onProjectChosen: close };
}
