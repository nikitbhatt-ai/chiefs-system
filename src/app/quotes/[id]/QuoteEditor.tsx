"use client";

import { useEffect, useMemo, useState } from "react";
import { PartSearchCombobox, type PartHit } from "@/components/PartSearchCombobox";
import { PackageSearchCombobox, type PackageHit } from "@/components/PackageSearchCombobox";
import { componentsToQuoteLines } from "@/lib/packages";

export type QuoteLine =
  | {
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      discountKind: "pct" | "amt";
      partId?: string;
    }
  | {
      kind: "fee";
      description: string;
      amount: number;
      fixed: boolean;
    }
  | {
      // Labor: hours × rate. Rolls into the quote subtotal (taxable
      // base) the same way parts do, so the tax calculation just works.
      kind: "labor";
      description: string;
      hours: number;
      rate: number;
    };

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function QuoteEditor({
  id,
  customerId,
  status,
  notes,
  initialLines,
  customers,
  action,
}: {
  id: string;
  customerId: string | null;
  status: "draft" | "sent" | "approved" | "converted";
  notes: string;
  initialLines: QuoteLine[];
  customers: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [taxRate, setTaxRate] = useState("0");
  // Controlled status mirrors the prop so the select reflects the latest
  // value after a save → revalidate cycle. With an uncontrolled
  // defaultValue, React keeps the original DOM value across re-renders
  // even after the underlying record changes — that's the 'reverts to
  // draft' visual bug.
  const [statusValue, setStatusValue] = useState<typeof status>(status);
  // Drag-reorder state for line items. `draggingIndex` styles the row
  // being dragged (faded out); `dragOverIndex` highlights the drop slot.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Feedback for the "Save as package" action (create a reusable package
  // from the current quote's lines).
  const [pkgMsg, setPkgMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [savingPkg, setSavingPkg] = useState(false);
  useEffect(() => {
    setStatusValue(status);
  }, [status]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let feeTotal = 0;
    let laborTotal = 0;
    for (const l of lines) {
      if (l.kind === "item") {
        const gross = (l.quantity || 0) * (l.unitPrice || 0);
        const disc =
          l.discountKind === "pct"
            ? gross * ((l.discount || 0) / 100)
            : l.discount || 0;
        subtotal += gross;
        discountTotal += disc;
      } else if (l.kind === "labor") {
        laborTotal += (l.hours || 0) * (l.rate || 0);
      } else {
        feeTotal += l.amount || 0;
      }
    }
    const taxBase = subtotal - discountTotal + feeTotal + laborTotal;
    const tax = taxBase * ((Number(taxRate) || 0) / 100);
    const grand = taxBase + tax;
    return { subtotal, discountTotal, feeTotal, laborTotal, tax, grand };
  }, [lines, taxRate]);

  function updateLine(i: number, patch: Partial<QuoteLine>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? ({ ...l, ...patch } as QuoteLine) : l)),
    );
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  // Reorder a line. Used by both the drag handle (HTML5 DnD) and the
  // up/down arrow buttons. Bails on no-op or out-of-range moves so
  // callers don't have to bounds-check.
  function moveLine(from: number, to: number) {
    setLines((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  function addItem() {
    setLines((p) => [
      ...p,
      {
        kind: "item",
        description: "",
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        discountKind: "pct",
      },
    ]);
  }
  function addPart(part: PartHit) {
    setLines((prev) => {
      // If this part is already on the quote as an item line, bump its
      // quantity by 1 instead of appending a duplicate row.
      const existingIdx = prev.findIndex(
        (l) => l.kind === "item" && l.partId === part.id,
      );
      if (existingIdx >= 0) {
        return prev.map((l, i) =>
          i === existingIdx && l.kind === "item"
            ? { ...l, quantity: (l.quantity || 0) + 1 }
            : l,
        );
      }
      return [
        ...prev,
        {
          kind: "item",
          description: `${part.sku} — ${part.name}`,
          quantity: 1,
          unitPrice: part.price ? Number(part.price) : 0,
          discount: 0,
          discountKind: "pct",
          partId: part.id,
        },
      ];
    });
  }
  function addPackage(pkg: PackageHit) {
    // Itemized roll-up: expand the package's components into individual,
    // editable quote lines (parts / labor / fees). The bundle is appended
    // verbatim — a package can intentionally repeat a part — and the rep
    // tweaks quantities, prices, or discounts from there.
    const expanded = componentsToQuoteLines(pkg.components ?? []) as QuoteLine[];
    if (expanded.length === 0) {
      setPkgMsg({ tone: "err", text: `"${pkg.name}" has no components.` });
      return;
    }
    setLines((prev) => [...prev, ...expanded]);
    setPkgMsg({ tone: "ok", text: `Added "${pkg.name}" (${expanded.length} line${expanded.length === 1 ? "" : "s"}).` });
  }

  async function saveAsPackage() {
    if (lines.length === 0) {
      setPkgMsg({ tone: "err", text: "Add some line items before saving a package." });
      return;
    }
    const name = window.prompt("Name this package (e.g. Standard Patrol Upfit):");
    if (!name || !name.trim()) return;
    // Map the editor's lines to package components. Per-line discounts are
    // dropped — a package defines the bundle; discounting happens on the quote.
    const components = lines.map((l) => {
      if (l.kind === "labor") return { kind: "labor", description: l.description, hours: l.hours, rate: l.rate };
      if (l.kind === "fee") return { kind: "fee", description: l.description, amount: l.amount, fixed: l.fixed };
      return {
        kind: "item",
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        partId: l.partId ?? null,
      };
    });
    setSavingPkg(true);
    setPkgMsg(null);
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), components }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPkgMsg({ tone: "err", text: data?.error ?? "Could not save package." });
        return;
      }
      setPkgMsg({ tone: "ok", text: `Saved package "${name.trim()}". Find it under Operations → Packages.` });
    } catch {
      setPkgMsg({ tone: "err", text: "Network error saving package." });
    } finally {
      setSavingPkg(false);
    }
  }

  function addFee(fixed = false) {
    setLines((p) => [
      ...p,
      { kind: "fee", description: fixed ? "Fixed fee" : "Custom fee", amount: 0, fixed },
    ]);
  }
  function addLabor() {
    setLines((p) => [
      ...p,
      { kind: "labor", description: "Labor", hours: 0, rate: 0 },
    ]);
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          name="customerId"
          defaultValue={customerId ?? ""}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">— No customer —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          value={statusValue}
          onChange={(e) => setStatusValue(e.target.value as typeof status)}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="approved">Approved</option>
          <option value="converted">Converted</option>
        </select>
        <input
          name="taxRate"
          type="number"
          min="0"
          step="0.01"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
          placeholder="Tax rate %"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        />
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
            Line items
          </h3>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            <div className="w-[240px]">
              <PartSearchCombobox mode="adder" placeholder="+ Search inventory to add…" onPick={addPart} />
            </div>
            <div className="w-[220px]">
              <PackageSearchCombobox placeholder="+ Add package…" onPick={addPackage} />
            </div>
            <button
              type="button"
              onClick={addItem}
              className="text-[11px] font-body text-amber-400 hover:text-amber-300"
            >
              + Custom item
            </button>
            <button
              type="button"
              onClick={() => addFee(false)}
              className="text-[11px] font-body text-amber-400 hover:text-amber-300"
            >
              + Custom fee
            </button>
            <button
              type="button"
              onClick={() => addFee(true)}
              className="text-[11px] font-body text-amber-400 hover:text-amber-300"
            >
              + Fixed fee
            </button>
            <button
              type="button"
              onClick={addLabor}
              className="text-[11px] font-body text-amber-400 hover:text-amber-300"
            >
              + Labor
            </button>
            <span className="text-white/10">|</span>
            <button
              type="button"
              onClick={saveAsPackage}
              disabled={savingPkg}
              className="text-[11px] font-body text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-1 disabled:opacity-40"
            >
              {savingPkg ? "Saving…" : "Save as package"}
            </button>
          </div>
        </div>
        {pkgMsg ? (
          <div
            className={`px-4 py-2 text-[11px] font-body border-b border-white/5 ${
              pkgMsg.tone === "ok" ? "text-green-300 bg-green-500/5" : "text-red-300 bg-red-500/5"
            }`}
          >
            {pkgMsg.text}
          </div>
        ) : null}
        {(() => {
          // Group line indices by kind, preserving their position in the
          // flat `lines` array. Rendering walks each section in array
          // order so users see Parts → Labor → Fees with clear dividers,
          // even though the underlying storage stays flat (and stable
          // for moveLine).
          const itemIdx: number[] = [];
          const laborIdx: number[] = [];
          const feeIdx: number[] = [];
          lines.forEach((l, i) => {
            if (l.kind === "item") itemIdx.push(i);
            else if (l.kind === "labor") laborIdx.push(i);
            else feeIdx.push(i);
          });

          // For a given flat index `i` in a section list, return the
          // flat-index of its same-kind neighbor above/below (or null
          // at the section edge). The arrow buttons and drag-drop both
          // consult these so reorder never crosses section lines.
          const targets = (sectionList: number[], i: number) => {
            const pos = sectionList.indexOf(i);
            return {
              upTo: pos > 0 ? sectionList[pos - 1] : null,
              downTo: pos >= 0 && pos < sectionList.length - 1 ? sectionList[pos + 1] : null,
            };
          };

          // Drop handler shared by every row. Rejects cross-kind drops
          // so a labor row can't be dragged into the middle of parts.
          const rowDropHandlers = (i: number) => ({
            onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
              setDraggingIndex(i);
            },
            onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverIndex !== i) setDragOverIndex(i);
            },
            onDragLeave: () => {
              if (dragOverIndex === i) setDragOverIndex(null);
            },
            onDrop: (e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from) && lines[from]?.kind === lines[i]?.kind) {
                moveLine(from, i);
              }
              setDraggingIndex(null);
              setDragOverIndex(null);
            },
            onDragEnd: () => {
              setDraggingIndex(null);
              setDragOverIndex(null);
            },
          });

          if (lines.length === 0) {
            return (
              <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">
                No line items yet. Add items, labor, or fees above.
              </div>
            );
          }

          return (
            <div>
              {/* === Parts & Items === */}
              <div className="px-4 py-2 bg-zinc-800/50 border-y border-white/10 text-[11px] uppercase tracking-wider text-zinc-300 font-body font-semibold flex justify-between">
                <span>Parts &amp; Items</span>
                <span className="text-zinc-500 normal-case tracking-normal">
                  {itemIdx.length} {itemIdx.length === 1 ? "row" : "rows"}
                </span>
              </div>
              {itemIdx.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">
                  No parts on this quote yet.
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                    <span className="col-span-1">Order</span>
                    <span className="col-span-3">Description</span>
                    <span className="col-span-1 text-right">Qty</span>
                    <span className="col-span-2 text-right">Unit price</span>
                    <span className="col-span-2 text-right">Discount</span>
                    <span className="col-span-2">Discount type</span>
                    <span className="col-span-1"></span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {itemIdx.map((i) => {
                      const l = lines[i];
                      if (l.kind !== "item") return null;
                      const { upTo, downTo } = targets(itemIdx, i);
                      return (
                        <div
                          key={i}
                          draggable
                          {...rowDropHandlers(i)}
                          className={`px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body transition-colors ${
                            draggingIndex === i ? "opacity-40" : ""
                          } ${
                            dragOverIndex === i && draggingIndex !== i
                              ? "bg-amber-500/10 ring-1 ring-amber-500/40"
                              : ""
                          }`}
                        >
                          <ReorderControls
                            fromIndex={i}
                            upTo={upTo}
                            downTo={downTo}
                            onMove={moveLine}
                          />
                          <div className="col-span-3">
                    <PartSearchCombobox
                      mode="inline"
                      value={l.description}
                      onText={(s) => updateLine(i, { description: s })}
                      onPick={(p) =>
                        updateLine(i, {
                          description: `${p.sku} — ${p.name}`,
                          unitPrice: p.price ? Number(p.price) : 0,
                          partId: p.id,
                        })
                      }
                    />
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={l.quantity}
                    onChange={(e) =>
                      // Force integer quantities — quote lines map to
                      // discrete inventory units so fractional qtys are
                      // never valid. Floor any decimal the browser lets
                      // through (Number("1.5") -> 1).
                      updateLine(i, {
                        quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    placeholder="Qty"
                    className="col-span-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                    placeholder="Price"
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.discount}
                    onChange={(e) => updateLine(i, { discount: Number(e.target.value) })}
                    placeholder="Discount"
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                  />
                  <select
                    value={l.discountKind}
                    onChange={(e) =>
                      updateLine(i, {
                        discountKind: e.target.value as "pct" | "amt",
                      })
                    }
                    className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
                  >
                    <option value="pct">% off</option>
                    <option value="amt">$ off</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="col-span-1 text-[11px] text-zinc-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                  <div className="col-span-12 text-right text-[11px] text-zinc-500">
                    {(() => {
                      const gross = (l.quantity || 0) * (l.unitPrice || 0);
                      const disc =
                        l.discountKind === "pct"
                          ? gross * ((l.discount || 0) / 100)
                          : l.discount || 0;
                      return `Line total: ${fmt(gross - disc)}`;
                    })()}
                  </div>
                </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* === Labor === */}
              <div className="px-4 py-2 mt-3 bg-blue-500/15 border-y border-blue-500/30 text-[11px] uppercase tracking-wider text-blue-200 font-body font-semibold flex justify-between">
                <span>Labor</span>
                <span className="text-blue-300/60 normal-case tracking-normal">
                  {laborIdx.length} {laborIdx.length === 1 ? "row" : "rows"}
                </span>
              </div>
              {laborIdx.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">
                  No labor on this quote yet.
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                    <span className="col-span-1">Order</span>
                    <span className="col-span-5">Description</span>
                    <span className="col-span-2 text-right">Hours</span>
                    <span className="col-span-2 text-right">Rate / hr</span>
                    <span className="col-span-1 text-right">Total</span>
                    <span className="col-span-1"></span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {laborIdx.map((i) => {
                      const l = lines[i];
                      if (l.kind !== "labor") return null;
                      const { upTo, downTo } = targets(laborIdx, i);
                      return (
                        <div
                          key={i}
                          draggable
                          {...rowDropHandlers(i)}
                          className={`px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body bg-blue-500/5 transition-colors ${
                            draggingIndex === i ? "opacity-40" : ""
                          } ${
                            dragOverIndex === i && draggingIndex !== i
                              ? "ring-1 ring-amber-500/40"
                              : ""
                          }`}
                        >
                          <ReorderControls
                            fromIndex={i}
                            upTo={upTo}
                            downTo={downTo}
                            onMove={moveLine}
                          />
                          <input
                            value={l.description}
                            onChange={(e) => updateLine(i, { description: e.target.value })}
                            placeholder="Labor description (e.g. Install lightbar)"
                            className="col-span-5 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={l.hours}
                            onChange={(e) => updateLine(i, { hours: Number(e.target.value) })}
                            placeholder="Hours"
                            className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.rate}
                            onChange={(e) => updateLine(i, { rate: Number(e.target.value) })}
                            placeholder="Rate / hr"
                            className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                          />
                          <span className="col-span-1 text-right text-[11px] text-white font-semibold">
                            {fmt((l.hours || 0) * (l.rate || 0))}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="col-span-1 text-[11px] text-zinc-500 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* === Fees & Add-ons === */}
              <div className="px-4 py-2 mt-3 bg-amber-500/15 border-y border-amber-500/30 text-[11px] uppercase tracking-wider text-amber-200 font-body font-semibold flex justify-between">
                <span>Fees &amp; Add-ons</span>
                <span className="text-amber-300/60 normal-case tracking-normal">
                  {feeIdx.length} {feeIdx.length === 1 ? "row" : "rows"}
                </span>
              </div>
              {feeIdx.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">
                  No fees on this quote yet.
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
                    <span className="col-span-1">Order</span>
                    <span className="col-span-6">Description</span>
                    <span className="col-span-3 text-right">Amount</span>
                    <span className="col-span-1">Type</span>
                    <span className="col-span-1"></span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {feeIdx.map((i) => {
                      const l = lines[i];
                      if (l.kind !== "fee") return null;
                      const { upTo, downTo } = targets(feeIdx, i);
                      return (
                        <div
                          key={i}
                          draggable
                          {...rowDropHandlers(i)}
                          className={`px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body bg-amber-500/5 transition-colors ${
                            draggingIndex === i ? "opacity-40" : ""
                          } ${
                            dragOverIndex === i && draggingIndex !== i
                              ? "ring-1 ring-amber-500/40"
                              : ""
                          }`}
                        >
                          <ReorderControls
                            fromIndex={i}
                            upTo={upTo}
                            downTo={downTo}
                            onMove={moveLine}
                          />
                          <input
                            value={l.description}
                            onChange={(e) => updateLine(i, { description: e.target.value })}
                            placeholder="Fee description"
                            className="col-span-6 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.amount}
                            onChange={(e) => updateLine(i, { amount: Number(e.target.value) })}
                            placeholder="Amount"
                            className="col-span-3 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white text-right"
                          />
                          <span className="col-span-1 text-[10px] uppercase text-amber-400 tracking-wider">
                            {l.fixed ? "Fixed" : "Custom"}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="col-span-1 text-[11px] text-zinc-500 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body block mb-1">
            Notes (internal)
          </label>
          <textarea
            name="notes"
            defaultValue={notes}
            rows={6}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            placeholder="Internal notes for this quote"
          />
        </div>
        <div className="space-y-1.5 text-xs font-body">
          <Row label="Subtotal" value={fmt(totals.subtotal)} />
          <Row label="Discount" value={`− ${fmt(totals.discountTotal)}`} />
          <Row label="Labor" value={fmt(totals.laborTotal)} />
          <Row label="Fees" value={fmt(totals.feeTotal)} />
          <Row label={`Tax (${Number(taxRate) || 0}%)`} value={fmt(totals.tax)} />
          <div className="border-t border-white/10 pt-2 mt-2">
            <Row
              label="Grand total"
              value={fmt(totals.grand)}
              big
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2">
        <div className="flex gap-2">
          <a
            href={`/quotes/${id}/print`}
            target="_blank"
            className="text-xs font-body text-zinc-300 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors"
          >
            Print / Save as PDF
          </a>
        </div>
        <div className="flex gap-2">
          <a
            href="/quotes"
            className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors"
          >
            Back
          </a>
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Save quote
          </button>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={big ? "text-white font-semibold" : "text-zinc-400"}>
        {label}
      </span>
      <span className={big ? "text-white font-bold text-lg" : "text-white"}>
        {value}
      </span>
    </div>
  );
}

// Reorder controls for a single line: a draggable handle (the row's
// parent is `draggable`, this is just the visual grip) plus up / down
// arrow buttons for keyboard and mobile users where HTML5 DnD is
// awkward. Occupies col-span-1 of the row's 12-column grid.
//
// `upTo` / `downTo` are pre-resolved swap targets in the flat lines
// array (or null when this row is at the start/end of its section).
// The parent computes them so reorder is restricted to within a
// section — labor never swaps with parts and vice versa.
function ReorderControls({
  upTo,
  downTo,
  onMove,
  fromIndex,
}: {
  upTo: number | null;
  downTo: number | null;
  onMove: (from: number, to: number) => void;
  fromIndex: number;
}) {
  return (
    <div className="col-span-1 flex items-center gap-1">
      <span
        aria-hidden
        title="Drag to reorder within this section"
        className="text-zinc-500 select-none text-base leading-none"
        style={{ cursor: "grab" }}
      >
        ≡
      </span>
      <div className="flex flex-col">
        <button
          type="button"
          aria-label="Move up"
          disabled={upTo === null}
          onClick={() => upTo !== null && onMove(fromIndex, upTo)}
          className="text-[9px] text-zinc-500 hover:text-white disabled:opacity-30 leading-none px-0.5"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={downTo === null}
          onClick={() => downTo !== null && onMove(fromIndex, downTo)}
          className="text-[9px] text-zinc-500 hover:text-white disabled:opacity-30 leading-none px-0.5"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
