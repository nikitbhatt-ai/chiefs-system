"use client";

import { useMemo, useState } from "react";
import { PartSearchCombobox, type PartHit } from "@/components/PartSearchCombobox";

// Mirrors PackageComponent in src/db/schema.ts.
export type BuilderComponent =
  | { kind: "item"; description: string; quantity: number; unitPrice: number; partId?: string | null; sku?: string | null }
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
  initialComponents,
  action,
}: {
  id: string;
  name: string;
  category: string;
  description: string;
  initialComponents: BuilderComponent[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [components, setComponents] = useState<BuilderComponent[]>(initialComponents);

  const value = useMemo(() => {
    let parts = 0;
    let labor = 0;
    let fees = 0;
    for (const c of components) {
      if (c.kind === "item") parts += (c.quantity || 0) * (c.unitPrice || 0);
      else if (c.kind === "labor") labor += (c.hours || 0) * (c.rate || 0);
      else fees += c.amount || 0;
    }
    return { parts, labor, fees, total: parts + labor + fees };
  }, [components]);

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

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
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

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
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
                  <span className="col-span-6">Description</span>
                  <span className="col-span-2 text-right">Qty</span>
                  <span className="col-span-2 text-right">Unit price</span>
                  <span className="col-span-2 text-right">Line</span>
                </div>
                <div className="divide-y divide-white/5">
                  {itemIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "item") return null;
                    return (
                      <div key={i} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body">
                        <div className="col-span-6">
                          <PartSearchCombobox
                            mode="inline"
                            value={c.description}
                            onText={(s) => update(i, { description: s })}
                            onPick={(p) =>
                              update(i, {
                                description: `${p.sku} — ${p.name}`,
                                unitPrice: p.price ? Number(p.price) : 0,
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
                          className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={c.unitPrice}
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

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-body">
        <div className="flex flex-wrap gap-4 text-zinc-400">
          <span>Parts <span className="text-white">{fmt(value.parts)}</span></span>
          <span>Labor <span className="text-white">{fmt(value.labor)}</span></span>
          <span>Fees <span className="text-white">{fmt(value.fees)}</span></span>
          <span className="text-zinc-300">Package value <span className="text-white font-bold text-sm">{fmt(value.total)}</span></span>
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
      <p className="text-[11px] text-zinc-500 font-body">
        Package value is a reference figure (undiscounted). On a quote, each component becomes its own editable line, so discounts and tax are applied there.
      </p>
    </form>
  );
}
