"use client";

// Type-ahead customer search: matches name, town/address or email as you
// type. Used by the New Estimate pop-up and the estimate's Bill To
// "Change" button.

import { useMemo, useState } from "react";

export type PickerCustomer = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  phone?: string | null;
  taxExempt?: boolean;
};

export function CustomerPicker({
  customers,
  value,
  onChange,
  autoFocus = false,
}: {
  customers: PickerCustomer[];
  value: string | null;
  onChange: (id: string | null) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) =>
        [c.name, c.address ?? "", c.email ?? ""].some((f) => f.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [customers, query]);

  return (
    <div className="relative">
      <input
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a result lands before the list closes.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Type a name, town, or email…"
        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && matches.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-surface border border-white/15 rounded-xl shadow-xl"
        >
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-white/5"
              >
                <div className="text-sm text-white">{c.name}</div>
                {c.address || c.email ? (
                  <div className="text-xs text-zinc-500 truncate">
                    {[c.address, c.email].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && query.trim() && matches.length === 0 ? (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-white/15 rounded-xl px-4 py-3 text-sm text-zinc-400">
          No customer matches “{query.trim()}”.{" "}
          <a href="/crm" className="underline hover:text-white">
            Add a new customer
          </a>
        </div>
      ) : null}
      <p className="text-xs text-zinc-500 mt-1.5">
        {selected ? (
          <>
            Chosen: <span className="text-zinc-200">{selected.name}</span>{" "}
            <button type="button" onClick={() => onChange(null)} className="underline hover:text-white ml-1">
              clear
            </button>
          </>
        ) : (
          "No customer chosen yet."
        )}
      </p>
    </div>
  );
}
