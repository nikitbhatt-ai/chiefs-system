"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A page-level "something is happening" bar, because button-level feedback is
 * structurally impossible for most actions in this app.
 *
 * Measured against a production build: clicking Archive on a list row removed
 * that button from the DOM after 5 frames (~80ms), because `router.refresh()`
 * re-renders the row; "Create & build" unmounted after 78ms because the action
 * redirects. The button's spinner was perfectly correct and completely unseen —
 * it is destroyed long before anyone can perceive it. Holding state on a
 * component that is about to be replaced cannot fix that.
 *
 * This lives in AppShell, above everything that re-renders, so it survives both
 * the row swap and the navigation. It has a minimum on-screen time for the same
 * reason the buttons do: the work itself is often faster than perception.
 */

let active = 0;
/**
 * When the bar is owed until, as a timestamp — deliberately OUTSIDE React.
 *
 * A redirecting action navigates, which remounts this component, which would
 * reset any state it held: measured at 99ms of bar before the new page wiped it.
 * A module-level deadline survives the remount, so the freshly mounted indicator
 * on the new page picks up the remainder and the bar spans the navigation.
 */
let showUntil = 0;
const listeners = new Set<(n: number) => void>();
const emit = () => listeners.forEach((l) => l(active));

/**
 * Mark the start of some work. Returns the function that ends it; calling it
 * more than once is safe. Both SubmitButton and useBusy call this, so form
 * submits and client-side fetches drive the same indicator.
 */
export function beginWork(): () => void {
  active += 1;
  showUntil = Math.max(showUntil, Date.now() + MIN_VISIBLE_MS);
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    emit();
  };
}

/** Minimum time the bar stays up, so fast work is still visible. */
const MIN_VISIBLE_MS = 600;

export function WorkIndicator() {
  const pathname = usePathname();
  const [, tick] = useState(0);
  // Rendered only after mount: `visible` is derived from a clock, and computing
  // it during SSR would disagree with the client and trip a hydration mismatch.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  // A navigation means the work that triggered it has landed. Also a safety net:
  // a component that unmounts mid-flight cannot always run its cleanup, and a bar
  // stuck on forever is worse than no bar. The deadline is left alone, so the bar
  // still finishes its minimum on the page it lands on.
  useEffect(() => {
    active = 0;
    emit();
  }, [pathname]);

  const remaining = showUntil - Date.now();
  const visible = mounted && (active > 0 || remaining > 0);

  useEffect(() => {
    if (!visible || remaining <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), remaining + 20);
    return () => clearTimeout(t);
  }, [visible, remaining]);

  if (!visible) return null;
  return (
    <div className="work-indicator" role="status" aria-live="polite" aria-label="Working">
      <span />
    </div>
  );
}
