"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PartSearchCombobox } from "@/components/PartSearchCombobox";

type PickedPart = { id: string; sku: string; name: string; cost?: string | null };

const label = "block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1";
const input = "w-full bg-black/20 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white font-body focus:border-amber-500/50 outline-none";

export function BackfillControls() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ReorderPointForm />
      <OverridePullForm />
    </div>
  );
}

function ReorderPointForm() {
  const router = useRouter();
  const [part, setPart] = useState<PickedPart | null>(null);
  const [minQty, setMinQty] = useState("");
  const [reorderToQty, setReorderToQty] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    setErr(null);
    if (!part) return setErr("Pick a part.");
    const res = await fetch("/api/reorder-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId: part.id, minQty: Number(minQty || 0), reorderToQty: Number(reorderToQty || 0) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body?.error ?? "Could not save.");
    setMsg(`Reorder point set for ${part.sku}.`);
    setPart(null);
    setMinQty("");
    setReorderToQty("");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Set a reorder point</h3>
      <div>
        <label className={label}>Part</label>
        <PartSearchCombobox
          mode="inline"
          value={part ? `${part.sku} — ${part.name}` : ""}
          onText={() => setPart(null)}
          onPick={(p) => setPart(p)}
          placeholder="Search part by SKU, name, or part #…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Min qty (reorder when available hits this)</label>
          <input className={input} inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="2" />
        </div>
        <div>
          <label className={label}>Reorder up to</label>
          <input className={input} inputMode="numeric" value={reorderToQty} onChange={(e) => setReorderToQty(e.target.value)} placeholder="10" />
        </div>
      </div>
      {err ? <p className="text-xs text-red-400 font-body">{err}</p> : null}
      {msg ? <p className="text-xs text-emerald-400 font-body">{msg}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={!part}
        className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-4 py-2"
      >
        Save reorder point
      </button>
    </div>
  );
}

function OverridePullForm() {
  const router = useRouter();
  const [part, setPart] = useState<PickedPart | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pull() {
    setMsg(null);
    setErr(null);
    if (!part) return setErr("Pick a part.");
    if (!reason.trim()) return setErr("A reason is required.");
    const res = await fetch("/api/backfill/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId: part.id, qty: Number(qty || 0), reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body?.error ?? "Could not pull.");
    setMsg(`Pulled ${body.issued} — override logged and a backfill requisition raised.`);
    setPart(null);
    setQty("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-red-500/20 rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-body font-semibold text-red-300 uppercase tracking-wider">Override — pull reserved stock</h3>
      <p className="text-[11px] text-zinc-500 font-body">
        Use only to borrow stock reserved for another build. It issues the parts, logs who &amp; why, and immediately
        raises a backfill requisition due by the raided build&apos;s scheduled date.
      </p>
      <div>
        <label className={label}>Part</label>
        <PartSearchCombobox
          mode="inline"
          value={part ? `${part.sku} — ${part.name}` : ""}
          onText={() => setPart(null)}
          onPick={(p) => setPart(p)}
          placeholder="Search part…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Qty to pull</label>
          <input className={input} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" />
        </div>
        <div>
          <label className={label}>Reason</label>
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rush job for Dallas County" />
        </div>
      </div>
      {err ? <p className="text-xs text-red-400 font-body">{err}</p> : null}
      {msg ? <p className="text-xs text-emerald-400 font-body">{msg}</p> : null}
      <button
        type="button"
        onClick={pull}
        disabled={!part}
        className="text-xs font-body font-semibold bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white rounded-md px-4 py-2"
      >
        Override pull
      </button>
    </div>
  );
}
