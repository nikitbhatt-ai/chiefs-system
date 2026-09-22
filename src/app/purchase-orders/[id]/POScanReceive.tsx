"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraScanner } from "@/components/CameraScanner";
import { beep, setScanCapture } from "@/components/scanCapture";
import { normalizeScan, scanCandidates } from "@/lib/scanCodes";
import type { ScanHit } from "@/lib/scan";

// Scan-to-receive against a PO. The warehouse scans each item that came in;
// each scan is matched to a PO line (by the part's barcode, SKU, or mfg #) and
// counted. The panel shows ordered vs already-in vs scanned-now per line and
// flags every discrepancy — short, over, not on this PO, unknown barcode —
// before anything is received. "Receive" posts the counts through the same
// receivePO action as the manual form (capped at what's still open), so stock,
// costing layers, the ledger and PO status all follow the existing path; the
// discrepancy summary is appended to the PO notes as the audit trail.
// Progress is kept in this browser (localStorage) so a refresh mid-count
// doesn't lose it.

export type ScanLine = {
  index: number;
  lineKey: string;
  partId: string | null;
  sku: string | null;
  description: string;
  ordered: number;
  alreadyReceived: number;
};

export type PartCodes = Record<string, { sku: string; barcode: string | null; mfgPartNumber: string | null }>;

type Extra = { code: string; qty: number; kind: "not_on_po" | "unknown"; label: string };
type LogEntry = { at: number; code: string; text: string; tone: "ok" | "warn" | "bad" };

type Saved = { sig: string; counts: Record<number, number>; extras: Extra[] };

// Units still expected on a line.
const open = (l: ScanLine) => Math.max(0, l.ordered - l.alreadyReceived);

