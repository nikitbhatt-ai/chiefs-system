"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

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
  const working = pending && pressed;

  const [justSaved, setJustSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (!pending) setPressed(false);
    if (!finished) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1400);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={working || undefined}
      data-pending={working ? "" : undefined}
      data-saved={justSaved ? "" : undefined}
      onClick={(e) => {
        setPressed(true);
        onClick?.(e);
      }}
    >
      {working && <span className="btn-spinner" aria-hidden="true" />}
      {working && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
