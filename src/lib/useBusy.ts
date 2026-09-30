"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beginWork } from "@/components/WorkIndicator";

/**
 * Shortest time a busy state stays on screen. Shared with SubmitButton so a
 * form save and a client-side fetch feel identical.
 *
 * Measured against a production build: a real save held its pending state for
 * ~30–130ms, which is 2–8 frames. That is not slow, it is invisible — and an
 * invisible working state is indistinguishable from a button that does nothing,
 * which is exactly how it was reported.
 */
export const MIN_BUSY_MS = 550;

/**
 * Busy state for buttons that do their own async work — `fetch` + `router.refresh()`
 * rather than a form action. `useFormStatus` cannot see those, so SubmitButton
 * does not help them.
 *
 * Wrap the handler with `run` and spread `props` onto the button:
 *
 *   const { run, props } = useBusy();
 *   <button {...props} onClick={() => run(() => patch({ archived: true }))}>
 *
 * `props` sets `data-pending`, which is the same hook the global CSS uses for
 * the spinner and `cursor: wait`, so these buttons look like every other one.
 */
export function useBusy(minMs: number = MIN_BUSY_MS) {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T> | T): Promise<T | undefined> => {
      setBusy(true);
      const startedAt = Date.now();
      // The row this button sits in is usually replaced by the refresh it
      // triggers, taking the button (and its spinner) with it — so the
      // page-level bar carries the signal instead.
      const endWork = beginWork();
      try {
        return await fn();
      } finally {
        endWork();
        // Hold out the remainder of the minimum, so a 30ms round trip still
        // reads as "it is working" instead of flickering.
        const remaining = Math.max(0, minMs - (Date.now() - startedAt));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          // The row this button lives in is often replaced by the refresh it
          // triggered, so check before setting state on a dead component.
          if (mounted.current) setBusy(false);
        }, remaining);
      }
    },
    [minMs],
  );

  return {
    busy,
    run,
    props: {
      disabled: busy,
      "aria-busy": busy || undefined,
      "data-pending": busy ? "" : undefined,
    } as const,
  };
}
