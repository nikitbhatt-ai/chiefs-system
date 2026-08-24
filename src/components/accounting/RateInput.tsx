"use client";

import { useState } from "react";

/**
 * Dollar-amount field for hourly labor rates.
 *
 * Shows a `$` adornment and normalises to two decimals on blur, so the field
 * reads like money while it is being typed — not only after a save. Typing
 * `95` leaves `$95.00` in the box.
 *
 * Deliberately uncontrolled from the server's point of view: it keeps a `name`
 * and posts with the surrounding server-action form, so the page stays a server
 * component. The value is parsed server-side by `dollarsToCents`, which already
 * tolerates `$`, commas and bare integers — this is presentation, not
 * validation.
 *
 * Empty stays empty rather than becoming `$0.00`: clearing a person's field is
 * how you drop their override and fall back to the shop default.
 */
export function RateInput({
  name,
  defaultValue,
  ariaLabel,
  /**
   * Left blank for per-person rows on purpose. With the `$` adornment in front
   * of it, a "0.00" placeholder reads as an entered zero rate rather than "this
   * person inherits the shop default" — an empty box next to the `$` is
   * unambiguous.
   */
  placeholder = "",
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  function normalise() {
    const cleaned = value.replace(/[$,\s]/g, "").trim();
    if (!cleaned) {
      setValue("");
      return;
    }
    const n = Number(cleaned);
    setValue(Number.isFinite(n) && n >= 0 ? n.toFixed(2) : "");
  }

  return (
    <div className="relative w-32">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"
      >
        $
      </span>
      <input
        name={name}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={normalise}
        placeholder={placeholder}
        className="w-full bg-black/40 border border-white/10 rounded-md pl-6 pr-2 py-1.5 text-sm text-white text-right"
      />
    </div>
  );
}
