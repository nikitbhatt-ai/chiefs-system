"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { moneyInputValue, parseMoney, parseQty, parseHours } from "@/lib/money";

/**
 * The builder field primitives: money, quantity, hours.
 *
 * Two problems they exist to fix, both reported from the floor:
 *
 * 1. Money and quantities looked identical. A bare `1250` in one box and `2` in
 *    the next, same styling, and you had to know the column to know which was
 *    dollars. Money now always carries a `$` and settles to two decimals; qty
 *    and hours never do.
 *
 * 2. Pressing Enter did nothing — you had to click somewhere else for the value
 *    to take. Inside a `<form>` Enter either submitted the whole thing or was
 *    swallowed. Enter now commits the field and (where the parent passes
 *    `onEnter`) opens the next line, which is how you type a build in without
 *    reaching for the mouse.
 *
 * `value` is committed on change as you type, so nothing is ever lost if you do
 * click away; blur and Enter only normalise the display (`9.5` → `9.50`).
 */

type Common = {
  onEnter?: () => void;
  className?: string;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
  disabled?: boolean;
};

/** Enter commits, then optionally opens the next line. Never submits the form. */
function useEnterKey(commit: () => void, onEnter?: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // Always: Enter in a builder row must not submit the surrounding form and
    // save the whole document out from under someone mid-edit.
    e.preventDefault();
    commit();
    onEnter?.();
  };
}

export function MoneyInput({
  value,
  onChange,
  onEnter,
  className = "",
  ariaLabel,
  title,
  /** Blank shows as an empty box, not `$0.00` — "no cost set" ≠ "costs nothing". */
  placeholder = "",
  allowEmpty = false,
  disabled,
}: Common & {
  value: number | string | null | undefined;
  onChange: (v: number | null) => void;
  /** When true, clearing the box yields null instead of 0. */
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(() => moneyInputValue(value));
  const focused = useRef(false);

  // Follow the value when it changes from outside (markup applied to every line,
  // a package dropped in) — but never while the box is focused, or it would
  // rewrite what someone is halfway through typing.
  useEffect(() => {
    if (!focused.current) setText(moneyInputValue(value));
  }, [value]);

  function commit() {
    const n = parseMoney(text);
    if (n == null) {
      setText("");
      onChange(allowEmpty ? null : 0);
      return;
    }
    setText(n.toFixed(2));
    onChange(n);
  }

  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"
      >
        $
      </span>
      <input
        aria-label={ariaLabel}
        title={title}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseMoney(e.target.value);
          onChange(n == null ? (allowEmpty ? null : 0) : n);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={useEnterKey(commit, onEnter)}
        className="w-full bg-black/40 border border-white/10 rounded pl-5 pr-2 py-1.5 text-right text-white font-mono tabular-nums"
      />
    </div>
  );
}

/** Whole units. No `$`, no decimals — deliberately unlike the money boxes. */
export function QtyInput({
  value,
  onChange,
  onEnter,
  className = "",
  ariaLabel,
  title,
  disabled,
}: Common & { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(() => String(value ?? 0));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value ?? 0));
  }, [value]);

  function commit() {
    const n = parseQty(text);
    setText(String(n));
    onChange(n);
  }

  return (
    <input
      aria-label={ariaLabel}
      title={title}
      inputMode="numeric"
      disabled={disabled}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseQty(e.target.value));
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={useEnterKey(commit, onEnter)}
      className={`bg-black/40 border border-white/10 rounded px-2 py-1.5 text-right text-white font-mono tabular-nums ${className}`}
    />
  );
}

/** Hours — quarters allowed, still not money. */
export function HoursInput({
  value,
  onChange,
  onEnter,
  className = "",
  ariaLabel,
  disabled,
}: Common & { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(() => String(value ?? 0));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value ?? 0));
  }, [value]);

  function commit() {
    const n = parseHours(text);
    setText(String(n));
    onChange(n);
  }

  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseHours(e.target.value));
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={useEnterKey(commit, onEnter)}
      className={`bg-black/40 border border-white/10 rounded px-2 py-1.5 text-right text-white font-mono tabular-nums ${className}`}
    />
  );
}

/**
 * A percent field (line discounts, markup). Percent is not money, so no `$` —
 * but it gets the same Enter-commits behaviour as everything else in a row.
 */
export function PercentInput({
  value,
  onChange,
  onEnter,
  className = "",
  ariaLabel,
  title,
  placeholder = "",
  disabled,
}: Common & { value: number | string | null | undefined; onChange: (v: number) => void }) {
  const [text, setText] = useState(() => (value == null || value === "" ? "" : String(value)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null || value === "" ? "" : String(value));
  }, [value]);

  function commit() {
    const n = Number(String(text).replace(/[%\s]/g, ""));
    const safe = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    setText(safe === 0 ? "" : String(safe));
    onChange(safe);
  }

  return (
    <div className={`relative ${className}`}>
      <input
        aria-label={ariaLabel}
        title={title}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/[%\s]/g, ""));
          onChange(Number.isFinite(n) && n > 0 ? n : 0);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={useEnterKey(commit, onEnter)}
        className="w-full bg-black/40 border border-white/10 rounded px-2 pr-5 py-1.5 text-right text-white font-mono tabular-nums"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"
      >
        %
      </span>
    </div>
  );
}
