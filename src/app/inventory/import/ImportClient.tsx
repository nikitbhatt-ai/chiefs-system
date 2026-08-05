"use client";

import { useState } from "react";

type Result = {
  rowNumber: number;
  sku: string;
  name: string;
  action: "create" | "update" | "skip";
  errors: string[];
  warnings: string[];
  manufacturerCreated?: boolean;
  supplierCreated?: boolean;
};

type ImportResponse = {
  commit: boolean;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  vendorsCreated: string[];
  results: Result[];
};

const SAMPLE = `sku,name,description,category,manufacturer,supplier,internal_cost,price,quantity_on_hand,reorder_point
WHELEN-MX-9R,Whelen MX-9R Lightbar,9-light LED bar 60",Lighting,Whelen,Sames Distributing,1247.50,1799.00,0,2
SC-SETINA-PB400,Setina PB400 Push Bumper,Police push bumper,Push Bumpers,Setina,Sames Distributing,489.00,799.00,0,3`;

export function ImportClient() {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [strict, setStrict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [committed, setCommitted] = useState<ImportResponse | null>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setCommitted(null);
    setError(null);
  }

  async function run(commit: boolean) {
    setBusy(true);
    setError(null);
    if (commit) setCommitted(null);
    else setPreview(null);
    try {
      const res = await fetch("/api/parts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, commit, strict }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Import failed");
        return;
      }
      if (commit) setCommitted(data);
      else setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const summary = committed ?? preview;
  const errorRows = summary?.results.filter((r) => r.errors.length > 0) ?? [];
  const warningRows = summary?.results.filter((r) => r.warnings.length > 0) ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <div className="text-xs font-body text-zinc-300">
          Only <code className="text-amber-400">sku</code> is required (also
          accepted as <code>part_number</code>, <code>manufacturer_sku</code>,{" "}
          <code>mfg_sku</code>, <code>part_no</code>, <code>item_number</code>) —
          it&apos;s how each part is identified. Everything else is optional and
          filled in when present:{" "}
          <code>name</code> (falls back to <code>part_description</code> then the
          SKU), <code>description</code>, <code>category</code>/<code>section</code>,{" "}
          <code>manufacturer</code>, <code>supplier</code>,{" "}
          <code>internal_cost</code>/<code>unit_cost</code>,{" "}
          <code>price</code>/<code>sell_price</code>,{" "}
          <code>quantity_on_hand</code>, <code>quantity_on_order</code>,{" "}
          <code>reorder_point</code>. Rows missing a value import with a sensible
          default and a note; only a row with no SKU is skipped. Existing SKUs
          are updated, new ones created, and unknown vendor names auto-created.
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-xs font-body text-zinc-300 cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-4 py-2">
            Choose CSV / Excel file
            <input
              type="file"
              accept=".csv,.tsv,text/csv,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setCsv(SAMPLE)}
            className="text-[11px] text-amber-400 hover:text-amber-300 font-body"
          >
            Load sample rows
          </button>
        </div>

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          placeholder="Or paste CSV content here…"
          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500"
        />

        <div className="flex flex-wrap justify-between items-center gap-2">
          <label className="text-[11px] font-body text-zinc-400 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) => {
                setStrict(e.target.checked);
                setPreview(null);
                setCommitted(null);
              }}
              className="accent-amber-500"
            />
            Strict mode — skip any row with a warning (for a clean catalog load)
          </label>
          <div className="flex gap-2">
          <button
            type="button"
            disabled={!csv.trim() || busy}
            onClick={() => run(false)}
            className="text-xs font-body bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white border border-white/10 rounded-md px-4 py-2"
          >
            {busy && !committed ? "Previewing…" : "Preview (dry-run)"}
          </button>
          <button
            type="button"
            disabled={!csv.trim() || busy || !preview || preview.skipped === preview.totalRows}
            onClick={() => run(true)}
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-4 py-2"
          >
            {busy && committed === null && preview ? "Importing…" : "Confirm import"}
          </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-body rounded-lg p-3">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3 text-xs font-body">
            <span
              className={`text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${
                summary.commit
                  ? "bg-green-500/10 text-green-300 border-green-500/30"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/30"
              }`}
            >
              {summary.commit ? "Committed" : "Preview"}
            </span>
            <span className="text-zinc-300">
              <strong className="text-white">{summary.totalRows}</strong> rows
            </span>
            <span className="text-green-400">
              {summary.commit ? "Created" : "Will create"}:{" "}
              <strong>{summary.created}</strong>
            </span>
            <span className="text-blue-400">
              {summary.commit ? "Updated" : "Will update"}:{" "}
              <strong>{summary.updated}</strong>
            </span>
            <span className="text-red-400">
              Skipped: <strong>{summary.skipped}</strong>
            </span>
            {warningRows.length > 0 ? (
              <span className="text-amber-400">
                {summary.commit ? "Imported with fixes" : "Warnings"}:{" "}
                <strong>{warningRows.length}</strong>
              </span>
            ) : null}
          </div>

          {summary.vendorsCreated.length > 0 ? (
            <div className="text-[11px] text-zinc-400 font-body">
              Vendors {summary.commit ? "created" : "will be auto-created"}:{" "}
              <span className="text-white">
                {summary.vendorsCreated.join(", ")}
              </span>
            </div>
          ) : null}

          {errorRows.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-red-400 font-body mb-1">
                Errors ({errorRows.length})
              </div>
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-1">Row</th>
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Issues</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {errorRows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-white/5">
                      <td className="px-2 py-1 text-zinc-500">{r.rowNumber}</td>
                      <td className="px-2 py-1 font-mono">{r.sku || "—"}</td>
                      <td className="px-2 py-1 text-red-300">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {warningRows.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-400 font-body mb-1">
                {summary.commit ? "Imported with fixes" : "Warnings"} ({warningRows.length})
                <span className="normal-case tracking-normal text-zinc-500">
                  {" "}— {summary.commit ? "these rows imported; a value was defaulted or coerced" : "these rows will import; a value is defaulted or coerced"}
                </span>
              </div>
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-1">Row</th>
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Notes</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {warningRows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-white/5">
                      <td className="px-2 py-1 text-zinc-500">{r.rowNumber}</td>
                      <td className="px-2 py-1 font-mono">{r.sku || "—"}</td>
                      <td className="px-2 py-1 text-amber-300">{r.warnings.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <details className="text-xs font-body">
            <summary className="cursor-pointer text-zinc-400 hover:text-white">
              Show all {summary.results.length} rows
            </summary>
            <table className="w-full mt-2">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-2 py-1">Row</th>
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Action</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {summary.results.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-white/5">
                    <td className="px-2 py-1 text-zinc-500">{r.rowNumber}</td>
                    <td className="px-2 py-1 font-mono">{r.sku}</td>
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${
                          r.action === "create"
                            ? "bg-green-500/10 text-green-300 border-green-500/30"
                            : r.action === "update"
                              ? "bg-blue-500/10 text-blue-300 border-blue-500/30"
                              : "bg-red-500/10 text-red-300 border-red-500/30"
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}
    </div>
  );
}
