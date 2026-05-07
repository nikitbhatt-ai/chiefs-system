"use client";

import { useState } from "react";

type Initial = {
  sku: string;
  name: string;
  description: string;
  category: string;
  quantityOnHand: number;
  quantityOnOrder: number;
  reorderPoint: number | null;
  cost: string;
  price: string;
  vendorId: string;
  manufacturerId: string;
};

export function PartEditForm({
  action,
  vendors,
  initial,
}: {
  action: (formData: FormData) => Promise<void>;
  vendors: { id: string; name: string }[];
  initial: Initial;
}) {
  const [cost, setCost] = useState(String(initial.cost ?? ""));
  const [price, setPrice] = useState(String(initial.price ?? ""));

  const c = Number(cost);
  const p = Number(price);
  const valid = c > 0 && p > 0;
  const margin = valid ? ((p - c) / p) * 100 : null;
  const markup = valid ? ((p - c) / c) * 100 : null;
  const setMargin = (t: number) => c > 0 && setPrice((c / (1 - t / 100)).toFixed(2));
  const setMarkup = (t: number) => c > 0 && setPrice((c * (1 + t / 100)).toFixed(2));

  return (
    <form
      action={action}
      className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3 max-w-5xl"
    >
      <input
        name="sku"
        required
        defaultValue={initial.sku}
        placeholder="SKU *"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white font-mono"
      />
      <input
        name="name"
        required
        defaultValue={initial.name}
        placeholder="Name *"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
      />
      <input
        name="category"
        defaultValue={initial.category}
        placeholder="Category"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <select
        name="manufacturerId"
        defaultValue={initial.manufacturerId}
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      >
        <option value="">— Manufacturer —</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <select
        name="vendorId"
        defaultValue={initial.vendorId}
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      >
        <option value="">— Supplier —</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <input
        name="quantityOnHand"
        type="number"
        min="0"
        defaultValue={initial.quantityOnHand}
        placeholder="On hand"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <input
        name="quantityOnOrder"
        type="number"
        min="0"
        defaultValue={initial.quantityOnOrder}
        placeholder="On order"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <input
        name="reorderPoint"
        type="number"
        min="0"
        defaultValue={initial.reorderPoint ?? ""}
        placeholder="Reorder point"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <input
        name="cost"
        type="number"
        min="0"
        step="0.01"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder="Internal cost"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <input
        name="price"
        type="number"
        min="0"
        step="0.01"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Price"
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      />
      <div className="text-[11px] text-zinc-400 font-body flex items-center gap-2">
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
            className="text-amber-400 hover:text-amber-300 border border-white/10 rounded px-2 py-0.5 disabled:opacity-40"
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
            className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-0.5 disabled:opacity-40"
            disabled={!c || c <= 0}
          >
            {m}% markup
          </button>
        ))}
      </div>
      <textarea
        name="description"
        defaultValue={initial.description}
        placeholder="Description"
        rows={3}
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-3"
      />
      <div className="md:col-span-3 flex justify-end gap-2">
        <a
          href="/inventory"
          className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}
