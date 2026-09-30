"use client";

// "Add Line Item" — pick parts from inventory by manufacturer (upfithq-style).
// Left: manufacturers with part counts. Right: search (scan a barcode, or type
// a part # / name) with each part's price and stock ("9 avail · 0 cmtd").
// Clicking a part adds it and keeps the window open so several parts can be
// added in a row; Enter adds the top result (barcode scanners type + Enter).

import { useCallback, useEffect, useRef, useState } from "react";
import type { PartHit } from "@/components/PartSearchCombobox";

type Mfr = { id: string; name: string; count: number };
type MfrList = { total: number; unassigned: number; manufacturers: Mfr[] };

// Cached for the page's life: the list rarely changes while quoting.
let mfrCache: MfrList | null = null;

function money(v: string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function AddLineItemModal({
  open,
  initialManufacturer,
  onClose,
  onPick,
  onCustomItem,
}: {
  open: boolean;
  /** Manufacturer to start on: a vendor id, "none" (no manufacturer), or null for all. */
  initialManufacturer: string | null;
  onClose: () => void;
  onPick: (part: PartHit) => void;
  onCustomItem: () => void;
}) {
  const [mfrs, setMfrs] = useState<MfrList | null>(mfrCache);
  const [mfr, setMfr] = useState<string | null>(initialManufacturer);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PartHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; n: number } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const reqId = useRef(0);

  // Reset to the requested manufacturer each time the window opens.
  useEffect(() => {
    if (!open) return;
    setMfr(initialManufacturer);
    setQ("");
    setAdded(null);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open, initialManufacturer]);

  useEffect(() => {
    if (!open || mfrCache) return;
    fetch("/api/parts/manufacturers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MfrList | null) => {
        if (d) {
          mfrCache = d;
          setMfrs(d);
        }
      })
      .catch(() => {});
  }, [open]);

  const search = useCallback(async (query: string, manufacturer: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query, limit: "40", stock: "1" });
    if (manufacturer) params.set("manufacturerId", manufacturer);
    try {
      const res = await fetch(`/api/parts/search?${params}`);
      if (!res.ok) throw new Error();
      const rows = (await res.json()) as PartHit[];
      if (id === reqId.current) setResults(rows);
    } catch {
      if (id === reqId.current) setError("Couldn't load parts. Check your connection.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Debounced search as the rep types or switches manufacturer.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void search(q.trim(), mfr), 200);
    return () => window.clearTimeout(t);
  }, [open, q, mfr, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pick = (p: PartHit) => {
    onPick(p);
    setAdded((cur) => ({ id: p.id, n: cur?.id === p.id ? cur.n + 1 : 1 }));
  };

  if (!open) return null;

  const mfrButtons: { key: string | null; label: string; count: number | null }[] = [
    { key: null, label: "All products", count: mfrs?.total ?? null },
    ...(mfrs?.manufacturers ?? []).map((m) => ({ key: m.id, label: m.name, count: m.count })),
    ...(mfrs && mfrs.unassigned > 0 ? [{ key: "none", label: "No manufacturer", count: mfrs.unassigned }] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-line-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[min(88vh,820px)] bg-surface border border-white/10 rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 id="add-line-title" className="font-ui font-bold text-2xl text-white">
            Add Line Item
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[290px_minmax(0,1fr)]">
          {/* Manufacturers */}
          <nav
            aria-label="Manufacturers"
            className="border-b md:border-b-0 md:border-r border-white/10 p-4 overflow-x-auto md:overflow-y-auto flex md:flex-col gap-2 shrink-0"
          >
            {mfrButtons.map((m) => {
              const active = m.key === mfr;
              return (
                <button
                  key={m.key ?? "all"}
                  type="button"
                  onClick={() => setMfr(m.key)}
                  aria-pressed={active}
                  className={`shrink-0 flex items-center justify-between gap-3 rounded-full border px-4 py-2 font-ui font-bold uppercase tracking-[0.06em] text-sm text-left ${
                    active
                      ? "bg-[var(--color-cta)] border-transparent text-[var(--color-cta-ink)]"
                      : "border-white/15 text-zinc-200 hover:border-white/30"
                  }`}
                >
                  <span className="truncate">{m.label}</span>
                  {m.count != null ? <span className={active ? "opacity-80" : "text-zinc-400"}>{m.count}</span> : null}
                </button>
              );
            })}
            {!mfrs ? <span className="text-xs text-zinc-500 px-2">Loading…</span> : null}
          </nav>

          {/* Search + results */}
          <div className="flex flex-col min-h-0 p-4 sm:p-5 gap-3">
            <label className="block shrink-0">
              <span className="label-caps">Search inventory</span>
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (results[0]) {
                      pick(results[0]);
                      setQ("");
                    }
                  }
                }}
                placeholder="Scan a barcode, or type a part number or name…"
                className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500"
              />
            </label>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/10">
              {error ? <p className="p-4 text-sm text-red-400">{error}</p> : null}
              {!error && !loading && results.length === 0 ? (
                <p className="p-4 text-sm text-zinc-400">No parts match. Try another word, or add a custom item below.</p>
              ) : null}
              {results.map((p) => {
                const avail = p.available ?? p.quantityOnHand ?? 0;
                const tone = avail > 0 ? "text-green-400" : avail === 0 ? "text-amber-400" : "text-red-400";
                const justAdded = added?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="w-full text-left px-4 py-3 hover:bg-white/5 flex items-start justify-between gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block text-white">{p.name}</span>
                      {p.description ? (
                        <span className="block text-sm text-zinc-400 truncate">{p.description}</span>
                      ) : null}
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        {p.manufacturerName ? (
                          <span className="label-caps !text-[var(--color-cta)] bg-white/5 rounded-full px-2.5 py-0.5">
                            {p.manufacturerName}
                          </span>
                        ) : null}
                        <span className="text-sm text-zinc-400 font-mono">{p.mfgPartNumber || p.sku}</span>
                        {p.restricted ? (
                          <span className="text-[11px] text-red-300 border border-red-500/40 rounded px-1.5">restricted</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-mono font-bold text-white">{money(p.price)}</span>
                      <span className={`block text-sm ${tone}`}>
                        {avail} avail · {p.committed ?? 0} cmtd
                      </span>
                      <span className="block text-xs text-zinc-500">{p.quantityOnHand ?? 0} on hand</span>
                      {justAdded ? (
                        <span className="block text-xs font-semibold text-[var(--color-cta)] mt-1">
                          ✓ Added{added && added.n > 1 ? ` ×${added.n}` : ""}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onCustomItem();
                  onClose();
                }}
                className="btn-outline btn-sm"
              >
                + Custom item (not in inventory)
              </button>
              <button type="button" onClick={onClose} className="btn-cta">
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
