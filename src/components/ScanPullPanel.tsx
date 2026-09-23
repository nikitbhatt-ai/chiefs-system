"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraScanner } from "@/components/CameraScanner";
import { PartSearchCombobox } from "@/components/PartSearchCombobox";
import { beep, setScanCapture } from "@/components/scanCapture";
import { PULL_REASONS } from "@/lib/pullReasons";
import { normalizeScan, scanCandidates } from "@/lib/scanCodes";
import type { ScanHit } from "@/lib/scan";

// Scan parts OUT of inventory (the reverse of PO scan-receive). Two homes:
//   - Work order page (workOrderId set): a pick list of what the job needs vs
//     already pulled. Pull mode takes scanned parts off the shelf onto the job;
//     Return mode puts unused/wrong parts back. Parts not on the job's list can
//     still be pulled (flagged as extras).
//   - /inventory/pull (no work order): pull with a reason — shop use, damaged,
//     counter sale — which decides the GL account charged.
// Nothing moves until "Pull"/"Return" is pressed; then POST /api/inventory/pull
// does it in one transaction. Progress survives a refresh (localStorage).

export type ExpectedPart = {
  partId: string;
  sku: string;
  name: string;
  needed: number;
  issued: number;
  onHand: number;
  barcode: string | null;
  mfgPartNumber: string | null;
};

type Item = { partId: string; sku: string; name: string; qty: number; onHand: number };
type LogEntry = { at: number; text: string; tone: "ok" | "warn" | "bad" };
type Mode = "pull" | "return";
type Saved = { mode: Mode; items: Record<string, Item>; reason: string; note: string };

