"use client";

import { useMemo, useState } from "react";
import type { POLineItem } from "@/db/schema";
import { PartSearchCombobox } from "@/components/PartSearchCombobox";
import { PO_MANUAL_STATUSES, poStatusLabel } from "@/lib/poStatus";

type PromoRef = { id: string; name: string; vendorId: string };

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function POEditor({
  id,
  vendorId: initialVendorId,
  notes,
  expectedAt,
  initialLines,
  vendors,
  promos,
  status,
  saveDraft,
  receivePO,
}: {
  id: string;
  vendorId: string;
  notes: string;
  expectedAt: string;
  initialLines: POLineItem[];
  vendors: { id: string; name: string }[];
  promos: PromoRef[];
  status: string;
  saveDraft: (formData: FormData) => Promise<void>;
  receivePO: (formData: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState<POLineItem[]>(initialLines);
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [promoId, setPromoId] = useState("");
  const [promoMsg, setPromoMsg] = useState<string | null>(null);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0),
    [lines],
  );

  function update(i: number, patch: Partial<POLineItem>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function remove(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: "", quantity: 1, quantityReceived: 0, unitCost: 0 }]);
  }

  // Picking a part pre-fills unit cost from the VENDOR PRICE LIST (à la carte),
  // not from parts.cost — parts.cost tracks the moving average and drifts below
  // à la carte once discounted package stock lands, so pre-filling a full-price
  // order from it would order at a promo-influenced price Whelen won't honour.
  async function pickPart(i: number, p: { id: string; sku: string; name: string; cost?: string | null }) {
    let unitCost = p.cost ? Number(p.cost) : 0;
    if (vendorId && p.sku) {
      try {
        const res = await fetch(
          `/api/vendor-part-prices?vendorId=${encodeURIComponent(vendorId)}&sku=${encodeURIComponent(p.sku)}&current=1`,
        );
        const rows = (await res.json()) as { alacarteUnitCost: string }[];
        if (Array.isArray(rows) && rows.length) unitCost = Number(rows[0].alacarteUnitCost);
      } catch {
        /* fall back to parts.cost */
      }
    }
    update(i, {
      partId: p.id,
      sku: p.sku,
      description: `${p.sku} — ${p.name}`,
      unitCost,
      // A manual pick is always an individual line — never a package.
      sourcePromoId: null,
      sourceKind: "individual",
      alacarteCostSnap: null,
    });
  }

  // Applying a promo runs the allocation engine (server-side) and replaces the
  // lines with allocated, promo-stamped ones. Allocation happens here, at PO
  // build time, never at receipt.
  async function applyPromo() {
    if (!promoId) return;
    setPromoMsg(null);
    try {
      const res = await fetch(`/api/vendor-promos/${promoId}/po-lines`);
      const body = await res.json();
      if (!res.ok) {
        setPromoMsg(body?.error ?? "Could not apply promo.");
        return;
      }
      setLines(body.lines as POLineItem[]);
      setVendorId(body.vendorId as string);
      setPromoMsg(`Applied — ${body.lines.length} lines at allocated package cost.`);
    } catch (e) {
      setPromoMsg((e as Error).message);
    }
  }

  const fullyReceived = status === "fulfilled" || status === "received";
  const promosForVendor = promos.filter((p) => !vendorId || p.vendorId === vendorId);
  // Status is user-picked (Pending/Ordered) only before any receiving; once
  // parts land it's auto-managed (Received → Fulfilled).
  const receivedStates = ["partially_received", "received", "fulfilled"];
  const statusIsAuto = receivedStates.includes(status);

  return (
    <div className="space-y-4">
      {/* Draft form */}
      <form action={saveDraft} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            name="vendorId"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            disabled={fullyReceived}
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            name="expectedAt"
            type="date"
            defaultValue={expectedAt}
            disabled={fullyReceived}
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          />
          {statusIsAuto ? (
            // Auto-managed once receiving starts — show it read-only, and keep
            // the value on save via a hidden field.
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500">Status:</span>
              <span className="text-white font-medium">{poStatusLabel(status)}</span>
              <input type="hidden" name="status" value={status} />
            </div>
          ) : (
            <select
              name="status"
              defaultValue={status === "ordered" ? "ordered" : "pending"}
              title="Received and Fulfilled are set automatically as parts are received"
              className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              {PO_MANUAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <div className="text-right text-sm font-body text-white">
            <span className="text-zinc-500 mr-2">Total:</span>
            <span className="font-bold">{fmt(total)}</span>
          </div>
        </div>

        {/* Apply a promo package */}
        {!fullyReceived ? (
          <div className="bg-surface border border-amber-500/20 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-body">Package buy</span>
              <select
                value={promoId}
                onChange={(e) => setPromoId(e.target.value)}
                className="flex-1 min-w-[12rem] bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white"
              >
                <option value="">— Apply a promo package… —</option>
                {promosForVendor.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyPromo}
                disabled={!promoId}
                className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-3 py-1.5"
              >
                Apply
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 font-body">
              Applying a promo replaces the lines with the package&apos;s parts at their allocated cost (the discount
              spread across the basket). Individual lines you add below pre-fill at full à la carte price.
            </p>
            {promoMsg ? <p className="text-[11px] text-amber-300 font-body">{promoMsg}</p> : null}
          </div>
        ) : null}

        <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Line items</h3>
            {!fullyReceived ? (
              <button type="button" onClick={addLine} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
                + Add line
              </button>
            ) : null}
          </div>
          {lines.length > 0 ? (
            <div className="px-4 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
              <span className="col-span-2">Part #</span>
              <span className="col-span-4">Description</span>
              <span className="col-span-1 text-right">Qty</span>
              <span className="col-span-2 text-right">Unit cost</span>
              <span className="col-span-2 text-right">Recv</span>
              <span className="col-span-1" />
            </div>
          ) : null}
          <div className="divide-y divide-white/5">
            {lines.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">No lines yet.</div>
            ) : (
              lines.map((l, i) => {
                const locked = fullyReceived || !!l.sourcePromoId;
                return (
                <div key={l.id ?? i} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body">
                  {/* Part # — its own column, editable for manual entry */}
                  <input
                    value={l.sku ?? ""}
                    onChange={(e) => update(i, { sku: e.target.value })}
                    disabled={locked}
                    placeholder="Part #"
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white disabled:opacity-60"
                  />
                  {/* Description */}
                  {locked ? (
                    <div className="col-span-4 flex items-center gap-2">
                      <input
                        value={l.description ?? ""}
                        disabled
                        className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white disabled:opacity-60"
                      />
                      {l.sourcePromoId ? (
                        <span
                          className="text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-300 rounded px-1.5 py-0.5"
                          title={
                            l.alacarteCostSnap != null
                              ? `Allocated from package. À la carte ${fmt(Number(l.alacarteCostSnap))}`
                              : "Allocated from package"
                          }
                        >
                          pkg
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="col-span-4">
                      <PartSearchCombobox
                        mode="inline"
                        value={l.description ?? ""}
                        onText={(s) => update(i, { description: s })}
                        onPick={(p) => void pickPart(i, p)}
                        placeholder="Search part by SKU, name, or part #…"
                      />
                    </div>
                  )}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={l.quantity ?? 0}
                    onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                    disabled={fullyReceived}
                    placeholder="Qty"
                    className="col-span-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitCost ?? 0}
                    onChange={(e) => update(i, { unitCost: Number(e.target.value) })}
                    disabled={fullyReceived || !!l.sourcePromoId}
                    title={l.sourcePromoId ? "Allocated package cost — edit the promo to change it" : undefined}
                    placeholder="Unit cost"
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right disabled:opacity-60"
                  />
                  <span className="col-span-2 text-right text-zinc-400">
                    {l.quantityReceived || 0} / {l.quantity || 0}
                  </span>
                  {!fullyReceived ? (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="col-span-1 text-[11px] text-zinc-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="col-span-1" />
                  )}
                </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-surface border border-white/5 rounded-lg p-4">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body block mb-1">Notes</label>
          <textarea
            name="notes"
            defaultValue={notes}
            disabled={fullyReceived}
            rows={3}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          />
        </div>

        <div className="flex justify-end gap-2">
          <a
            href="/purchase-orders"
            className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2"
          >
            Back
          </a>
          {!fullyReceived ? (
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2"
            >
              Save draft
            </button>
          ) : null}
        </div>
      </form>

      {/* Receive form */}
      {!fullyReceived ? (
        <form action={receivePO} className="bg-surface border border-amber-500/30 rounded-lg p-4 space-y-3">
          <input type="hidden" name="id" value={id} />
          <h3 className="text-xs font-body font-semibold text-amber-300 uppercase tracking-wider">Receive shipment</h3>
          <p className="text-[11px] text-zinc-400 font-body">
            For each line, enter the qty arriving in this shipment. Each line creates a costing layer at its unit cost —
            package lines land at their allocated cost, individual lines at the price paid.
          </p>
          <div className="space-y-2">
            {lines.length === 0 ? (
              <p className="text-xs text-zinc-500">Add lines to the PO first.</p>
            ) : (
              lines.map((l, i) => {
                const remaining = (l.quantity || 0) - (l.quantityReceived || 0);
                return (
                  <div key={l.id ?? i} className="grid grid-cols-12 items-center text-xs font-body gap-2">
                    <span className="col-span-7 text-white truncate">
                      <span className="text-zinc-500">[{l.sku || "no part #"}]</span>{" "}
                      {l.description || `Line ${i + 1}`} <span className="text-zinc-500">@ {fmt(Number(l.unitCost) || 0)}</span>
                    </span>
                    <span className="col-span-2 text-zinc-500 text-right">remaining {remaining}</span>
                    <input
                      name={`receive_${i}`}
                      type="number"
                      min="0"
                      max={remaining}
                      defaultValue={remaining}
                      disabled={remaining <= 0 || !l.partId}
                      placeholder="Receive"
                      className="col-span-3 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right disabled:opacity-40"
                    />
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-green-500 hover:bg-green-400 text-black rounded-md px-4 py-2"
            >
              Receive
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
