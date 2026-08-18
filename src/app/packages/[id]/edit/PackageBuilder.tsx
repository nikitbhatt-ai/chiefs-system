"use client";

import { useMemo, useState } from "react";
import { PartSearchCombobox, type PartHit } from "@/components/PartSearchCombobox";

// Mirrors PackageComponent in src/db/schema.ts.
export type BuilderComponent =
  | { kind: "item"; description: string; quantity: number; unitPrice: number; cost?: number | null; partId?: string | null; sku?: string | null }
  | { kind: "labor"; description: string; hours: number; rate: number }
  | { kind: "fee"; description: string; amount: number; fixed: boolean };

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function PackageBuilder({
  id,
  name,
  category,
  description,
  packagePrice,
  markupPct,
  pricingMode,
  initialComponents,
  action,
}: {
  id: string;
  name: string;
  category: string;
  description: string;
  packagePrice: string;
  markupPct: string;
  pricingMode: string;
  initialComponents: BuilderComponent[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [components, setComponents] = useState<BuilderComponent[]>(initialComponents);
  const [bundlePrice, setBundlePrice] = useState<string>(packagePrice ?? "");
  const [markup, setMarkup] = useState<string>(markupPct ?? "");
  // "markup" = % on cost (sell = cost × (1+p)); "margin" = % off list / of sell
  // (sell = cost ÷ (1−p)) — how "40% off list" pricing works.
  const [mode, setMode] = useState<"markup" | "margin">(pricingMode === "margin" ? "margin" : "markup");

  const value = useMemo(() => {
    let parts = 0; // sell value of parts
    let cost = 0; // internal cost of parts (lines that have a cost)
    let labor = 0;
    let fees = 0;
    for (const c of components) {
      if (c.kind === "item") {
        parts += (c.quantity || 0) * (c.unitPrice || 0);
        if (c.cost != null) cost += (c.quantity || 0) * (c.cost || 0);
      } else if (c.kind === "labor") labor += (c.hours || 0) * (c.rate || 0);
      else fees += c.amount || 0;
    }
    const margin = parts - cost;
    const marginPct = parts > 0 ? (margin / parts) * 100 : null;
    return { parts, cost, labor, fees, total: parts + labor + fees, margin, marginPct };
  }, [components]);

  // Apply pricing to every part line from its cost. Markup mode:
  // sell = cost × (1 + p). Margin mode ("% off list"): sell = cost ÷ (1 − p),
  // e.g. cost $60 at 40% margin → $100. Lines without a cost are left alone.
  function applyMarkup() {
    const m = Number(markup);
    if (!Number.isFinite(m) || m < 0) return;
    if (mode === "margin" && m >= 100) return; // 100% margin is undefined
    const factor = mode === "margin" ? 1 / (1 - m / 100) : 1 + m / 100;
    setComponents((prev) =>
      prev.map((c) =>
        c.kind === "item" && c.cost != null
          ? { ...c, unitPrice: Math.round((c.cost || 0) * factor * 100) / 100 }
          : c,
      ),
    );
  }

  function update(i: number, patch: Partial<BuilderComponent>) {
    setComponents((prev) => prev.map((c, idx) => (idx === i ? ({ ...c, ...patch } as BuilderComponent) : c)));
  }
  function remove(i: number) {
    setComponents((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addPart(part: PartHit) {
    setComponents((prev) => {
      // Same part already in the bundle → bump its qty instead of duplicating.
      const existing = prev.findIndex((c) => c.kind === "item" && c.partId === part.id);
      if (existing >= 0) {
        return prev.map((c, i) =>
          i === existing && c.kind === "item" ? { ...c, quantity: (c.quantity || 0) + 1 } : c,
        );
      }
      return [
        ...prev,
        {
          kind: "item",
          description: `${part.sku} — ${part.name}`,
          quantity: 1,
          unitPrice: part.price ? Number(part.price) : 0,
          cost: part.cost != null ? Number(part.cost) : null,
          partId: part.id,
          sku: part.sku,
        },
      ];
    });
  }
  function addLabor() {
    setComponents((p) => [...p, { kind: "labor", description: "Labor", hours: 0, rate: 0 }]);
  }
  function addFee(fixed: boolean) {
    setComponents((p) => [...p, { kind: "fee", description: fixed ? "Fixed fee" : "Custom fee", amount: 0, fixed }]);
  }

  const itemIdx = components.map((c, i) => (c.kind === "item" ? i : -1)).filter((i) => i >= 0);
  const laborIdx = components.map((c, i) => (c.kind === "labor" ? i : -1)).filter((i) => i >= 0);
  const feeIdx = components.map((c, i) => (c.kind === "fee" ? i : -1)).filter((i) => i >= 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="components" value={JSON.stringify(components)} />
      <input type="hidden" name="markupPct" value={markup} />
      <input type="hidden" name="pricingMode" value={mode} />

      <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          name="name"
          required
          defaultValue={name}
          placeholder="Package name *"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
        />
        <input
          name="category"
          defaultValue={category}
          placeholder="Category"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        />
        <textarea
          name="description"
          defaultValue={description}
          rows={2}
          placeholder="Description (optional)"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-3"
        />
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
            Bundle contents
          </h3>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="w-[260px]">
              <PartSearchCombobox mode="adder" placeholder="+ Search inventory to add…" onPick={addPart} />
            </div>
            <button type="button" onClick={addLabor} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
              + Labor
            </button>
            <button type="button" onClick={() => addFee(false)} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
              + Custom fee
            </button>
            <button type="button" onClick={() => addFee(true)} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
              + Fixed fee
            </button>
          </div>
        </div>

        {components.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">
            Empty package. Add parts from inventory, labor, or fees above.
          </div>
        ) : (
          <div>
            {/* Parts */}
            <div className="px-4 py-2 bg-zinc-800/50 border-y border-white/10 text-[11px] uppercase tracking-wider text-zinc-300 font-body font-semibold flex justify-between">
              <span>Parts</span>
              <span className="text-zinc-500 normal-case tracking-normal">{itemIdx.length}</span>
            </div>
            {itemIdx.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">No parts yet.</div>
            ) : (
              <>
                <div className="px-4 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                  <span className="col-span-2">Part #</span>
                  <span className="col-span-3">Description</span>
                  <span className="col-span-1 text-right">Qty</span>
                  <span className="col-span-2 text-right">Cost</span>
                  <span className="col-span-2 text-right">Sell</span>
                  <span className="col-span-2 text-right">Line</span>
                </div>
                <div className="divide-y divide-white/5">
                  {itemIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "item") return null;
                    return (
                      <div key={i} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body">
                        <input
                          value={c.sku ?? ""}
                          onChange={(e) => update(i, { sku: e.target.value })}
                          placeholder="Part #"
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <div className="col-span-3">
                          <PartSearchCombobox
                            mode="inline"
                            value={c.description}
                            onText={(s) => update(i, { description: s })}
                            onPick={(p) =>
                              update(i, {
                                description: `${p.sku} — ${p.name}`,
                                unitPrice: p.price ? Number(p.price) : 0,
                                cost: p.cost != null ? Number(p.cost) : null,
                                partId: p.id,
                                sku: p.sku,
                              })
                            }
                          />
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={c.quantity}
                          onChange={(e) => update(i, { quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                          className="col-span-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.cost ?? ""}
                          placeholder="—"
                          title="Internal cost per unit (e.g. promo cost)"
                          onChange={(e) => update(i, { cost: e.target.value === "" ? null : Number(e.target.value) })}
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-zinc-300 text-right"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.unitPrice}
                          title="Sell (retail) price per unit"
                          onChange={(e) => update(i, { unitPrice: Number(e.target.value) })}
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <span className="text-[11px] text-white">{fmt((c.quantity || 0) * (c.unitPrice || 0))}</span>
                          <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Labor */}
            <div className="px-4 py-2 mt-3 bg-blue-500/15 border-y border-blue-500/30 text-[11px] uppercase tracking-wider text-blue-200 font-body font-semibold flex justify-between">
              <span>Labor</span>
              <span className="text-blue-300/60 normal-case tracking-normal">{laborIdx.length}</span>
            </div>
            {laborIdx.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">No labor yet.</div>
            ) : (
              <>
                <div className="px-4 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                  <span className="col-span-6">Description</span>
                  <span className="col-span-2 text-right">Hours</span>
                  <span className="col-span-2 text-right">Rate / hr</span>
                  <span className="col-span-2 text-right">Total</span>
                </div>
                <div className="divide-y divide-white/5">
                  {laborIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "labor") return null;
                    return (
                      <div key={i} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body bg-blue-500/5">
                        <input
                          value={c.description}
                          onChange={(e) => update(i, { description: e.target.value })}
                          placeholder="Labor description (e.g. Install lightbar)"
                          className="col-span-6 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={c.hours}
                          onChange={(e) => update(i, { hours: Number(e.target.value) })}
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.rate}
                          onChange={(e) => update(i, { rate: Number(e.target.value) })}
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <span className="text-[11px] text-white font-semibold">{fmt((c.hours || 0) * (c.rate || 0))}</span>
                          <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Fees */}
            <div className="px-4 py-2 mt-3 bg-amber-500/15 border-y border-amber-500/30 text-[11px] uppercase tracking-wider text-amber-200 font-body font-semibold flex justify-between">
              <span>Fees &amp; Add-ons</span>
              <span className="text-amber-300/60 normal-case tracking-normal">{feeIdx.length}</span>
            </div>
            {feeIdx.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">No fees yet.</div>
            ) : (
              <>
                <div className="px-4 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                  <span className="col-span-7">Description</span>
                  <span className="col-span-3 text-right">Amount</span>
                  <span className="col-span-2 text-right">Type</span>
                </div>
                <div className="divide-y divide-white/5">
                  {feeIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "fee") return null;
                    return (
                      <div key={i} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body bg-amber-500/5">
                        <input
                          value={c.description}
                          onChange={(e) => update(i, { description: e.target.value })}
                          placeholder="Fee description"
                          className="col-span-7 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.amount}
                          onChange={(e) => update(i, { amount: Number(e.target.value) })}
                          className="col-span-3 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <span className="text-[10px] uppercase text-amber-400 tracking-wider">{c.fixed ? "Fixed" : "Custom"}</span>
                          <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {(() => {
        // Profitability reflects what we PAY (cost) against what the customer
        // actually pays — the discounted package price when one is set, else the
        // retail (list) sell. Margin % is over the sell; markup % is over cost.
        const bpNum = bundlePrice.trim() === "" ? null : Number(bundlePrice);
        const hasBundle = bpNum != null && Number.isFinite(bpNum) && bpNum > 0;
        const discounted = hasBundle ? (bpNum as number) : value.parts; // parts-only sell
        const marginD = discounted - value.cost;
        const marginPct = discounted > 0 ? (marginD / discounted) * 100 : null;
        const markupPct = value.cost > 0 ? (marginD / value.cost) * 100 : null;
        const discountOffRetail = hasBundle ? value.parts - (bpNum as number) : 0;
        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-body">
            <div className="flex flex-wrap gap-4 text-zinc-400 items-center">
              <span>Cost (we pay) <span className="text-white">{fmt(value.cost)}</span></span>
              <span>Retail (list) <span className="text-white">{fmt(value.parts)}</span></span>
              <span>
                {hasBundle ? "Discounted price" : "Sell price"}{" "}
                <span className="text-white font-semibold">{fmt(discounted)}</span>
                {hasBundle ? <span className="text-amber-300/80"> (−{fmt(discountOffRetail)} off retail)</span> : null}
              </span>
              <span>
                Margin{" "}
                <span className={marginD >= 0 ? "text-emerald-300" : "text-red-400"}>
                  {fmt(marginD)}
                  {marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""}
                </span>
              </span>
              <span>
                Markup{" "}
                <span className={marginD >= 0 ? "text-emerald-300" : "text-red-400"}>
                  {markupPct != null ? `${markupPct.toFixed(1)}%` : "—"}
                </span>
              </span>
              {value.labor || value.fees ? (
                <span className="text-zinc-500">
                  + Labor {fmt(value.labor)} · Fees {fmt(value.fees)}
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <a href="/packages" className="text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors">
                Back
              </a>
              <button type="submit" className="font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">
                Save package
              </button>
            </div>
          </div>
        );
      })()}

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "markup" | "margin")}
            title="Markup = % on cost. Margin = % off list (what a dealer discount off list means)."
            className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white uppercase tracking-wider font-body"
          >
            <option value="markup">Markup % (on cost)</option>
            <option value="margin">Margin % (off list)</option>
          </select>
          <div className="relative">
            <input
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 40"
              className="bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white w-24"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">%</span>
          </div>
          <button
            type="button"
            onClick={applyMarkup}
            className="text-[11px] font-body text-black bg-amber-500 hover:bg-amber-400 rounded px-3 py-1.5 font-semibold"
          >
            Apply to sell prices
          </button>
          <span className="text-[11px] text-zinc-500">
            {mode === "margin"
              ? "Margin mode: Sell = Cost ÷ (1 − margin). A 40% dealer discount off list → enter 40 (cost $60 → sell $100)."
              : "Markup mode: Sell = Cost × (1 + markup). Buy at 40% off list & sell at list = 66.67% markup."}
          </span>
        </div>
      </div>

      {(() => {
        const bp = bundlePrice.trim() === "" ? null : Number(bundlePrice);
        const valid = bp != null && Number.isFinite(bp) && bp > 0;
        const tooHigh = valid && bp > value.parts + 0.005;
        const saving = valid && !tooHigh ? value.parts - bp : null;
        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-body font-semibold text-white uppercase tracking-wider">
                Bundle / promo price
              </label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                <input
                  name="packagePrice"
                  value={bundlePrice}
                  onChange={(e) => setBundlePrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 12500.00"
                  className="bg-black/40 border border-white/10 rounded-md pl-5 pr-3 py-1.5 text-sm text-white w-40"
                />
              </div>
              {bundlePrice.trim() !== "" ? (
                <button
                  type="button"
                  onClick={() => setBundlePrice("")}
                  className="text-[11px] text-zinc-500 hover:text-white"
                >
                  Clear
                </button>
              ) : null}
              {saving != null ? (
                <span className="text-[11px] text-emerald-300">
                  Customer saves {fmt(saving)} vs à la carte parts ({fmt(value.parts)}) — spread across the part lines on a quote.
                </span>
              ) : null}
              {tooHigh ? (
                <span className="text-[11px] text-red-400">
                  Bundle price is above the à la carte parts total ({fmt(value.parts)}); it can&apos;t allocate. Lower it or leave blank.
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-zinc-500">
              Optional. Leave blank to quote at à la carte line prices. When set, dropping this package on a quote allocates
              this total across the <em>part</em> lines as per-line discounts so their totals sum to it (labor/fees quote
              separately). Sell-side only — this is the customer&apos;s deal price, not a vendor cost.
            </p>
          </div>
        );
      })()}

      <p className="text-[11px] text-zinc-500 font-body">
        Package value is a reference figure (undiscounted). On a quote, each component becomes its own editable line, so discounts and tax are applied there.
      </p>
    </form>
  );
}
