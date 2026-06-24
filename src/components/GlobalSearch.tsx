"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SearchHit = {
  type: "customer" | "lead" | "quote" | "work_order";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type SearchResponse = {
  customers: SearchHit[];
  leads: SearchHit[];
  quotes: SearchHit[];
  workOrders: SearchHit[];
};

const GROUPS: { key: keyof SearchResponse; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "leads", label: "Leads" },
  { key: "quotes", label: "Quotes" },
  { key: "workOrders", label: "Work Orders" },
];

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: ctl.signal },
        );
        if (!res.ok) {
          setResults(null);
          return;
        }
        const data = (await res.json()) as SearchResponse;
        setResults(data);
      } catch {
        // ignore aborts
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
  }, [q]);

  const totalHits =
    (results?.customers.length ?? 0) +
    (results?.leads.length ?? 0) +
    (results?.quotes.length ?? 0) +
    (results?.workOrders.length ?? 0);

  return (
    <div ref={wrapRef} className="relative w-full sm:w-72">
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L13 13" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search customers, leads, quotes, work orders…"
          className="w-full pl-8 pr-3 py-1.5 text-xs font-body bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
        />
      </div>
      {open && q.trim().length >= 2 ? (
        <div className="absolute right-0 top-full mt-1 w-96 max-h-[60vh] overflow-y-auto z-50 bg-zinc-950 border border-white/10 rounded-md shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-zinc-500 font-body">
              Searching…
            </div>
          ) : !results || totalHits === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500 font-body">
              No results.
            </div>
          ) : (
            GROUPS.map(({ key, label }) => {
              const hits = results[key];
              if (!hits || hits.length === 0) return null;
              return (
                <div key={key} className="border-b border-white/5 last:border-0">
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                    {label}
                  </div>
                  {hits.map((hit) => (
                    <Link
                      key={`${hit.type}-${hit.id}`}
                      href={hit.href}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 text-xs font-body hover:bg-white/5 transition-colors"
                    >
                      <div className="text-white truncate">{hit.title}</div>
                      {hit.subtitle ? (
                        <div className="text-zinc-500 text-[11px] truncate">
                          {hit.subtitle}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
