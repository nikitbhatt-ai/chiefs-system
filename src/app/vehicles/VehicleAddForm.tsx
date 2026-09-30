"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

const LOT_LABELS: Record<string, string> = {
  "on-site": "On-site",
  dealership: "Dealership",
  upfitting: "Upfitting",
  "sames-dropoff": "Sames drop-off",
};

export function VehicleAddForm({
  action,
  lots,
}: {
  action: (formData: FormData) => Promise<void>;
  lots: string[];
}) {
  const [vin, setVin] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  async function decode() {
    if (!vin.trim()) return;
    setDecoding(true);
    setDecodeError(null);
    try {
      const res = await fetch(`/api/vin/decode/${encodeURIComponent(vin.trim())}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setDecodeError(j.error ?? "Decode failed");
        return;
      }
      const data = await res.json();
      if (data.year) setYear(String(data.year));
      if (data.make) setMake(data.make);
      if (data.model) setModel(data.model);
      if (data.trim) setTrim(data.trim);
    } catch {
      setDecodeError("Network error");
    } finally {
      setDecoding(false);
    }
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
        Add vehicle
      </h3>
      <form action={action} className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-3 flex gap-2 items-start">
          <input
            name="vin"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="VIN (17 chars)"
            className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono"
          />
          <button
            type="button"
            onClick={decode}
            disabled={decoding || !vin.trim()}
            className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white border border-white/10 rounded-md px-4 py-2 transition-colors whitespace-nowrap"
          >
            {decoding ? "Decoding…" : "Decode VIN"}
          </button>
        </div>
        {decodeError ? (
          <p className="md:col-span-3 text-[11px] text-red-400 -mt-2">{decodeError}</p>
        ) : null}

        <input
          name="year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Year"
          type="number"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="make"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          placeholder="Make"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="trim"
          value={trim}
          onChange={(e) => setTrim(e.target.value)}
          placeholder="Trim"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="color"
          placeholder="Color"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="mileage"
          placeholder="Mileage"
          type="number"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="listPrice"
          placeholder="List price (USD)"
          type="number"
          step="0.01"
          min="0"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <select
          name="condition"
          defaultValue=""
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">Condition (none)</option>
          <option value="Used - Excellent">Used - Excellent</option>
          <option value="Used - Good">Used - Good</option>
          <option value="Used - Fair">Used - Fair</option>
          <option value="New">New</option>
        </select>
        <select
          name="lotLocation"
          defaultValue=""
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">Lot (none)</option>
          {lots.map((l) => (
            <option key={l} value={l}>
              {LOT_LABELS[l] ?? l}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue="new"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
        >
          <option value="new">New</option>
          <option value="received">Received</option>
          <option value="ready_for_pickup">Ready for pickup</option>
          <option value="delivered">Delivered</option>
          <option value="sold">Sold</option>
        </select>
        <textarea
          name="notes"
          placeholder="Notes"
          rows={2}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3"
        />
        <div className="md:col-span-3 flex justify-end">
          <SubmitButton
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Save vehicle
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
