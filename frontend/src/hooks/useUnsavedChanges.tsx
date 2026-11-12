import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface UnsavedApi {
  /** Marks a piece of UI (by key) as holding unsaved changes or not. */
  setDirty: (key: string, dirty: boolean) => void;
  /** Runs `action` now, or after the user confirms discarding unsaved changes. */
  guard: (action: () => void) => void;
}

const UnsavedContext = createContext<UnsavedApi | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const dirtyKeys = useRef(new Set<string>());
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirtyKeys.current.size > 0) event.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.add(key);
    else dirtyKeys.current.delete(key);
  }, []);

  const guard = useCallback((action: () => void) => {
    if (dirtyKeys.current.size === 0) action();
    else setPending(() => action);
  }, []);

  const api = useMemo(() => ({ setDirty, guard }), [setDirty, guard]);

  return (
    <UnsavedContext.Provider value={api}>
      {children}
      {pending && (
        <ConfirmDialog
          title={t("unsaved.title")}
          description={t("unsaved.body")}
          confirmLabel={t("unsaved.discard")}
          danger
          onClose={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            dirtyKeys.current.clear();
            action();
          }}
        />
      )}
    </UnsavedContext.Provider>
  );
}

export function useUnsavedGuard(): UnsavedApi {
  const context = useContext(UnsavedContext);
  if (!context) throw new Error("useUnsavedGuard must be used inside <UnsavedChangesProvider>");
  return context;
}

/** Registers the dirty flag of one component and clears it on unmount. */
export function useDirtyFlag(key: string, dirty: boolean) {
  const { setDirty } = useUnsavedGuard();
  useEffect(() => {
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [key, dirty, setDirty]);
}
