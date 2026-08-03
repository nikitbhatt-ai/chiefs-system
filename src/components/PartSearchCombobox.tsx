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
}: {
  mode?: "adder" | "inline";
  value?: string;
  onText?: (s: string) => void;
  onPick: (p: PartHit) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const [results, setResults] = useState<PartHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const seq = useRef(0);
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
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
        open={open && (results.length > 0 || loading)}
        className="bg-[#161624] border border-white/10 rounded-md shadow-lg"
      >
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
        </ul>
      </AnchoredPopover>
    </div>
  );
}