export function ScanPullPanel({
  workOrderId,
  expected = [],
}: {
  workOrderId?: string;
  expected?: ExpectedPart[];
}) {
  const router = useRouter();
  const forJob = !!workOrderId;
  const storageKey = `pull-scan:${workOrderId ?? "stock"}`;

  const [active, setActive] = useState(!forJob);
  const [mode, setMode] = useState<Mode>("pull");
  const [items, setItems] = useState<Record<string, Item>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [qtyPerScan, setQtyPerScan] = useState(1);
  const [text, setText] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; problems: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore / persist a count in progress.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      setMode(saved.mode ?? "pull");
      setItems(saved.items ?? {});
      setReason(saved.reason ?? "");
      setNote(saved.note ?? "");
      if (Object.keys(saved.items ?? {}).length) setActive(true);
    } catch {
      // storage unavailable — start fresh
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      if (Object.keys(items).length) {
        localStorage.setItem(storageKey, JSON.stringify({ mode, items, reason, note } satisfies Saved));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  }, [storageKey, mode, items, reason, note]);

  const expectedById = useMemo(() => new Map(expected.map((e) => [e.partId, e])), [expected]);
  const pushLog = (e: Omit<LogEntry, "at">) => setLog((prev) => [{ ...e, at: Date.now() }, ...prev].slice(0, 8));

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback(
    (p: { partId: string; sku: string; name: string; onHand: number }, qty: number) => {
      const next = (itemsRef.current[p.partId]?.qty ?? 0) + qty;
      setItems((prev) => ({
        ...prev,
        [p.partId]: { ...p, qty: (prev[p.partId]?.qty ?? 0) + qty },
      }));
      const exp = expectedById.get(p.partId);
      const warnings: string[] = [];
      if (mode === "pull") {
        if (forJob && (!exp || exp.needed === 0)) warnings.push("not on this job's parts list — pulling as an extra");
        else if (exp && exp.issued + next > exp.needed)
          warnings.push(`job only needs ${exp.needed} (${exp.issued} already pulled)`);
        if (next > p.onHand) warnings.push(`system shows only ${p.onHand} on hand — recount this part`);
      }
      if (warnings.length) {
        beep(false);
        pushLog({ tone: "warn", text: `${p.sku} ×${next}: ${warnings.join("; ")}` });
      } else {
        beep(true);
        const of = exp ? ` of ${mode === "pull" ? Math.max(0, exp.needed - exp.issued) : exp.issued}` : "";
        pushLog({ tone: "ok", text: `${p.sku}: ${next}${of}` });
      }
    },
    [expectedById, forJob, mode],
  );

  const onScan = useCallback(
    async (raw: string) => {
      const code = normalizeScan(raw);
      if (!code) return;
      setText("");
      setDone(null);
      const qty = Math.max(1, Math.trunc(qtyPerScan) || 1);
      const cands = scanCandidates(code).map((c) => c.toLowerCase());
      const is = (v: string | null | undefined) => !!v && cands.includes(v.toLowerCase());

      // The job's own parts first (no round trip), then a server lookup.
      let part: { partId: string; sku: string; name: string; onHand: number } | null = null;
      const exp = expected.find(
        (e) => is(e.barcode) || is(e.sku) || is(e.mfgPartNumber),
      );
      if (exp) {
        part = { partId: exp.partId, sku: exp.sku, name: exp.name, onHand: exp.onHand };
      } else {
        let hits: ScanHit[] = [];
        try {
          const res = await fetch(`/api/scan?code=${encodeURIComponent(code)}`);
          if (res.ok) hits = ((await res.json()) as { hits: ScanHit[] }).hits;
        } catch {
          // treat as unknown
        }
        const partHits = hits.filter((h) => h.type === "part" && h.part);
        if (partHits.length > 1) {
          pushLog({ tone: "warn", text: `${partHits.length} parts share code ${code} — used ${partHits[0].part!.sku}` });
        }
        const h = partHits[0];
        if (h?.part) part = { partId: h.id, sku: h.part.sku, name: h.part.name, onHand: h.part.quantityOnHand };
      }

      if (!part) {
        beep(false);
        setUnknown(code);
        pushLog({ tone: "bad", text: `Unknown barcode ${code} — link it to a part below` });
        return;
      }
      if (mode === "return") {
        const issued = expectedById.get(part.partId)?.issued ?? 0;
        const already = itemsRef.current[part.partId]?.qty ?? 0;
        if (already + qty > issued) {
          beep(false);
          pushLog({
            tone: "bad",
            text: `${part.sku}: only ${issued} were pulled for this job — can't return ${already + qty}`,
          });
          return;
        }
      }
      add(part, qty);
    },
    [qtyPerScan, expected, expectedById, mode, add],
  );

  // While active, hardware scans anywhere on the page come here.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  useEffect(() => {
    if (!active) return;
    setScanCapture((c) => void onScanRef.current(c));
    return () => setScanCapture(null);
  }, [active]);
  useEffect(() => {
    if (active && !cameraOn) inputRef.current?.focus();
  }, [active, cameraOn]);

  async function linkUnknown(p: { id: string }) {
    if (!unknown) return;
    const code = unknown;
    setErr(null);
    const res = await fetch(`/api/parts/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode: code }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save the barcode.");
      return;
    }
    setUnknown(null);
    // Re-run the scan: the server now resolves the code to that part, with its
    // real on-hand.
    void onScan(code);
  }

  function setQty(partId: string, n: number) {
    setItems((prev) => {
      const next = { ...prev };
      if (n > 0 && next[partId]) next[partId] = { ...next[partId], qty: n };
      else delete next[partId];
      return next;
    });
  }

  function switchMode(m: Mode) {
    if (m === mode) return;
    if (Object.keys(items).length && !window.confirm("Switching clears what you've scanned so far. Continue?")) return;
    setItems({});
    setLog([]);
    setMode(m);
  }

  const itemList = Object.values(items);
  const total = itemList.reduce((s, i) => s + i.qty, 0);

  async function submit() {
    setErr(null);
    if (!total) return;
    if (!forJob && !reason) {
      setErr("Pick a reason first.");
      return;
    }
    const verb = mode === "pull" ? "Take" : "Return";
    const where = forJob ? (mode === "pull" ? "out of stock onto this job" : "from this job back to stock") : "out of stock";
    if (!window.confirm(`${verb} ${total} item(s) ${where}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          workOrderId: workOrderId ?? null,
          reason: forJob ? null : reason,
          note,
          items: itemList.map((i) => ({ partId: i.partId, qty: i.qty })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: { moved: number; problem: string | null }[];
      };
      if (!res.ok || !data.results) {
        setErr(data.error ?? "Couldn't save. Nothing was changed — try again.");
        return;
      }
      const moved = data.results.reduce((s, r) => s + r.moved, 0);
      setDone({
        text: mode === "pull" ? `Pulled ${moved} item(s) out of inventory.` : `Returned ${moved} item(s) to stock.`,
        problems: data.results.map((r) => r.problem).filter((x): x is string => !!x),
      });
      setItems({});
      setLog([]);
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Pick-list rows: every part the job needs, plus anything scanned that isn't on it.
  const rows = forJob
    ? [
        ...expected.map((e) => ({ partId: e.partId, sku: e.sku, name: e.name, exp: e as ExpectedPart | undefined })),
        ...itemList
          .filter((i) => !expectedById.has(i.partId))
          .map((i) => ({ partId: i.partId, sku: i.sku, name: i.name, exp: undefined })),
      ]
    : itemList.map((i) => ({ partId: i.partId, sku: i.sku, name: i.name, exp: undefined }));

  const accent = mode === "pull" ? "sky" : "violet";

  if (!active) {
    const toPick = expected.reduce((s, e) => s + Math.max(0, e.needed - e.issued), 0);
    return (
      <div className="bg-surface border border-sky-500/30 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-body font-semibold text-sky-300 uppercase tracking-wider">Scan parts out</h3>
          <p className="text-[11px] text-zinc-400 font-body mt-0.5">
            {toPick > 0
              ? `${toPick} part(s) still to pick for this job. Scan them as you pull them off the shelf.`
              : "Scan parts as you pull them for this job, or return unused ones to stock."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActive(true)}
          className="text-xs font-body font-semibold bg-sky-500 hover:bg-sky-400 text-black rounded-md px-4 py-2"
        >
          Start scanning
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-surface border rounded-lg p-4 space-y-4 ${accent === "sky" ? "border-sky-500/30" : "border-violet-500/30"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className={`text-xs font-body font-semibold uppercase tracking-wider ${accent === "sky" ? "text-sky-300" : "text-violet-300"}`}
        >
          {forJob ? (mode === "pull" ? "Scan parts out to this job" : "Return parts to stock") : "Pull from stock"}
        </h3>
        <div className="flex flex-wrap gap-2 text-[11px] font-body">
          {forJob ? (
            <div className="inline-flex border border-white/10 rounded overflow-hidden">
              {(["pull", "return"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`px-2 py-1 ${mode === m ? "bg-white/15 text-white" : "text-zinc-400 hover:text-white"}`}
                >
                  {m === "pull" ? "Pull out" : "Return to stock"}
                </button>
              ))}
            </div>
          ) : null}
          {Object.keys(items).length ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear everything scanned so far?")) {
                  setItems({});
                  setLog([]);
                }
              }}
              className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-1"
            >
              Clear
            </button>
          ) : null}
          {forJob ? (
            <button
              type="button"
              onClick={() => {
                setActive(false);
                setCameraOn(false);
              }}
              className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-1"
            >
              Pause
            </button>
          ) : null}
        </div>
      </div>

      {!forJob ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Reason (required)</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="">— Why is this leaving stock? —</option>
              {PULL_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            {reason ? (
              <span className="block mt-1 text-[11px] text-zinc-500 font-body">
                {PULL_REASONS.find((r) => r.key === reason)?.hint}
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. cracked lens, customer name"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
          </label>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onScan(text);
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scan a part…"
          autoComplete="off"
          className="flex-1 min-w-[10rem] bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono focus:outline-none focus:border-sky-500/50"
        />
        <label className="flex items-center gap-1 text-[11px] text-zinc-400 font-body">
          Qty per scan
          <input
            type="number"
            min="1"
            value={qtyPerScan}
            onChange={(e) => setQtyPerScan(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
          />
        </label>
        <button type="submit" className="text-xs font-body font-semibold bg-sky-500 hover:bg-sky-400 text-black rounded-md px-3 py-2">
          Add
        </button>
        {!cameraOn ? (
          <button
            type="button"
            onClick={() => setCameraOn(true)}
            className="text-xs font-body text-zinc-300 hover:text-white border border-white/10 rounded-md px-3 py-2"
          >
            📷 Camera
          </button>
        ) : null}
      </form>

      {cameraOn ? <CameraScanner continuous onCode={(c) => void onScan(c)} onStop={() => setCameraOn(false)} /> : null}

      {log.length ? (
        <ul className="space-y-0.5 text-[11px] font-body">
          {log.map((e) => (
            <li
              key={e.at + e.text}
              className={e.tone === "ok" ? "text-green-400" : e.tone === "warn" ? "text-amber-400" : "text-red-400"}
            >
              {e.tone === "ok" ? "✓" : "⚠"} {e.text}
            </li>
          ))}
        </ul>
      ) : null}

      {unknown ? (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-2">
          <p className="text-xs text-white font-body">
            Unknown barcode <span className="font-mono">{unknown}</span>. Which part is it? (It&apos;ll be remembered.)
          </p>
          <PartSearchCombobox
            allowCreate={false}
            placeholder="Search part by SKU or name…"
            onPick={(p) => void linkUnknown(p)}
          />
          <button type="button" onClick={() => setUnknown(null)} className="text-[11px] text-zinc-500 hover:text-white font-body">
            Skip
          </button>
        </div>
      ) : null}

      {rows.length ? (
        <div className="border border-white/10 rounded-md divide-y divide-white/5">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            <span className="col-span-5">Part</span>
            <span className="col-span-1 text-right">{forJob ? "Needs" : "On hand"}</span>
            <span className="col-span-1 text-right">{forJob ? "Pulled" : ""}</span>
            <span className="col-span-2 text-center">{mode === "pull" ? "Scanning" : "Returning"}</span>
            <span className="col-span-3">Status</span>
          </div>
          {rows.map(({ partId, sku, name, exp }) => {
            const qty = items[partId]?.qty ?? 0;
            const onHand = items[partId]?.onHand ?? exp?.onHand ?? 0;
            let status: { text: string; tone: string };
            if (!forJob) status = qty > onHand ? { text: "More than on hand", tone: "text-amber-400" } : { text: "", tone: "" };
            else if (mode === "return")
              status = qty ? { text: `Back to stock ×${qty}`, tone: "text-violet-300" } : { text: "", tone: "" };
            else if (!exp || exp.needed === 0) status = { text: "Extra — not on job's list", tone: "text-amber-400" };
            else {
              const left = exp.needed - exp.issued - qty;
              status =
                left === 0
                  ? { text: "✓ All picked", tone: "text-green-400" }
                  : left > 0
                    ? { text: `${left} still to pick`, tone: qty || exp.issued ? "text-amber-400" : "text-zinc-400" }
                    : { text: `${-left} more than needed`, tone: "text-red-400" };
            }
            return (
              <div key={partId} className="grid grid-cols-12 gap-2 px-3 py-2 items-center text-xs font-body">
                <span className="col-span-12 sm:col-span-5 text-white truncate">
                  <span className="text-zinc-500">[{sku}]</span> {name}
                </span>
                <span className="col-span-3 sm:col-span-1 text-right text-zinc-300">
                  <span className="sm:hidden text-zinc-500">{forJob ? "Needs " : "On hand "}</span>
                  {forJob ? (exp?.needed ?? "—") : onHand}
                </span>
                <span className="col-span-3 sm:col-span-1 text-right text-zinc-300">
                  {forJob ? (
                    <>
                      <span className="sm:hidden text-zinc-500">Pulled </span>
                      {exp?.issued ?? 0}
                    </>
                  ) : null}
                </span>
                <span className="col-span-6 sm:col-span-2 flex items-center justify-center gap-1">
                  <button
                    type="button"
                    disabled={!qty}
                    onClick={() => setQty(partId, qty - 1)}
                    className="w-6 h-6 border border-white/10 rounded text-zinc-300 disabled:opacity-30"
                    aria-label="One less"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-white">{qty}</span>
                  <button
                    type="button"
                    disabled={!items[partId]}
                    onClick={() => setQty(partId, qty + 1)}
                    className="w-6 h-6 border border-white/10 rounded text-zinc-300 disabled:opacity-30"
                    aria-label="One more"
                  >
                    +
                  </button>
                </span>
                <span className={`col-span-12 sm:col-span-3 ${status.tone}`}>{status.text}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 font-body">Scan the first part to start the list.</p>
      )}

      {err ? <p className="text-xs text-red-400 font-body">{err}</p> : null}
      {done ? (
        <div className="border border-green-500/30 bg-green-500/5 rounded-md p-3 text-xs font-body space-y-1">
          <p className="text-green-300">✓ {done.text}</p>
          {done.problems.map((p) => (
            <p key={p} className="text-amber-400">
              ⚠ {p}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-400 font-body">{total} item(s) scanned</p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || total === 0}
          className={`text-xs font-body font-semibold text-black rounded-md px-4 py-2 disabled:opacity-40 ${mode === "pull" ? "bg-sky-500 hover:bg-sky-400" : "bg-violet-400 hover:bg-violet-300"}`}
        >
          {busy ? "Saving…" : mode === "pull" ? "Take out of inventory" : "Return to stock"}
        </button>
      </div>
    </div>
  );
}