export function POScanReceive({
  poId,
  lines,
  initialPartCodes,
  receivePO,
}: {
  poId: string;
  lines: ScanLine[];
  initialPartCodes: PartCodes;
  receivePO: (formData: FormData) => Promise<void>;
}) {
  const storageKey = `po-scan:${poId}`;
  // Saved progress only applies to the same set of lines it was counted on.
  const sig = lines.map((l) => `${l.lineKey}:${l.alreadyReceived}`).join(",");

  const [active, setActive] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [partCodes, setPartCodes] = useState<PartCodes>(initialPartCodes);
  const [qtyPerScan, setQtyPerScan] = useState(1);
  const [text, setText] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore a count in progress.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      if (saved.sig !== sig) {
        localStorage.removeItem(storageKey);
        return;
      }
      setCounts(saved.counts ?? {});
      setExtras(saved.extras ?? []);
      if (Object.keys(saved.counts ?? {}).length || saved.extras?.length) setActive(true);
    } catch {
      // storage unavailable — start fresh
    }
  }, [storageKey, sig]);

  useEffect(() => {
    try {
      if (Object.keys(counts).length || extras.length) {
        localStorage.setItem(storageKey, JSON.stringify({ sig, counts, extras } satisfies Saved));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  }, [storageKey, sig, counts, extras]);

  const receivable = lines.filter((l) => l.partId);

  const pushLog = (e: Omit<LogEntry, "at">) => setLog((prev) => [{ ...e, at: Date.now() }, ...prev].slice(0, 8));

  // PO lines whose part carries this code. Several lines can share a part
  // (e.g. a package line and an individual line); prefer one still open.
  const matchLines = useCallback(
    (code: string): ScanLine[] => {
      const cands = scanCandidates(code).map((c) => c.toLowerCase());
      const is = (v: string | null | undefined) => !!v && cands.includes(v.toLowerCase());
      return receivable.filter((l) => {
        const pc = l.partId ? partCodes[l.partId] : undefined;
        return is(l.sku) || is(pc?.sku) || is(pc?.barcode) || is(pc?.mfgPartNumber);
      });
    },
    [receivable, partCodes],
  );

  const countsRef = useRef(counts);
  countsRef.current = counts;

  const addToLine = useCallback(
    (l: ScanLine, qty: number, code: string) => {
      const next = (countsRef.current[l.index] ?? 0) + qty;
      setCounts((prev) => ({ ...prev, [l.index]: (prev[l.index] ?? 0) + qty }));
      const o = open(l);
      if (next > o) {
        beep(false);
        pushLog({ code, tone: "bad", text: `${l.sku ?? l.description}: OVER — ${next} scanned, only ${o} open on this PO` });
      } else {
        beep(true);
        pushLog({ code, tone: "ok", text: `${l.sku ?? l.description}: ${next} of ${o}` });
      }
    },
    [],
  );

  const onScan = useCallback(
    async (raw: string) => {
      const code = normalizeScan(raw);
      if (!code) return;
      setText("");
      const qty = Math.max(1, Math.trunc(qtyPerScan) || 1);
      const matched = matchLines(code);
      if (matched.length) {
        const l =
          matched.find((m) => (countsRef.current[m.index] ?? 0) < open(m)) ?? matched[0];
        addToLine(l, qty, code);
        return;
      }
      // Not a PO line — is it a part we know at all?
      let hits: ScanHit[] = [];
      try {
        const res = await fetch(`/api/scan?code=${encodeURIComponent(code)}`);
        if (res.ok) hits = ((await res.json()) as { hits: ScanHit[] }).hits;
      } catch {
        // treat as unknown
      }
      const onPo = hits.find((h) => h.type === "part" && receivable.some((l) => l.partId === h.id));
      if (onPo) {
        const l = receivable.find((x) => x.partId === onPo.id)!;
        addToLine(l, qty, code);
        return;
      }
      const part = hits.find((h) => h.type === "part");
      beep(false);
      const kind: Extra["kind"] = part ? "not_on_po" : "unknown";
      const label = part ? part.title : code;
      setExtras((prev) => {
        const i = prev.findIndex((e) => e.code === code);
        if (i < 0) return [...prev, { code, qty, kind, label }];
        return prev.map((e, j) => (j === i ? { ...e, qty: e.qty + qty } : e));
      });
      pushLog({
        code,
        tone: "warn",
        text: part ? `NOT ON THIS PO: ${part.title} — set it aside` : `Unknown barcode ${code} — link it to a line below`,
      });
    },
    [qtyPerScan, matchLines, addToLine, receivable],
  );

  // While counting, hardware scans anywhere on the page come here instead of
  // the header's lookup dialog.
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

  function setLineCount(l: ScanLine, n: number) {
    setCounts((prev) => {
      const next = { ...prev };
      if (n > 0) next[l.index] = n;
      else delete next[l.index];
      return next;
    });
  }

  // Unknown barcode → "this is that PO line's part": save the barcode on the
  // part so it's recognized from now on, and count what was scanned.
  async function linkExtra(e: Extra, lineIndex: number) {
    const l = lines.find((x) => x.index === lineIndex);
    if (!l?.partId) return;
    setLinkErr(null);
    const res = await fetch(`/api/parts/${l.partId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode: e.code }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setLinkErr(data.error ?? "Couldn't save the barcode.");
      return;
    }
    const partId = l.partId;
    setPartCodes((prev) => ({ ...prev, [partId]: { ...prev[partId], barcode: e.code } }));
    setExtras((prev) => prev.filter((x) => x.code !== e.code));
    addToLine(l, e.qty, e.code);
  }

  const rows = useMemo(
    () =>
      lines.map((l) => {
        const o = open(l);
        const scanned = counts[l.index] ?? 0;
        let status: { text: string; tone: string };
        if (!l.partId) status = { text: "Not linked to a part — receive by hand", tone: "text-zinc-500" };
        else if (o === 0) status = { text: "Already complete", tone: "text-zinc-500" };
        else if (scanned === 0) status = { text: `Nothing scanned — ${o} open`, tone: "text-amber-400" };
        else if (scanned < o) status = { text: `Short ${o - scanned}`, tone: "text-amber-400" };
        else if (scanned > o) status = { text: `Over ${scanned - o}`, tone: "text-red-400" };
        else status = { text: "✓ Matches PO", tone: "text-green-400" };
        return { l, o, scanned, status };
      }),
    [lines, counts],
  );

  const toReceive = rows.reduce((s, r) => s + Math.min(r.scanned, r.o), 0);
  const shortRows = rows.filter((r) => r.l.partId && r.o > 0 && r.scanned < r.o);
  const overRows = rows.filter((r) => r.scanned > r.o);

  function buildNote() {
    const name = (r: (typeof rows)[number]) => r.l.sku || r.l.description;
    const parts: string[] = [];
    const got = rows.filter((r) => r.scanned > 0).map((r) => `${name(r)} ×${Math.min(r.scanned, r.o)}`);
    if (got.length) parts.push(`Received: ${got.join(", ")}`);
    if (shortRows.length) parts.push(`Short: ${shortRows.map((r) => `${name(r)} ${r.o - r.scanned} of ${r.o}`).join(", ")}`);
    if (overRows.length) parts.push(`Over (not received): ${overRows.map((r) => `${name(r)} +${r.scanned - r.o}`).join(", ")}`);
    const notOn = extras.map((e) => `${e.label} ×${e.qty}${e.kind === "unknown" ? " (unknown barcode)" : ""}`);
    if (notOn.length) parts.push(`Not on PO: ${notOn.join(", ")}`);
    return parts.join(". ");
  }

  function reset() {
    setCounts({});
    setExtras([]);
    setLog([]);
    setLinkErr(null);
  }

  async function submit() {
    if (toReceive === 0) return;
    const issues: string[] = [];
    if (shortRows.length) issues.push(`${shortRows.length} line(s) short — the PO stays open for the rest`);
    if (overRows.length) issues.push(`${overRows.length} line(s) over — extras will NOT be received`);
    if (extras.length) issues.push(`${extras.length} scanned item(s) not on this PO`);
    const msg = `Receive ${toReceive} item(s) into inventory?` + (issues.length ? `\n\n• ${issues.join("\n• ")}` : "");
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", poId);
    for (const r of rows) {
      const n = Math.min(r.scanned, r.o);
      if (n > 0 && r.l.partId) fd.set(`receive_${r.l.index}`, String(n));
    }
    fd.set("receiveNote", buildNote());
    setBusy(true);
    try {
      await receivePO(fd);
      reset();
      setActive(false);
      setCameraOn(false);
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <div className="bg-surface border border-green-500/30 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-body font-semibold text-green-300 uppercase tracking-wider">Scan to receive</h3>
          <p className="text-[11px] text-zinc-400 font-body mt-0.5">
            Shipment arrived? Scan each item as you unbox it — it&apos;s checked against this PO before anything is received.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActive(true)}
          disabled={receivable.length === 0}
          className="text-xs font-body font-semibold bg-green-500 hover:bg-green-400 text-black rounded-md px-4 py-2 disabled:opacity-40"
        >
          Start scanning
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-green-500/30 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-body font-semibold text-green-300 uppercase tracking-wider">Scan to receive</h3>
        <div className="flex gap-2 text-[11px] font-body">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear everything scanned so far?")) reset();
            }}
            className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-1"
          >
            Clear count
          </button>
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
        </div>
      </div>

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
          placeholder="Scan an item…"
          autoComplete="off"
          className="flex-1 min-w-[12rem] bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono focus:outline-none focus:border-green-500/50"
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
        <button type="submit" className="text-xs font-body font-semibold bg-green-500 hover:bg-green-400 text-black rounded-md px-3 py-2">
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
      {qtyPerScan > 1 ? (
        <p className="text-[11px] text-amber-400 font-body -mt-2">
          Each scan counts as {qtyPerScan}. Set back to 1 when you&apos;re done with the case/box.
        </p>
      ) : null}

      {cameraOn ? <CameraScanner continuous onCode={(c) => void onScan(c)} onStop={() => setCameraOn(false)} /> : null}

      {log.length ? (
        <ul className="space-y-0.5 text-[11px] font-body">
          {log.map((e) => (
            <li
              key={e.at + e.code}
              className={e.tone === "ok" ? "text-green-400" : e.tone === "warn" ? "text-amber-400" : "text-red-400"}
            >
              {e.tone === "ok" ? "✓" : "⚠"} {e.text}
            </li>
          ))}
        </ul>
      ) : null}

      {/* PO vs what came in */}
      <div className="border border-white/10 rounded-md divide-y divide-white/5">
        <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          <span className="col-span-5">Line</span>
          <span className="col-span-1 text-right">Ordered</span>
          <span className="col-span-1 text-right">Already in</span>
          <span className="col-span-2 text-center">Scanned now</span>
          <span className="col-span-3">Status</span>
        </div>
        {rows.map(({ l, o, scanned, status }) => (
          <div key={l.lineKey} className="grid grid-cols-12 gap-2 px-3 py-2 items-center text-xs font-body">
            <span className="col-span-12 sm:col-span-5 text-white truncate">
              <span className="text-zinc-500">[{l.sku || "no part #"}]</span> {l.description}
            </span>
            <span className="col-span-3 sm:col-span-1 text-right text-zinc-300">
              <span className="sm:hidden text-zinc-500">Ord </span>
              {l.ordered}
            </span>
            <span className="col-span-3 sm:col-span-1 text-right text-zinc-300">
              <span className="sm:hidden text-zinc-500">In </span>
              {l.alreadyReceived}
            </span>
            <span className="col-span-6 sm:col-span-2 flex items-center justify-center gap-1">
              <button
                type="button"
                disabled={!l.partId || scanned === 0}
                onClick={() => setLineCount(l, scanned - 1)}
                className="w-6 h-6 border border-white/10 rounded text-zinc-300 disabled:opacity-30"
                aria-label="One less"
              >
                −
              </button>
              <input
                type="number"
                min="0"
                value={scanned}
                disabled={!l.partId || o === 0}
                onChange={(e) => setLineCount(l, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                className="w-14 bg-black/40 border border-white/10 rounded px-1 py-1 text-white text-center disabled:opacity-40"
              />
              <button
                type="button"
                disabled={!l.partId || o === 0}
                onClick={() => setLineCount(l, scanned + 1)}
                className="w-6 h-6 border border-white/10 rounded text-zinc-300 disabled:opacity-30"
                aria-label="One more"
              >
                +
              </button>
            </span>
            <span className={`col-span-12 sm:col-span-3 ${status.tone}`}>{status.text}</span>
          </div>
        ))}
      </div>

      {extras.length ? (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-2">
          <p className="text-xs text-amber-300 font-body font-semibold">Scanned but not on this PO</p>
          {extras.map((e) => (
            <div key={e.code} className="flex flex-wrap items-center gap-2 text-xs font-body">
              <span className="text-white">
                {e.label} <span className="text-zinc-500">×{e.qty}</span>
              </span>
              {e.kind === "unknown" ? (
                <select
                  defaultValue=""
                  onChange={(ev) => {
                    if (ev.target.value !== "") void linkExtra(e, Number(ev.target.value));
                  }}
                  className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-xs"
                >
                  <option value="">Unknown barcode — it&apos;s actually…</option>
                  {receivable.map((l) => (
                    <option key={l.lineKey} value={l.index}>
                      {l.sku ?? ""} {l.description}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-zinc-500">A different part — set it aside / contact vendor</span>
              )}
              <button
                type="button"
                onClick={() => setExtras((prev) => prev.filter((x) => x.code !== e.code))}
                className="text-zinc-500 hover:text-white"
              >
                Remove
              </button>
            </div>
          ))}
          {linkErr ? <p className="text-[11px] text-red-400 font-body">{linkErr}</p> : null}
          <p className="text-[11px] text-zinc-500 font-body">
            Linking an unknown barcode saves it on that part, so it scans correctly from now on.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-400 font-body">
          {toReceive} item(s) ready to receive
          {shortRows.length ? ` · ${shortRows.length} short` : ""}
          {overRows.length ? ` · ${overRows.length} over` : ""}
          {extras.length ? ` · ${extras.length} not on PO` : ""}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || toReceive === 0}
          className="text-xs font-body font-semibold bg-green-500 hover:bg-green-400 text-black rounded-md px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Receiving…" : "Receive scanned items"}
        </button>
      </div>
    </div>
  );
}
