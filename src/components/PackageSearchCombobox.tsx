"use client";

import { useEffect, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import type { PackageComponent } from "@/db/schema";
import { packageValue, packageCounts } from "@/lib/packages";

export type PackageHit = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  components: PackageComponent[];
};

// Server-backed package picker for the quote editor's "+ Add package" control.
// Queries /api/packages/search as the user types (debounced) and returns the
// full components array, so picking a package can expand it onto the quote
// with no second round-trip. Focusing with an empty box shows the first page,
// so it also works as a browse dropdown. Always an "adder": picking fires
// onPick and clears the box.
export function PackageSearchCombobox({
  onPick,
  placeholder,
  className,
}: {
  onPick: (p: PackageHit) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<PackageHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const seq = useRef(0);
  // Results panel is portalled to <body> so the enclosing card's
  // `overflow-hidden` can't clip it; this anchors it.
  const anchorRef = useRef<HTMLDivElement>(null);

  async function runSearch(q: string) {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/packages/search?q=${encodeURIComponent(q)}`);
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

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => runSearch(text.trim()), 180);
    return () => clearTimeout(t);
  }, [text, open]);

  function choose(p: PackageHit) {
    onPick(p);
    setOpen(false);
    setText("");
    setResults([]);
  }

  return (
    <div ref={anchorRef} className={`relative ${className ?? ""}`}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
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
        placeholder={placeholder ?? "+ Add a package…"}
        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-sm placeholder:text-zinc-500"
      />
      <AnchoredPopover
        anchorRef={anchorRef}
        open={open && (results.length > 0 || loading)}
        className="bg-surface border border-white/10 rounded-md shadow-lg"
      >
        <ul>
          {loading && results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500 font-body">Searching…</li>
          ) : (
            results.map((m, i) => {
              const c = packageCounts(m.components ?? []);
              return (
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
                    {m.name}
                    {m.category ? <span className="ml-1 text-zinc-500">· {m.category}</span> : null}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {c.parts} part{c.parts === 1 ? "" : "s"}
                    {c.labor ? ` · ${c.labor} labor` : ""}
                    {c.fees ? ` · ${c.fees} fee${c.fees === 1 ? "" : "s"}` : ""}
                    {" · "}
                    {packageValue(m.components ?? []).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </AnchoredPopover>
    </div>
  );
}
