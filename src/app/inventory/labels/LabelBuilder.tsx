"use client";

import { useState } from "react";
import { PartSearchCombobox } from "@/components/PartSearchCombobox";
import { LABEL_FORMATS, formatLabelItems, type LabelFormat } from "@/lib/labels";

type Row = { partId: string; sku: string; name: string; hasBarcode: boolean; copies: number };

const inputCls = "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white";

export function LabelBuilder({
  initial,
  missingCount,
  categories,
}: {
  initial: Row[];
  missingCount: number;
  categories: string[];
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [format, setFormat] = useState<LabelFormat>("avery5160");
  const [skip, setSkip] = useState(0);
  const [category, setCategory] = useState("");
  const sheet = LABEL_FORMATS[format].sheet;
  const total = rows.reduce((s, r) => s + r.copies, 0);

  function add(p: { id: string; sku: string; name: string }) {
    setRows((prev) =>
      prev.some((r) => r.partId === p.id)
        ? prev.map((r) => (r.partId === p.id ? { ...r, copies: r.copies + 1 } : r))
        : [...prev, { partId: p.id, sku: p.sku, name: p.name, hasBarcode: false, copies: 1 }],
    );
  }

  const common = `format=${format}${sheet && skip ? `&skip=${skip}` : ""}`;
  const printHref = `/inventory/labels/print?${common}&items=${formatLabelItems(rows)}`;
  const missingHref = `/inventory/labels/print?${common}&missing=1${category ? `&category=${encodeURIComponent(category)}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Label stock</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as LabelFormat)} className={`mt-1 w-full ${inputCls}`}>
            {(Object.keys(LABEL_FORMATS) as LabelFormat[]).map((k) => (
              <option key={k} value={k}>
                {LABEL_FORMATS[k].label}
              </option>
            ))}
          </select>
          <span className="block mt-1 text-[11px] text-zinc-500 font-body">
            {sheet
              ? "Any office printer, on Avery 5160 (or equivalent) sticker sheets."
              : "For a thermal label printer — set its paper size to match in the print dialog."}
          </span>
        </label>
        {sheet ? (
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              Skip labels already used on the sheet
            </span>
            <input
              type="number"
              min={0}
              max={sheet.cols * sheet.rows - 1}
              value={skip}
              onChange={(e) => setSkip(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
              className={`mt-1 w-28 ${inputCls}`}
            />
            <span className="block mt-1 text-[11px] text-zinc-500 font-body">
              Printing starts after this many spots (left to right, top to bottom).
            </span>
          </label>
        ) : null}
      </div>

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Parts without a barcode</h3>
        <p className="text-[11px] text-zinc-400 font-body">
          {missingCount} active part(s) have no box barcode saved. Print one label for each to get the whole stockroom
          scannable.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <a
            href={missingHref}
            target="_blank"
            rel="noopener"
            className={`text-xs font-body font-semibold rounded-md px-4 py-2 ${missingCount ? "bg-white/10 hover:bg-white/20 text-white" : "pointer-events-none opacity-40 bg-white/10 text-white"}`}
          >
            Print labels for these
          </a>
        </div>
      </div>

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Pick parts</h3>
        <PartSearchCombobox allowCreate={false} placeholder="Search part by SKU or name to add…" onPick={add} />
        {rows.length ? (
          <div className="border border-white/10 rounded-md divide-y divide-white/5">
            {rows.map((r) => (
              <div key={r.partId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs font-body">
                <span className="flex-1 min-w-[12rem] text-white truncate">
                  <span className="text-zinc-500 font-mono">[{r.sku}]</span> {r.name}
                  {r.hasBarcode ? (
                    <span className="ml-2 text-[10px] text-zinc-500">(already has a box barcode — label still works)</span>
                  ) : null}
                </span>
                <label className="flex items-center gap-1 text-zinc-400">
                  Copies
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={r.copies}
                    onChange={(e) => {
                      const n = Math.min(500, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                      setRows((prev) => prev.map((x) => (x.partId === r.partId ? { ...x, copies: n } : x)));
                    }}
                    className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-right"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((x) => x.partId !== r.partId))}
                  className="text-zinc-500 hover:text-white"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500 font-body">No parts picked yet.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-400 font-body">
            {total} label(s)
            {sheet && total ? ` · ${Math.ceil((total + skip) / (sheet.cols * sheet.rows))} sheet(s)` : ""}
          </span>
          <a
            href={printHref}
            target="_blank"
            rel="noopener"
            className={`text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 ${rows.length ? "" : "pointer-events-none opacity-40"}`}
          >
            Open print view
          </a>
        </div>
      </div>
    </div>
  );
}
