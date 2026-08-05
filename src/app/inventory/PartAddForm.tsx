"use client";

import { useState } from "react";
import { FormField } from "@/components/FormField";

export function PartAddForm({
  action,
  vendors,
}: {
  action: (formData: FormData) => Promise<void>;
  vendors: { id: string; name: string }[];
}) {
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");

  const c = Number(cost);
  const p = Number(price);
  const valid = c > 0 && p > 0;
  const margin = valid ? ((p - c) / p) * 100 : null;
  const markup = valid ? ((p - c) / c) * 100 : null;

  function setMargin(targetPct: number) {
    if (!c || c <= 0) return;
    const newPrice = c / (1 - targetPct / 100);
    setPrice(newPrice.toFixed(2));
  }
  function setMarkup(targetPct: number) {
    if (!c || c <= 0) return;
    const newPrice = c * (1 + targetPct / 100);
    setPrice(newPrice.toFixed(2));
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
        Add part
      </h3>
      <form action={action} className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FormField label="SKU" required>
          <input
            name="sku"
            required
            placeholder="SKU"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono"
          />
        </FormField>
        <FormField label="Name" required className="md:col-span-2">
          <input
            name="name"
            required
            placeholder="Name"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Mfg part #" hint="shown on work orders">
          <input
            name="mfgPartNumber"
            placeholder="Mfg part #"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono"
          />
        </FormField>
        <FormField label="Category">
          <input
            name="category"
            placeholder="Category"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Manufacturer">
          <select
            name="manufacturerId"
            defaultValue=""
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Manufacturer —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Supplier">
          <select
            name="vendorId"
            defaultValue=""
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Supplier —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </FormField>
        <p className="md:col-span-3 text-[11px] text-zinc-500 -mt-1">
          Need a new vendor?{" "}
          <a
            href="/vendors"
            target="_blank"
            className="text-amber-400 hover:text-amber-300"
          >
            Add one in /vendors
          </a>{" "}
          and it'll appear in these dropdowns.
        </p>
        <FormField label="Qty on hand">
          <input
            name="quantityOnHand"
            type="number"
            min="0"
            placeholder="0"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Qty on order">
          <input
            name="quantityOnOrder"
            type="number"
            min="0"
            placeholder="0"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Reorder point">
          <input
            name="reorderPoint"
            type="number"
            min="0"
            placeholder="0"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Average cost" hint="$ · opening value; auto-updated on receipt">
          <input
            name="cost"
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <FormField label="Sell price" hint="$">
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <div className="text-[11px] text-zinc-400 font-body flex items-center gap-2 self-end pb-2">
          <span>
            Margin:{" "}
            <span className="text-white font-semibold">
              {margin != null ? `${margin.toFixed(1)}%` : "—"}
            </span>
          </span>
          <span>·</span>
          <span>
            Markup:{" "}
            <span className="text-white font-semibold">
              {markup != null ? `${markup.toFixed(1)}%` : "—"}
            </span>
          </span>
        </div>
        <div className="md:col-span-3 flex flex-wrap gap-2 items-center text-[11px] font-body">
          <span className="text-zinc-500 uppercase tracking-wider text-[10px]">
            Quick set price by:
          </span>
          {[20, 30, 40, 50].map((m) => (
            <button
              type="button"
              key={`mg${m}`}
              onClick={() => setMargin(m)}
              className="text-amber-400 hover:text-amber-300 border border-white/10 rounded px-2 py-0.5"
              disabled={!c || c <= 0}
            >
              {m}% margin
            </button>
          ))}
          {[20, 30, 50, 100].map((m) => (
            <button
              type="button"
              key={`mk${m}`}
              onClick={() => setMarkup(m)}
              className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-0.5"
              disabled={!c || c <= 0}
            >
              {m}% markup
            </button>
          ))}
        </div>
        <FormField label="Description" className="md:col-span-3">
          <textarea
            name="description"
            placeholder="Description"
            rows={2}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </FormField>
        <div className="md:col-span-3 flex justify-end">
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Save part
          </button>
        </div>
      </form>
    </div>
  );
}
