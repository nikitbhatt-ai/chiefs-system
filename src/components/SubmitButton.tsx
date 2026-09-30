"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { beginWork } from "@/components/WorkIndicator";

/**
 * A submit button that tells you something is happening.
 *
 * Every form in this app posts to a server action, and a server action takes as
 * long as the database takes. Before this, the button did nothing at all in the
 * meantime: no press state, no spinner, no disable — so you could not tell
 * whether your click registered, whether it was still working, or whether it had
 * already saved. The usual result is clicking it again.
 *
 * Three signals, in the order you need them:
 *   1. Press   — the `:active` state in globals.css, instant, on mouse-down.
 *   2. Working — `data-pending` disables the button, swaps in a spinner, and
 *                sets `cursor: wait` and `aria-busy` for screen readers.
 *   3. Done    — `data-saved` flashes the button for a moment when the action
 *                finishes, which is the "did it work?" answer.
 *
 * Requirements: it must be a DESCENDANT of a form with a server action.
 * `useFormStatus` reads the status of the form above it, so a button outside a
 * form, or in a `method="get"` form, reports nothing (the browser handles those
 * navigations itself, and its own loading indicator covers them).
 *
 * Note: React 19 does not emit `type="submit"` into the HTML, because submit is
 * already the default for a button inside a form — the DOM *property* is still
 * "submit" and the behaviour is identical. Don't write selectors or styles
 * against `[type="submit"]`; nothing in this app does.
 */

/**
 * Shortest time the working state stays on screen. Long enough to read as "it is
 * doing something" rather than a flash; short enough not to feel padded on an
 * action that really is instant.
 */
const MIN_WORKING_MS = 550;

type Props = Omit<ComponentProps<"button">, "type"> & {
  /** Replaces the label while the action runs. Omit to keep the label as-is. */
  pendingLabel?: ReactNode;
};

export function SubmitButton({ children, disabled, onClick, pendingLabel, ...rest }: Props) {
  const { pending } = useFormStatus();

  // A form can hold several submit buttons (Approve / Void / Delete), and
  // useFormStatus reports the FORM's status — so without this every one of them
  // would spin at once and imply the wrong action is running. Only the button
  // that was actually pressed shows the spinner; the rest just disable, which is
  // what stops a double-submit.
  const [pressed, setPressed] = useState(false);

  // Held so the working state is actually SEEN. Measured on /packages against a
  // production build: a real save set `pending` for ~128ms — 8 frames out of 245
  // — which reads as a flicker, not as feedback, and was reported as the button
  // doing nothing at all. A spinner has to survive long enough to register.
  //
  // It also carries the state through a redirect. `pending` drops the moment the
  // action returns, but on a form that redirects the page is still navigating
  // for some time after that, and the button stays mounted throughout — without
  // the hold it goes idle and sits there looking untouched while you wait.
  const [holding, setHolding] = useState(false);
  const working = (pending || holding) && pressed;

  const [justSaved, setJustSaved] = useState(false);
  // A latch, not an edge. Watching for the pending true→false transition missed
  // the flash entirely: at that moment the hold is still running, so firing is
  // deferred — and by the time the hold ends, the transition has long passed.
  // The latch survives both and fires once, when the button is genuinely idle.
  const sawSubmission = useRef(false);

  // The timer lives in a ref, NOT in the effect's cleanup. Returning a cleanup
  // here would clear it the instant `pending` flipped back to false — which is
  // exactly when the hold is supposed to start counting — leaving `holding` stuck
  // on and the button disabled forever.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pending) return;
    setHolding(true);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
    }, MIN_WORKING_MS);
  }, [pending]);

  useEffect(() => () => void (holdTimer.current && clearTimeout(holdTimer.current)), []);

  useEffect(() => {
    if (pending) sawSubmission.current = true;
  }, [pending]);

  // Drive the page-level bar as well. On a form that redirects, or one whose
  // revalidation replaces this row, the button is gone within ~80ms — the bar is
  // the only thing left to show the click did something.
  useEffect(() => {
    if (!pending) return;
    return beginWork();
  }, [pending]);

  useEffect(() => {
    // Idle again — spinner done AND hold elapsed. Now the flash means "finished".
    if (pending || holding || !sawSubmission.current) return;
    sawSubmission.current = false;
    setPressed(false);
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1400);
    return () => clearTimeout(t);
  }, [pending, holding]);

  return (
    <button
      {...rest}
      disabled={disabled || pending || holding}
      aria-busy={working || undefined}
      data-pending={working ? "" : undefined}
      data-saved={justSaved ? "" : undefined}
      onClick={(e) => {
        setPressed(true);
        onClick?.(e);
      }}
    >
      {working && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
