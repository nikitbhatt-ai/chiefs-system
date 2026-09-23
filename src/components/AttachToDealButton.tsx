"use client";

import { useEffect, useState, useTransition } from "react";
import {
  linkVehicleToDealAction,
  searchDealsAction,
} from "@/lib/dealVehicleActions";
import type { DealSearchRow } from "@/lib/dealVehicles";

// Entry point A — from the lot view. An unassigned vehicle is sitting there;
// find the deal it has just sold onto and attach it.
export function AttachToDealButton({
  vehicleId,
  label,
}: {
  vehicleId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DealSearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchDealsAction(q);
        if (!cancelled) setRows(found);
      } catch {
        if (!cancelled) setError("Could not search deals.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  function attach(dealId: string) {
    setError(null);
    startTransition(async () => {
      const res = await linkVehicleToDealAction(vehicleId, dealId);
      if (res.ok) {
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[32px] px-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-body font-semibold whitespace-nowrap hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
      >
        Attach to deal
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="bg-surface border border-white/10 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg max-h-[85vh] flex flex-col">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-display font-bold text-white">Attach to deal</h2>
              <p className="text-[12px] text-zinc-400 font-body">{label}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="w-9 h-9 rounded-full bg-white/5 text-zinc-300 text-lg leading-none"
            >
              ×
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Customer name, or deal id"
            className="mt-3 w-full min-h-[44px] bg-black/40 border border-white/10 rounded-lg px-3 text-base sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          />
        </div>

        <div className="overflow-y-auto p-2">
          {loading ? (
            <p className="p-3 text-[12px] text-zinc-500 font-body">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="p-3 text-[12px] text-zinc-500 font-body">
              No open deals match. Try the customer&apos;s name.
            </p>
          ) : (
            rows.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={pending}
                onClick={() => attach(d.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
              >
                <span className="block text-sm text-white font-body">
                  {d.customerName ?? "No customer"}
                </span>
                <span className="block text-[11px] text-zinc-500 font-body">
                  Deal {d.id.slice(0, 8)} · {d.stage.replace(/_/g, " ")}
                  {d.vin ? ` · already names VIN ${d.vin.slice(-8)}` : ""}
                </span>
              </button>
            ))
          )}
        </div>

        {error ? (
          <p className="m-3 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 font-body">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
