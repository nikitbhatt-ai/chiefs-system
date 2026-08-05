"use client";

import { useState } from "react";

type TemplateResult = {
  name: string;
  packageAction: "create" | "update" | "skip";
  itemCount: number;
  laborCount: number;
  feeCount: number;
  newPartCount: number;
  alacarteCount: number;
  promo: null | { packagePrice: number; alacarteTotal: number; saving: number; lineCount: number };
  errors: string[];
  warnings: string[];
};

type ImportResponse = {
  commit: boolean;
  totalTemplates: number;
  created: number;
  updated: number;
  skipped: number;
  promosCreated: number;
  results: TemplateResult[];
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function ImportTemplateClient({
  vendors,
  defaultVendorId,
}: {
  vendors: { id: string; name: string }[];
  defaultVendorId: string;
}) {
  const [csv, setCsv] = useState("");
  const [vendorId, setVendorId] = useState(defaultVendorId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [committed, setCommitted] = useState<ImportResponse | null>(null);

  async function handleFile(file: File) {
    setCsv(await file.text());
    setPreview(null);
    setCommitted(null);
    setError(null);
  }

  async function run(commit: boolean) {
    setBusy(true);
    setError(null);
    if (commit) setCommitted(null);
    else {
      setPreview(null);
      setCommitted(null);
    }
    try {
      const res = await fetch("/api/package-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, vendorId, commit }),
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

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <div className="text-xs font-body text-zinc-300 leading-relaxed">
          Upload one vendor template sheet. Every part line — across every section — becomes a line in one sellable
          package. Each part&apos;s <code className="text-amber-400">Unit Cost</code> loads the à la carte price list for
          the vendor below. A header row that carries a price but{" "}
          <span className="text-white">no part number</span> (e.g. the{" "}
          <code className="text-amber-400">Lightbar Regional Promo · $7,200</code> row) is the{" "}
          <span className="text-white">package promo cost for all the parts</span> — it&apos;s spread across them by the
          allocation engine. A sheet with no such priced row imports à la carte only (no promo). The{" "}
          <code>Notes</code> column is ignored. Missing SKUs are created.
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            Vendor (parts bought from)
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="block mt-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="">— Vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-body text-zinc-300 cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-4 py-2 self-end">
            Choose CSV file
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
        </div>

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          placeholder="Or paste the template CSV here…"
          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={!csv.trim() || !vendorId || busy}
            onClick={() => run(false)}
            className="text-xs font-body bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white border border-white/10 rounded-md px-4 py-2"
          >
            {busy && !committed ? "Previewing…" : "Preview (dry-run)"}
          </button>
          <button
            type="button"
            disabled={!csv.trim() || !vendorId || busy || !preview || preview.skipped === preview.totalTemplates}
            onClick={() => run(true)}
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-4 py-2"
          >
            {busy && committed === null && preview ? "Importing…" : "Confirm import"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-body rounded-lg p-3">{error}</div>
      ) : null}

      {summary ? (
        <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
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
            <span className="text-zinc-300"><strong className="text-white">{summary.totalTemplates}</strong> templates</span>
            <span className="text-green-400">{summary.commit ? "Created" : "Will create"}: <strong>{summary.created}</strong></span>
            <span className="text-blue-400">{summary.commit ? "Updated" : "Will update"}: <strong>{summary.updated}</strong></span>
            <span className="text-red-400">Skipped: <strong>{summary.skipped}</strong></span>
            <span className="text-amber-400">Promos: <strong>{summary.promosCreated}</strong></span>
            {summary.commit ? (
              <a href="/vendor-promos" className="ml-auto text-amber-400 hover:text-amber-300">View promos →</a>
            ) : null}
          </div>

          <table className="w-full text-xs font-body">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-2 py-1">Template</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1 text-right">Items</th>
                <th className="px-2 py-1 text-right">New parts</th>
                <th className="px-2 py-1 text-right">À la carte set</th>
                <th className="px-2 py-1 text-right">Promo saving</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {summary.results.map((r, i) => (
                <tr key={i} className="border-t border-white/5 align-top">
                  <td className="px-2 py-1">
                    {r.name}
                    {r.errors.length ? <div className="text-red-300 mt-0.5">{r.errors.join("; ")}</div> : null}
                    {r.warnings.length ? <div className="text-amber-300 mt-0.5">{r.warnings.join("; ")}</div> : null}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${
                        r.packageAction === "create"
                          ? "bg-green-500/10 text-green-300 border-green-500/30"
                          : r.packageAction === "update"
                            ? "bg-blue-500/10 text-blue-300 border-blue-500/30"
                            : "bg-red-500/10 text-red-300 border-red-500/30"
                      }`}
                    >
                      {r.packageAction}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right">{r.itemCount}</td>
                  <td className="px-2 py-1 text-right">{r.newPartCount}</td>
                  <td className="px-2 py-1 text-right">{r.alacarteCount}</td>
                  <td className="px-2 py-1 text-right">
                    {r.promo ? (
                      <span className="text-emerald-300" title={`Package ${money(r.promo.packagePrice)} vs à la carte ${money(r.promo.alacarteTotal)} across ${r.promo.lineCount} lines`}>
                        {money(r.promo.saving)}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
