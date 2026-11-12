export interface DebouncedSaver {
  /** Remember the latest page; it is saved after `delayMs` without further changes. */
  schedule: (page: number) => void;
  /** Save the pending page right now (e.g. when leaving the source). */
  flush: () => void;
  cancel: () => void;
}

/**
 * Debounces "last page read" saves. A page equal to the last saved one (or the
 * baseline, i.e. the page the source opened at) never triggers a request.
 */
export function createDebouncedSaver(
  save: (page: number) => void,
  baselinePage: number,
  delayMs = 1500,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: number | null = null;
  let lastSaved = baselinePage;

  const fire = () => {
    timer = null;
    if (pending !== null && pending !== lastSaved) {
      lastSaved = pending;
      save(pending);
    }
    pending = null;
  };

  return {
    schedule(page) {
      pending = page;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      fire();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
