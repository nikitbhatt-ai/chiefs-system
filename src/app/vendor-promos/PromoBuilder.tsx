"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allocatePromo, PromoAllocationError } from "@/lib/promoAllocation";

type Vendor = { id: string; name: string };
type Line = { sku: string; quantity: number; alacarte: number | null; state: "idle" | "loading" | "missing" | "ok" };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PromoBuilder({ vendors }: { vendors: Vendor[] }) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [name, setName] = useState("");
  const [packagePrice, setPackagePrice] = useState("");
  const [freight, setFreight] = useState("");
  const [lines, setLines] = useState<Line[]>([{ sku: "", quantity: 1, alacarte: null, state: "idle" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function resolveCost(i: number, sku: string) {
    const s = sku.trim();
    if (!s || !vendorId) return;
    setLine(i, { state: "loading" });
    try {
      const res = await fetch(`/api/vendor-part-prices?vendorId=${encodeURIComponent(vendorId)}&sku=${encodeURIComponent(s)}&current=1`);
      const rows = (await res.json()) as { alacarteUnitCost: string }[];
      if (Array.isArray(rows) && rows.length) {
        setLine(i, { alacarte: Number(rows[0].alacarteUnitCost), state: "ok" });
      } else {
        setLine(i, { alacarte: null, state: "missing" });
      }
    } catch {
      setLine(i, { alacarte: null, state: "missing" });
    }
  }

  // Live allocation preview from lines that have a resolved à la carte cost.
  const preview = useMemo(() => {
    const priced = lines.filter((l) => l.sku.trim() && l.quantity > 0 && l.alacarte != null);
    const price = Number(packagePrice);
    if (!priced.length || !(price > 0)) return { result: null as ReturnType<typeof allocatePromo> | null, err: null as string | null };
    try {
      const result = allocatePromo({
        packagePrice: price,
        freight: freight === "" ? null : Number(freight),
        lines: priced.map((l) => ({ sku: l.sku.trim(), quantity: l.quantity, alacarteCostSnap: l.alacarte as number })),
      });
      return { result, err: null };
    } catch (e) {
      return { result: null, err: e instanceof PromoAllocationError ? e.message : (e as Error).message };
    }
  }, [lines, packagePrice, freight]);

  async function submit() {
    setError(null);
    setOk(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendor-promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          name,
          packagePrice: Number(packagePrice),
          freight: freight === "" ? null : Number(freight),
          lines: lines.filter((l) => l.sku.trim() && l.quantity > 0).map((l) => ({ sku: l.sku.trim(), quantity: l.quantity })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not save the promo.");
      } else {
        setOk(`Saved "${name}".`);
        setName("");
        setPackagePrice("");
        setFreight("");
        setLines([{ sku: "", quantity: 1, alacarte: null, state: "idle" }]);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const label = "block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1";
  const input = "w-full bg-black/20 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white font-body focus:border-amber-500/50 outline-none";

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-body font-semibold text-white uppercase tracking-wider">Define a promo package</h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-1">
          <label className={label}>Vendor</label>
          <select className={input} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={label}>Promo name</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Inner Edge Regional Promo" />
        </div>
        <div>
          <label className={label}>Package price ($)</label>
          <input className={input} inputMode="decimal" value={packagePrice} onChange={(e) => setPackagePrice(e.target.value)} placeholder="6840.00" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>Freight ($, optional)</label>
          <input className={input} inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0.00" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Lines — cost auto-fills from the vendor price list</div>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={`${input} flex-1`}
              value={l.sku}
              onChange={(e) => setLine(i, { sku: e.target.value, state: "idle", alacarte: null })}
              onBlur={(e) => resolveCost(i, e.target.value)}
              placeholder="SKU (e.g. XI3JC)"
            />
            <input
              className={`${input} w-20`}
              type="number"
              min={1}
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
            />
            <div className="w-32 text-right text-xs font-body">
              {l.state === "loading" ? (
                <span className="text-zinc-500">…</span>
              ) : l.alacarte != null ? (
                <span className="text-zinc-300">{money(l.alacarte)}</span>
              ) : l.state === "missing" ? (
                <span className="text-red-400">no price</span>
              ) : (
                <span className="text-zinc-600">à la carte</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
              className="text-zinc-500 hover:text-red-400 text-xs px-1.5"
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { sku: "", quantity: 1, alacarte: null, state: "idle" }])}
          className="text-xs font-body text-amber-400 hover:text-amber-300"
        >
          + Add line
        </button>
      </div>

      {/* Live preview */}
      {preview.err ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 font-body">{preview.err}</div>
      ) : preview.result ? (
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <table className="w-full text-xs font-body">
            <thead className="bg-white/5 text-zinc-500">
              <tr className="text-left">
                <th className="px-3 py-1.5">SKU</th>
                <th className="px-3 py-1.5 text-right">Qty</th>
                <th className="px-3 py-1.5 text-right">À la carte</th>
                <th className="px-3 py-1.5 text-right">Allocated unit</th>
                <th className="px-3 py-1.5 text-right">Allocated ext.</th>
              </tr>
            </thead>
            <tbody className="text-zinc-200">
              {preview.result.lines.map((l) => (
                <tr key={l.sku} className="border-t border-white/5">
                  <td className="px-3 py-1.5 font-mono">{l.sku}</td>
                  <td className="px-3 py-1.5 text-right">{l.quantity}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-400">{money(l.alacarteCostSnap)}</td>
                  <td className="px-3 py-1.5 text-right text-white">{money(l.allocatedUnitCost)}</td>
                  <td className="px-3 py-1.5 text-right">{money(l.allocatedExtended)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-white/10 text-zinc-300">
              <tr>
                <td className="px-3 py-1.5" colSpan={2}>À la carte total</td>
                <td className="px-3 py-1.5 text-right" colSpan={3}>{money(preview.result.totalBasis)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1.5" colSpan={2}>Package price {freight !== "" ? "(incl. freight)" : ""}</td>
                <td className="px-3 py-1.5 text-right" colSpan={3}>{money(preview.result.effectivePackagePrice)}</td>
              </tr>
              <tr className="text-emerald-300 font-semibold">
                <td className="px-3 py-1.5" colSpan={2}>Saving vs à la carte</td>
                <td className="px-3 py-1.5 text-right" colSpan={3}>{money(preview.result.saving)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="text-xs text-zinc-500 font-body">Enter a package price and at least one priced line to preview the allocation.</div>
      )}

      {error ? <div className="text-xs text-red-400 font-body">{error}</div> : null}
      {ok ? <div className="text-xs text-emerald-400 font-body">{ok}</div> : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !preview.result}
        className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-md px-4 py-2 transition-colors"
      >
        {submitting ? "Saving…" : "Save promo"}
      </button>
    </div>
  );
}
