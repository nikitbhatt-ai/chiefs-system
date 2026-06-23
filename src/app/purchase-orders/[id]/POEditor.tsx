"use client";

import { useMemo, useState } from "react";
import type { POLineItem } from "@/db/schema";
import { PartSearchCombobox } from "@/components/PartSearchCombobox";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function POEditor({
  id,
  vendorId,
  notes,
  expectedAt,
  initialLines,
  vendors,
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
  status: string;
  saveDraft: (formData: FormData) => Promise<void>;
  receivePO: (formData: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState<POLineItem[]>(initialLines);

  const total = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
        0,
      ),
    [lines],
  );

  function update(i: number, patch: Partial<POLineItem>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function remove(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { description: "", quantity: 1, quantityReceived: 0, unitCost: 0 },
    ]);
  }

  const fullyReceived = status === "received";

  return (
    <div className="space-y-4">
      {/* Draft form */}
      <form action={saveDraft} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            name="vendorId"
            defaultValue={vendorId}
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
          <div className="text-right text-sm font-body text-white">
            <span className="text-zinc-500 mr-2">Total:</span>
            <span className="font-bold">{fmt(total)}</span>
          </div>
        </div>

        <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
              Line items
            </h3>
            {!fullyReceived ? (
              <button
                type="button"
                onClick={addLine}
                className="text-[11px] font-body text-amber-400 hover:text-amber-300"
              >
                + Add line
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-white/5">
            {lines.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">
                No lines yet.
              </div>
            ) : (
              lines.map((l, i) => (
                <div
                  key={i}
                  className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body"
                >
                  {fullyReceived ? (
                    <input
                      value={l.description ?? ""}
                      disabled
                      className="col-span-6 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white disabled:opacity-60"
                    />
                  ) : (
                    <div className="col-span-6">
                      <PartSearchCombobox
                        mode="inline"
                        value={l.description ?? ""}
                        onText={(s) => update(i, { description: s })}
                        onPick={(p) =>
                          update(i, {
                            partId: p.id,
                            description: `${p.sku} — ${p.name}`,
                            unitCost: p.cost ? Number(p.cost) : 0,
                          })
                        }
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
                    disabled={fullyReceived}
                    placeholder="Unit cost"
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                  />
                  <span className="col-span-2 text-right text-zinc-400">
                    Recv {l.quantityReceived || 0} / {l.quantity || 0}
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
              ))
            )}
          </div>
        </div>

        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body block mb-1">
            Notes
          </label>
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
        <form
          action={receivePO}
          className="bg-[#161624] border border-amber-500/30 rounded-lg p-4 space-y-3"
        >
          <input type="hidden" name="id" value={id} />
          <h3 className="text-xs font-body font-semibold text-amber-300 uppercase tracking-wider">
            Receive shipment
          </h3>
          <p className="text-[11px] text-zinc-400 font-body">
            For each line, enter the qty arriving in this shipment. Each line
            creates a costing layer at its unit cost — used for FIFO and
            weighted-average per part.
          </p>
          <div className="space-y-2">
            {lines.length === 0 ? (
              <p className="text-xs text-zinc-500">Add lines to the PO first.</p>
            ) : (
              lines.map((l, i) => {
                const remaining = (l.quantity || 0) - (l.quantityReceived || 0);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-12 items-center text-xs font-body gap-2"
                  >
                    <span className="col-span-7 text-white truncate">
                      {l.description || `Line ${i + 1}`}{" "}
                      <span className="text-zinc-500">@ {fmt(Number(l.unitCost) || 0)}</span>
                    </span>
                    <span className="col-span-2 text-zinc-500 text-right">
                      remaining {remaining}
                    </span>
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
