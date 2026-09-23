"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  linkVehicleToDealAction,
  unlinkVehicleFromDealAction,
  searchVehiclesAction,
} from "@/lib/dealVehicleActions";
import type { VehicleSearchRow } from "@/lib/dealVehicles";

export type DealVehicleRow = {
  linkId: string;
  vehicleId: string;
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lotStatus: string;
  lotLocation: string | null;
  linkedAt: Date;
  unlinkedAt: Date | null;
  linkedByName: string | null;
};

const label = (v: { year: number | null; make: string | null; model: string | null }) =>
  [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";

// Entry point B — from the deal. "Add vehicle": search by VIN, or browse.
// The browse list defaults to on-lot and unassigned, which is a short list and
// almost always the right one.
export function DealVehicles({
  dealId,
  rows,
  canEdit,
}: {
  dealId: string;
  rows: DealVehicleRow[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<VehicleSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchVehiclesAction(q);
        if (!cancelled) setFound(r);
      } catch {
        if (!cancelled) setError("Could not search vehicles.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, adding]);

  function attach(vehicleId: string) {
    setError(null);
    startTransition(async () => {
      const res = await linkVehicleToDealAction(vehicleId, dealId);
      if (res.ok) {
        setAdding(false);
        setQ("");
      } else setError(res.error);
    });
  }

  function detach(linkId: string) {
    setError(null);
    startTransition(async () => {
      const res = await unlinkVehicleFromDealAction(linkId, dealId);
      if (!res.ok) setError(res.error);
    });
  }

  const current = rows.filter((r) => !r.unlinkedAt);
  const history = rows.filter((r) => r.unlinkedAt);

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
          Vehicles
        </h3>
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-[32px] px-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-body font-semibold hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          >
            Add vehicle
          </button>
        ) : null}
      </div>

      {current.length === 0 ? (
        <p className="text-[12px] text-zinc-500 font-body">No vehicle attached yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {current.map((r) => (
            <li
              key={r.linkId}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-white font-body truncate">{label(r)}</p>
                <p className="text-[11px] text-zinc-500 font-mono">{r.vin}</p>
                <p className="text-[11px] text-zinc-500 font-body">
                  {r.lotStatus.replace(/_/g, " ")}
                  {r.lotLocation ? ` · ${r.lotLocation}` : ""}
                  {r.linkedByName ? ` · attached by ${r.linkedByName}` : ""}
                </p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => detach(r.linkId)}
                  className="min-h-[32px] px-2.5 rounded-md border border-white/15 text-[11px] font-body text-zinc-300 hover:bg-white/5 disabled:opacity-50 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
                >
                  Detach
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by VIN, make or model — or leave blank to browse"
            className="w-full min-h-[40px] bg-black/40 border border-white/10 rounded-lg px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          />
          <p className="text-[11px] text-zinc-500 font-body">
            {q.trim()
              ? "Every unassigned vehicle that matches."
              : "On lot and unassigned."}
          </p>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {loading ? (
              <p className="text-[12px] text-zinc-500 font-body p-2">Searching…</p>
            ) : found.length === 0 ? (
              <p className="text-[12px] text-zinc-500 font-body p-2">
                Nothing available matches. A vehicle already on another deal will not appear here.
              </p>
            ) : (
              found.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={pending}
                  onClick={() => attach(v.id)}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
                >
                  <span className="block text-sm text-white font-body">{label(v)}</span>
                  <span className="block text-[11px] text-zinc-500 font-mono">
                    {v.vin}
                    <span className="font-body">
                      {" · "}
                      {v.lotStatus.replace(/_/g, " ")}
                      {v.lotLocation ? ` · ${v.lotLocation}` : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-[11px] font-body text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 font-body">
          {error}
        </p>
      ) : null}

      {history.length > 0 ? (
        <details className="pt-1">
          <summary className="text-[11px] font-body text-zinc-500 cursor-pointer hover:text-zinc-300">
            Previously attached ({history.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {history.map((r) => (
              <li key={r.linkId} className="text-[11px] font-body text-zinc-500">
                <Link href="/lot" className="hover:text-zinc-300">
                  {label(r)} · <span className="font-mono">{r.vin}</span>
                </Link>{" "}
                — detached {new Date(r.unlinkedAt!).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
