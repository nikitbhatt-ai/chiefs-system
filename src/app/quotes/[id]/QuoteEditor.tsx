"use client";

import { useMemo, useState } from "react";

type PartOption = {
  id: string;
  sku: string;
  name: string;
  price: string | null;
  cost: string | null;
  restricted: boolean;
  restrictionCategory: string | null;
};

function PartAutocomplete({
  value,
  parts,
  onPick,
  onText,
}: {
  value: string;
  parts: PartOption[];
  onPick: (p: PartOption) => void;
  onText: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return parts
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [value, parts]);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
          setFocusIdx(0);
        }}
        onFocus={() => value && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusIdx((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const m = matches[focusIdx];
            if (m) {
              onPick(m);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Description (type SKU or name to search inventory)"
        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
      />
      {open && matches.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 bg-[#161624] border border-white/10 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {matches.map((m, i) => (
            <li
              key={m.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
                setOpen(false);
              }}
              onMouseEnter={() => setFocusIdx(i)}
              className={`px-3 py-2 text-xs font-body cursor-pointer ${
                i === focusIdx ? "bg-white/10" : ""
              }`}
            >
              <div className="text-white">
                <span className="font-mono text-amber-400">{m.sku}</span>{" "}
                {m.name}
                {m.restricted ? (
                  <span className="ml-2 inline-block text-[9px] uppercase tracking-wider rounded border border-red-500/40 bg-red-500/10 text-red-300 px-1.5 py-0.5">
                    Restricted{m.restrictionCategory ? ` · ${m.restrictionCategory.replace(/_/g, " ")}` : ""}
                  </span>
                ) : null}
              </div>
              <div className="text-[10px] text-zinc-500">
                {m.price
                  ? `$${Number(m.price).toFixed(2)}`
                  : "(no price set)"}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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
  parts,
  action,
}: {
  id: string;
  customerId: string | null;
  status: "draft" | "sent" | "approved" | "converted";
  notes: string;
  initialLines: QuoteLine[];
  customers: { id: string; name: string }[];
  parts: PartOption[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [taxRate, setTaxRate] = useState("0");

  const totals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let feeTotal = 0;
    for (const l of lines) {
      if (l.kind === "item") {
        const gross = (l.quantity || 0) * (l.unitPrice || 0);
        const disc =
          l.discountKind === "pct"
            ? gross * ((l.discount || 0) / 100)
            : l.discount || 0;
        subtotal += gross;
        discountTotal += disc;
      } else {
        feeTotal += l.amount || 0;
      }
    }
    const taxBase = subtotal - discountTotal + feeTotal;
    const tax = taxBase * ((Number(taxRate) || 0) / 100);
    const grand = taxBase + tax;
    return { subtotal, discountTotal, feeTotal, tax, grand };
  }, [lines, taxRate]);

  function updateLine(i: number, patch: Partial<QuoteLine>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? ({ ...l, ...patch } as QuoteLine) : l)),
    );
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
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
  function addPart(partId: string) {
    if (!partId) return;
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    setLines((p) => [
      ...p,
      {
        kind: "item",
        description: `${part.sku} — ${part.name}`,
        quantity: 1,
        unitPrice: part.price ? Number(part.price) : 0,
        discount: 0,
        discountKind: "pct",
        partId: part.id,
      },
    ]);
  }
  function addFee(fixed = false) {
    setLines((p) => [
      ...p,
      { kind: "fee", description: fixed ? "Fixed fee" : "Custom fee", amount: 0, fixed },
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
          defaultValue={status}
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
          <div className="flex gap-2 items-center">
            <select
              defaultValue=""
              onChange={(e) => {
                addPart(e.target.value);
                e.target.value = "";
              }}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white max-w-[200px]"
            >
              <option value="">+ Add from inventory…</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
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
          </div>
        </div>
        <div className="divide-y divide-white/5">
          <div className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5">
            <span className="col-span-4">Description</span>
            <span className="col-span-1 text-right">Qty</span>
            <span className="col-span-2 text-right">Unit price</span>
            <span className="col-span-2 text-right">Discount</span>
            <span className="col-span-2">Discount type</span>
            <span className="col-span-1"></span>
          </div>
          {lines.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">
              No line items yet. Add items or fees above.
            </div>
          ) : (
            lines.map((l, i) =>
              l.kind === "item" ? (
                <div
                  key={i}
                  className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body"
                >
                  <div className="col-span-4">
                    <PartAutocomplete
                      value={l.description}
                      parts={parts}
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
                    step="0.01"
                    value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
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
              ) : (
                <div
                  key={i}
                  className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs font-body bg-amber-500/5"
                >
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Fee description"
                    className="col-span-7 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
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
              ),
            )
          )}
        </div>
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
