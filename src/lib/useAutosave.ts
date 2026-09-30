"use client";

// Debounced auto-save shared by the estimate editor and the vehicle
// configurator. Give it a plain-data snapshot of what's on screen and a
// save function; it saves ~1s after the last change, one save at a time
// and in order, and only when the snapshot differs from what was last
// saved. `flush()` saves immediately (use it before navigating away) and
// resolves true once everything on screen is saved.

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveState = "saved" | "dirty" | "saving" | "error";

export function useAutosave<T>(
  snapshot: T,
  save: (snap: T) => Promise<void>,
  opts?: { delayMs?: number; enabled?: boolean },
) {
  const delay = opts?.delayMs ?? 1000;
  const enabled = opts?.enabled ?? true;

  const serialized = JSON.stringify(snapshot);
  const latestRef = useRef({ snapshot, serialized });
  latestRef.current = { snapshot, serialized };
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // What's on screen at first render is, by definition, what's saved.
  const lastSavedRef = useRef(serialized);
  const timerRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<AutosaveState>("saved");

  const isDirty = useCallback(
    () => enabledRef.current && latestRef.current.serialized !== lastSavedRef.current,
    [],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    chainRef.current = chainRef.current.then(async () => {
      const { snapshot: snap, serialized: ser } = latestRef.current;
      if (!enabledRef.current || ser === lastSavedRef.current) return;
      setState("saving");
      try {
        await saveRef.current(snap);
        lastSavedRef.current = ser;
        setState(latestRef.current.serialized === ser ? "saved" : "dirty");
      } catch {
        setState("error");
        // Retry shortly; any further edit also retries.
        timerRef.current = window.setTimeout(() => void flush(), 5000);
      }
    });
    return chainRef.current.then(() => !isDirty());
  }, [isDirty]);

  useEffect(() => {
    if (!enabled || serialized === lastSavedRef.current) return;
    setState((s) => (s === "saving" ? s : "dirty"));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), delay);
  }, [serialized, enabled, delay, flush]);

  // Warn before closing the tab with an unsaved change.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  return { state, flush, isDirty };
}

export function autosaveLabel(state: AutosaveState): string {
  switch (state) {
    case "saving":
      return "Saving…";
    case "dirty":
      return "Unsaved changes";
    case "error":
      return "Couldn't save — retrying";
    default:
      return "All changes saved";
  }
}
