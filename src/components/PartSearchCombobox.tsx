"use client";

import { useEffect, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/AnchoredPopover";

export type PartHit = {
  id: string;
  sku: string;
  name: string;
  mfgPartNumber: string | null;
  price: string | null;
  cost: string | null;
  restricted: boolean;
  restrictionCategory: string | null;
};

// Server-backed part picker shared by the quote / PO / estimate editors.
// Queries /api/parts/search as the user types (debounced) so it scales to any
// catalog size — nothing is loaded into the page up front. Focusing with an
// empty box shows the first page of parts, so it also works as a browse
// dropdown. Two modes:
//   - "adder":  picking fires onPick and clears the box (add-a-line flows).
//   - "inline": the box reflects `value`, edits call onText (free-text
//               description), and picking links the part via onPick.
export function PartSearchCombobox({
  mode = "adder",
  value,
  onText,
  onPick,
  placeholder,
  className,
  allowCreate = true,
}: {
  mode?: "adder" | "inline";
  value?: string;
  onText?: (s: string) => void;
  onPick: (p: PartHit) => void;
  placeholder?: string;
  className?: string;
  // Show a "＋ Add new part" option that creates it in inventory on the fly.
  allowCreate?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const [results, setResults] = useState<PartHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const seq = useRef(0);
  // Inline "create new part" form state.
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [form, setForm] = useState({ sku: "", name: "", cost: "", price: "" });
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  function setCreatingBoth(v: boolean) {
    creatingRef.current = v;
    setCreating(v);
  }
  function openCreate() {
    setForm({ sku: text.trim(), name: "", cost: "", price: "" });
    setCreateErr(null);
    setCreatingBoth(true);
  }
  async function submitCreate() {
    const sku = form.sku.trim();
    const name = form.name.trim();
    if (!sku || !name) {
      setCreateErr("Part # and name are required.");
      return;
    }
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          name,
          cost: form.cost.trim() === "" ? null : Number(form.cost),
          price: form.price.trim() === "" ? null : Number(form.price),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Duplicate part number — surface the required message as a popup.
        if (typeof window !== "undefined") window.alert(data?.error ?? "duplicate part number detected, add appropriate part number");
        setCreateErr(data?.error ?? "duplicate part number detected, add appropriate part number");
        return;
      }
      if (!res.ok) {
        setCreateErr(data?.error ?? "Could not create part.");
        return;
      }
      const hit: PartHit = {
        id: data.id,
        sku: data.sku ?? sku,
        name: data.name ?? name,
        mfgPartNumber: null,
        price: data.price ?? (form.price.trim() === "" ? null : String(Number(form.price))),
        cost: data.cost ?? (form.cost.trim() === "" ? null : String(Number(form.cost))),
        restricted: false,
        restrictionCategory: null,
      };
      setCreatingBoth(false);
      choose(hit);
    } catch {
      setCreateErr("Network error creating part.");
    } finally {
      setCreateBusy(false);
    }
  }
  // The results panel is portalled to <body> (see AnchoredPopover) so the
  // enclosing card's `overflow-hidden` can't clip it; this anchors it.
  const anchorRef = useRef<HTMLDivElement>(null);

  // Keep inline boxes in sync when the parent updates the description.
  useEffect(() => {
    if (mode === "inline" && value !== undefined) setText(value);
  }, [value, mode]);

  async function runSearch(q: string) {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/parts/search?q=${encodeURIComponent(q)}`);
      const data = res.ok ? await res.json() : [];
      if (seq.current === my) {
        setResults(Array.isArray(data) ? data : []);
        setFocusIdx(0);
      }
    } catch {
      if (seq.current === my) setResults([]);
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }

  // Debounce searches while the menu is open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => runSearch(text.trim()), 180);
    return () => clearTimeout(t);
  }, [text, open]);

  function choose(p: PartHit) {
    onPick(p);
    setOpen(false);
    if (mode === "adder") {
      setText("");
      setResults([]);
    }
  }

  return (
    <div ref={anchorRef} className={`relative ${className ?? ""}`}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onText?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (results.length === 0) runSearch(text.trim());
        }}
        onBlur={() => setTimeout(() => { if (!creatingRef.current) setOpen(false); }, 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (results[focusIdx]) {
              e.preventDefault();
              choose(results[focusIdx]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder ?? "Search parts by SKU, name, or part #…"}
        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-sm placeholder:text-zinc-500"
      />
      <AnchoredPopover
        anchorRef={anchorRef}
        open={open && (results.length > 0 || loading || creating || (allowCreate && text.trim() !== ""))}
        className="bg-surface border border-white/10 rounded-md shadow-lg"
      >
        {creating ? (
          <div className="p-3 space-y-2 w-72" onMouseDown={(e) => e.preventDefault()}>
            <div className="text-[11px] font-body font-semibold text-white uppercase tracking-wider">Add new part</div>
            <input
              autoFocus
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              placeholder="Part # (SKU) *"
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
            />
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Name / description *"
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
            />
            <div className="flex gap-2">
              <input
                value={form.cost}
                onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                inputMode="decimal"
                placeholder="Cost"
                className="w-1/2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
              />
              <input
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                inputMode="decimal"
                placeholder="Sell price"
                className="w-1/2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
              />
            </div>
            {createErr ? <div className="text-[11px] text-red-400 font-body">{createErr}</div> : null}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCreatingBoth(false)}
                className="text-[11px] text-zinc-400 hover:text-white font-body px-2 py-1"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={submitCreate}
                className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-1 disabled:opacity-60"
              >
                {createBusy ? "Adding…" : "Create & add"}
              </button>
            </div>
          </div>
        ) : (
        <ul>
          {loading && results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500 font-body">Searching…</li>
          ) : (
            results.map((m, i) => (
              <li
                key={m.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onMouseEnter={() => setFocusIdx(i)}
                className={`px-3 py-2 text-xs font-body cursor-pointer ${i === focusIdx ? "bg-white/10" : ""}`}
              >
                <div className="text-white">
                  <span className="font-mono text-amber-400">{m.sku}</span> {m.name}
                  {m.mfgPartNumber ? <span className="ml-1 text-zinc-500">· {m.mfgPartNumber}</span> : null}
                  {m.restricted ? (
                    <span className="ml-2 inline-block text-[9px] uppercase tracking-wider rounded border border-red-500/40 bg-red-500/10 text-red-300 px-1.5 py-0.5">
                      Restricted{m.restrictionCategory ? ` · ${m.restrictionCategory.replace(/_/g, " ")}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {m.price ? `$${Number(m.price).toFixed(2)}` : "(no price set)"}
                </div>
              </li>
            ))
          )}
          {allowCreate && text.trim() !== "" && !loading ? (
            <li
              onMouseDown={(e) => {
                e.preventDefault();
                openCreate();
              }}
              className="px-3 py-2 text-xs font-body cursor-pointer border-t border-white/10 text-emerald-300 hover:bg-white/5"
            >
              ＋ Add new part{results.length === 0 ? ` “${text.trim()}”` : ""} to inventory
            </li>
          ) : null}
        </ul>
        )}
      </AnchoredPopover>
    </div>
  );
}
