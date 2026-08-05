"use client";

import { useState } from "react";

type Result = {
  name: string;
  action: "create" | "update" | "skip";
  componentCount: number;
  errors: string[];
  warnings: string[];
};

type ImportResponse = {
  commit: boolean;
  totalPackages: number;
  created: number;
  updated: number;
  skipped: number;
  results: Result[];
};

const SAMPLE = `package_name,package_category,package_description,component_type,sku,label,quantity,unit_price,hours,rate,amount
Standard Patrol Upfit,Patrol,Base patrol build,part,WHELEN-MX-9R,,1,,,,
Standard Patrol Upfit,,,part,SC-SETINA-PB400,,1,,,,
Standard Patrol Upfit,,,labor,,Install lightbar + push bumper,,,6,95,
Standard Patrol Upfit,,,fee,,Shop supplies,,,,,50
K9 Unit Add-On,Patrol,Heat alarm + insert,part,WHELEN-MX-9R,,1,1650,,,`;

export function ImportClient() {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
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
      const res = await fetch("/api/packages/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, commit }),
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
  const warningRows = summary?.results.filter((r) => r.errors.length === 0 && r.warnings.length > 0) ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <div className="text-xs font-body text-zinc-300">
          One row per component, grouped by package name. Only a{" "}
          <code className="text-amber-400">package_name</code> column is required
          (also accepted as <code>template_name</code>, <code>package</code>, or{" "}
          <code>name</code>); a blank name cell inherits the row above, the way
          section templates repeat a title once. Everything else is optional:{" "}
          <code>component_type</code> (<code>part</code>/<code>labor</code>/
          <code>fee</code>) — if absent it&apos;s inferred, defaulting to a part;{" "}
          <code>sku</code>/<code>part_number</code>,{" "}
          <code>label</code>/<code>part_description</code>, <code>quantity</code>/
          <code>qty</code>, <code>unit_price</code>/<code>sell_price</code>,{" "}
          <code>hours</code>, <code>rate</code>, <code>amount</code>,{" "}
          <code>package_category</code>, <code>package_description</code>. A part
          SKU that isn&apos;t in inventory yet still imports (linked by SKU, with
          its price snapshotted). A bad row is dropped and reported; the rest of
          its package still imports. Existing packages (by name) are replaced.
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

        <div className="flex justify-end gap-2">
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
            disabled={!csv.trim() || busy || !preview || preview.skipped === preview.totalPackages}
            onClick={() => run(true)}
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-4 py-2"
          >
            {busy && committed === null && preview ? "Importing…" : "Confirm import"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-body rounded-lg p-3">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3 text-xs font-body flex-wrap">
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
              <strong className="text-white">{summary.totalPackages}</strong> packages
            </span>
            <span className="text-green-400">
              {summary.commit ? "Created" : "Will create"}: <strong>{summary.created}</strong>
            </span>
            <span className="text-blue-400">
              {summary.commit ? "Updated" : "Will update"}: <strong>{summary.updated}</strong>
            </span>
            <span className="text-red-400">
              Skipped: <strong>{summary.skipped}</strong>
            </span>
            {warningRows.length > 0 ? (
              <span className="text-amber-400">
                {summary.commit ? "Imported with fixes" : "With warnings"}:{" "}
                <strong>{warningRows.length}</strong>
              </span>
            ) : null}
            {summary.commit ? (
              <a href="/packages" className="ml-auto text-amber-400 hover:text-amber-300">
                View packages →
              </a>
            ) : null}
          </div>

          {errorRows.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-red-400 font-body mb-1">
                Skipped ({errorRows.length})
              </div>
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-1">Package</th>
                    <th className="px-2 py-1">Issues</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {errorRows.map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1">{r.name}</td>
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
                {summary.commit ? "Imported with fixes" : "With warnings"} ({warningRows.length})
                <span className="normal-case tracking-normal text-zinc-500">
                  {" "}— {summary.commit ? "these imported" : "these will import"}; a value was defaulted, coerced, or a row dropped
                </span>
              </div>
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-1">Package</th>
                    <th className="px-2 py-1">Notes</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {warningRows.map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1 text-amber-300">{r.warnings.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <details className="text-xs font-body">
            <summary className="cursor-pointer text-zinc-400 hover:text-white">
              Show all {summary.results.length} packages
            </summary>
            <table className="w-full mt-2">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-2 py-1">Package</th>
                  <th className="px-2 py-1 text-right">Components</th>
                  <th className="px-2 py-1">Action</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {summary.results.map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1 text-right">{r.componentCount}</td>
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
