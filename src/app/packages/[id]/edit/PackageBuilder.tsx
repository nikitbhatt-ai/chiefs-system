"use client";

import { useMemo, useState } from "react";
import { PartSearchCombobox, type PartHit } from "@/components/PartSearchCombobox";
import { PackageSearchCombobox, type PackageHit } from "@/components/PackageSearchCombobox";
import { SubmitButton } from "@/components/SubmitButton";
import { MoneyInput, QtyInput, HoursInput, PercentInput } from "@/components/MoneyInput";
import { fmtUSD, round2, discountAmount } from "@/lib/money";
import { packageTotals, expandPackageWithBundlePrice } from "@/lib/packages";
import type { PackageComponent } from "@/db/schema";

// Mirrors PackageComponent in src/db/schema.ts.
export type BuilderComponent = PackageComponent;

/** Row layout, shared by the header and the rows so the columns line up. */
const ITEM_COLS =
  "grid gap-2 items-center grid-cols-[minmax(90px,1.4fr)_minmax(140px,2.4fr)_64px_104px_104px_128px_112px_28px]";
const LABOR_COLS = "grid gap-2 items-center grid-cols-[minmax(200px,1fr)_88px_112px_128px_28px]";
const FEE_COLS = "grid gap-2 items-center grid-cols-[minmax(200px,1fr)_128px_92px_28px]";

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
  // Index of a row that was just created, so Enter can drop the cursor straight
  // into it and you can type a whole build without touching the mouse.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [pulledIn, setPulledIn] = useState<string | null>(null);

  const totals = useMemo(() => packageTotals(components, bundlePrice), [components, bundlePrice]);
  const cost = useMemo(() => {
    let c = 0;
    for (const x of components) if (x.kind === "item" && x.cost != null) c = round2(c + (x.quantity || 0) * x.cost);
    return c;
  }, [components]);

  // Apply pricing to every part line from its cost. Markup: sell = cost × (1+p).
  // Margin ("% off list"): sell = cost ÷ (1−p), e.g. cost $60 at 40% → $100.
  // Lines without a cost are left alone.
  function applyMarkup() {
    const m = Number(markup);
    if (!Number.isFinite(m) || m < 0) return;
    if (mode === "margin" && m >= 100) return; // 100% margin is undefined
    const factor = mode === "margin" ? 1 / (1 - m / 100) : 1 + m / 100;
    setComponents((prev) =>
      prev.map((c) => (c.kind === "item" && c.cost != null ? { ...c, unitPrice: round2((c.cost || 0) * factor) } : c)),
    );
  }

  function update(i: number, patch: Partial<BuilderComponent>) {
    setComponents((prev) => prev.map((c, idx) => (idx === i ? ({ ...c, ...patch } as BuilderComponent) : c)));
  }
  function remove(i: number) {
    setComponents((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** Blank part line, focused — what Enter opens. */
  function addBlankItem() {
    setComponents((prev) => {
      const next: BuilderComponent[] = [
        ...prev,
        { kind: "item", description: "", quantity: 1, unitPrice: 0, cost: null, partId: null, sku: null },
      ];
      setFocusRow(next.length - 1);
      return next;
    });
  }

  function addPart(part: PartHit) {
    setComponents((prev) => {
      // Same part already in the bundle → bump its qty instead of duplicating.
      const existing = prev.findIndex((c) => c.kind === "item" && c.partId === part.id);
      if (existing >= 0) {
        return prev.map((c, i) => (i === existing && c.kind === "item" ? { ...c, quantity: (c.quantity || 0) + 1 } : c));
      }
      return [...prev, itemFromPart(part)];
    });
  }

  /**
   * Pull an existing package (including one synced from a vendor promo) into
   * this one as ORDINARY editable lines.
   *
   * This is the "Whelen regional promo + 2 extra Ions is its own package" case.
   * Everything is copied, nothing is referenced: the source package is never
   * read again and never modified, so re-syncing the promo later cannot disturb
   * this build, and editing a line here cannot disturb the promo.
   *
   * The promo's *deal* is preserved as well as its costs. If the source carries
   * a bundle price, it is allocated across the copied lines as per-line
   * discounts, so the parts still total the promo price and the saving stays
   * visible on the quote — rather than silently reverting to list.
   */
  function addPackage(pkg: PackageHit) {
    const { lines } = expandPackageWithBundlePrice(pkg.components ?? [], pkg.packagePrice);
    const copied: BuilderComponent[] = [];
    for (const l of lines) {
      if (l.kind === "item") {
        // The bundle allocation arrives as `bundleDiscount`; it becomes this
        // line's own discount here, because from this package's point of view
        // the promo price is simply what these parts sell for. That leaves this
        // package's OWN bundle price free to discount further on top.
        const bundle = round2(l.bundleDiscount ?? 0);
        const own = discountAmount(round2((l.quantity || 0) * (l.unitPrice || 0)) - bundle, l.discount, l.discountKind);
        const total = round2(bundle + own);
        copied.push({
          kind: "item",
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          // Locked from the source: the promo cost, not today's average cost.
          cost: l.cost ?? null,
          discount: total > 0 ? total : null,
          discountKind: total > 0 ? "amt" : null,
          fromLabel: pkg.name,
          partId: l.partId ?? null,
          sku: null,
        });
      } else if (l.kind === "labor") {
        copied.push({ kind: "labor", description: `${l.description} (${pkg.name})`, hours: l.hours, rate: l.rate });
      } else {
        copied.push({ kind: "fee", description: `${l.description} (${pkg.name})`, amount: l.amount, fixed: l.fixed });
      }
    }
    if (copied.length === 0) return;
    setComponents((prev) => [...prev, ...copied]);
    setPulledIn(`Added ${copied.length} line${copied.length === 1 ? "" : "s"} from “${pkg.name}”. The original is untouched.`);
  }

  function addLabor() {
    setComponents((p) => {
      const next = [...p, { kind: "labor" as const, description: "Labor", hours: 0, rate: 0 }];
      setFocusRow(next.length - 1);
      return next;
    });
  }
  function addFee(fixed: boolean) {
    setComponents((p) => [
      ...p,
      { kind: "fee" as const, description: fixed ? "Fixed fee" : "Custom fee", amount: 0, fixed },
    ]);
  }

  const itemIdx = components.map((c, i) => (c.kind === "item" ? i : -1)).filter((i) => i >= 0);
  const laborIdx = components.map((c, i) => (c.kind === "labor" ? i : -1)).filter((i) => i >= 0);
  const feeIdx = components.map((c, i) => (c.kind === "fee" ? i : -1)).filter((i) => i >= 0);

  const hasBundle = bundlePrice.trim() !== "" && Number(bundlePrice) > 0;

  /* The add controls, rendered at BOTH ends of the contents box. Techs were
     scrolling back to the top of a long build to add the next part. */
  const AddControls = ({ where }: { where: "top" | "bottom" }) => (
    <div className="flex gap-2 items-center flex-wrap">
      <div className="w-[240px]">
        <PartSearchCombobox
          mode="adder"
          placeholder="+ Search inventory to add…"
          onPick={addPart}
        />
      </div>
      <div className="w-[220px]">
        <PackageSearchCombobox onPick={addPackage} placeholder="+ Add package / promo…" />
      </div>
      <button
        type="button"
        onClick={addBlankItem}
        className="text-[11px] font-body text-amber-400 hover:text-amber-300"
      >
        + Blank line
      </button>
      <button type="button" onClick={addLabor} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
        + Labor
      </button>
      <button type="button" onClick={() => addFee(false)} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
        + Custom fee
      </button>
      <button type="button" onClick={() => addFee(true)} className="text-[11px] font-body text-amber-400 hover:text-amber-300">
        + Fixed fee
      </button>
      {where === "bottom" && components.length > 6 ? (
        <button
          type="button"
          onClick={() => document.getElementById("pkg-contents-top")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="text-[11px] font-body text-zinc-500 hover:text-white ml-auto"
        >
          ↑ Back to top
        </button>
      ) : null}
    </div>
  );

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

      <div id="pkg-contents-top" className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Bundle contents</h3>
          <AddControls where="top" />
        </div>

        {pulledIn ? (
          <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] font-body text-emerald-300 flex items-center justify-between gap-2">
            <span>{pulledIn}</span>
            <button type="button" onClick={() => setPulledIn(null)} className="text-emerald-400/70 hover:text-emerald-200">
              ✕
            </button>
          </div>
        ) : null}

        {components.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500 font-body">
            Empty package. Add parts from inventory, pull in another package or promo, or add labor and fees above.
          </div>
        ) : (
          /* The list scrolls inside the card rather than growing the page, so the
             totals and the add controls below stay reachable on a long build. */
          <div className="max-h-[58vh] overflow-y-auto overflow-x-auto">
            {/* Parts */}
            <div className="px-4 py-2 bg-zinc-800/50 border-y border-white/10 text-[11px] uppercase tracking-wider text-zinc-300 font-body font-semibold flex justify-between sticky top-0 z-10">
              <span>Parts</span>
              <span className="text-zinc-500 normal-case tracking-normal">{itemIdx.length}</span>
            </div>
            {itemIdx.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500 font-body italic">No parts yet.</div>
            ) : (
              <>
                <div className={`px-4 py-2 ${ITEM_COLS} text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5 min-w-[860px]`}>
                  <span>Part #</span>
                  <span>Description</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Cost $</span>
                  <span className="text-right">Sell $</span>
                  <span className="text-right">Discount</span>
                  <span className="text-right">Line $</span>
                  <span />
                </div>
                <div className="divide-y divide-white/5">
                  {itemIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "item") return null;
                    const gross = round2((c.quantity || 0) * (c.unitPrice || 0));
                    const manual = discountAmount(gross, c.discount, c.discountKind ?? "pct");
                    const net = round2(gross - manual);
                    return (
                      <div key={i} className={`px-4 py-2.5 ${ITEM_COLS} text-xs font-body min-w-[860px]`}>
                        <input
                          value={c.sku ?? ""}
                          onChange={(e) => update(i, { sku: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addBlankItem();
                            }
                          }}
                          placeholder="Part #"
                          autoFocus={focusRow === i}
                          className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <div>
                          <PartSearchCombobox
                            mode="inline"
                            value={c.description}
                            onText={(s) => update(i, { description: s })}
                            onPick={(p) => update(i, itemFieldsFromPart(p))}
                          />
                          {c.fromLabel ? (
                            <span className="block mt-0.5 text-[10px] text-zinc-500 truncate" title={`Pulled in from ${c.fromLabel}`}>
                              from {c.fromLabel}
                            </span>
                          ) : null}
                        </div>
                        <QtyInput
                          value={c.quantity}
                          onChange={(v) => update(i, { quantity: v })}
                          onEnter={addBlankItem}
                          ariaLabel="Quantity"
                        />
                        <MoneyInput
                          value={c.cost ?? null}
                          allowEmpty
                          onChange={(v) => update(i, { cost: v })}
                          onEnter={addBlankItem}
                          ariaLabel="Internal cost per unit"
                          title="Internal cost per unit — the part's weighted-average cost, or the promo cost when pulled from a promo"
                        />
                        <MoneyInput
                          value={c.unitPrice}
                          onChange={(v) => update(i, { unitPrice: v ?? 0 })}
                          onEnter={addBlankItem}
                          ariaLabel="Sell price per unit"
                          title="Sell (retail) price per unit"
                        />
                        <div className="flex items-center gap-1">
                          {c.discountKind === "amt" ? (
                            <MoneyInput
                              className="flex-1"
                              value={c.discount ?? null}
                              allowEmpty
                              onChange={(v) => update(i, { discount: v })}
                              onEnter={addBlankItem}
                              ariaLabel="Line discount in dollars"
                            />
                          ) : (
                            <PercentInput
                              className="flex-1"
                              value={c.discount ?? ""}
                              onChange={(v) => update(i, { discount: v || null })}
                              onEnter={addBlankItem}
                              ariaLabel="Line discount percent"
                            />
                          )}
                          {/* Offers the OTHER unit, not the current one: next to
                              the box's own $ or % adornment, repeating it read
                              as "$ 512.27 $". */}
                          <button
                            type="button"
                            title={c.discountKind === "amt" ? "Switch to a percent discount" : "Switch to a dollar discount"}
                            onClick={() => update(i, { discountKind: c.discountKind === "amt" ? "pct" : "amt" })}
                            className="text-[10px] text-zinc-500 hover:text-amber-300 w-4 shrink-0"
                          >
                            {c.discountKind === "amt" ? "%" : "$"}
                          </button>
                        </div>
                        <span className="text-right text-white tabular-nums">
                          {fmtUSD(net)}
                          {manual > 0 ? (
                            <span className="block text-[10px] text-zinc-500 line-through">{fmtUSD(gross)}</span>
                          ) : null}
                        </span>
                        <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                          ✕
                        </button>
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
                <div className={`px-4 py-2 ${LABOR_COLS} text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5 min-w-[600px]`}>
                  <span>Description</span>
                  <span className="text-right">Hours</span>
                  <span className="text-right">Rate $/hr</span>
                  <span className="text-right">Total $</span>
                  <span />
                </div>
                <div className="divide-y divide-white/5">
                  {laborIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "labor") return null;
                    return (
                      <div key={i} className={`px-4 py-2.5 ${LABOR_COLS} text-xs font-body bg-blue-500/5 min-w-[600px]`}>
                        <input
                          value={c.description}
                          onChange={(e) => update(i, { description: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLabor();
                            }
                          }}
                          placeholder="Labor description (e.g. Install lightbar)"
                          autoFocus={focusRow === i}
                          className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <HoursInput value={c.hours} onChange={(v) => update(i, { hours: v })} onEnter={addLabor} ariaLabel="Hours" />
                        <MoneyInput value={c.rate} onChange={(v) => update(i, { rate: v ?? 0 })} onEnter={addLabor} ariaLabel="Rate per hour" />
                        <span className="text-right text-white font-semibold tabular-nums">
                          {fmtUSD(round2((c.hours || 0) * (c.rate || 0)))}
                        </span>
                        <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                          ✕
                        </button>
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
                <div className={`px-4 py-2 ${FEE_COLS} text-[10px] uppercase tracking-wider text-zinc-500 font-body bg-black/20 border-b border-white/5 min-w-[560px]`}>
                  <span>Description</span>
                  <span className="text-right">Amount $</span>
                  <span className="text-right">Type</span>
                  <span />
                </div>
                <div className="divide-y divide-white/5">
                  {feeIdx.map((i) => {
                    const c = components[i];
                    if (c.kind !== "fee") return null;
                    return (
                      <div key={i} className={`px-4 py-2.5 ${FEE_COLS} text-xs font-body bg-amber-500/5 min-w-[560px]`}>
                        <input
                          value={c.description}
                          onChange={(e) => update(i, { description: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addFee(c.fixed);
                            }
                          }}
                          placeholder="Fee description"
                          className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-white"
                        />
                        <MoneyInput
                          value={c.amount}
                          onChange={(v) => update(i, { amount: v ?? 0 })}
                          onEnter={() => addFee(c.fixed)}
                          ariaLabel="Fee amount"
                        />
                        <span className="text-right text-[10px] uppercase text-amber-400 tracking-wider">
                          {c.fixed ? "Fixed" : "Custom"}
                        </span>
                        <button type="button" onClick={() => remove(i)} className="text-[11px] text-zinc-500 hover:text-red-400">
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Same controls again at the bottom — the whole point of the request. */}
        <div className="px-4 py-2.5 border-t border-white/5">
          <AddControls where="bottom" />
        </div>
      </div>

      {(() => {
        // Profitability against what the customer actually pays: parts net of
        // the bundle price AND any per-line discounts.
        const marginD = round2(totals.partsNet - cost);
        const marginPct = totals.partsNet > 0 ? (marginD / totals.partsNet) * 100 : null;
        const markupPctCalc = cost > 0 ? (marginD / cost) * 100 : null;
        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-body">
            <div className="flex flex-wrap gap-4 text-zinc-400 items-center">
              <span>Cost (we pay) <span className="text-white tabular-nums">{fmtUSD(cost)}</span></span>
              <span>Retail (list) <span className="text-white tabular-nums">{fmtUSD(totals.partsGross)}</span></span>
              {totals.bundleDiscount > 0 ? (
                <span>Bundle price <span className="text-amber-300 tabular-nums">−{fmtUSD(totals.bundleDiscount)}</span></span>
              ) : null}
              {totals.lineDiscount > 0 ? (
                <span>Line discounts <span className="text-amber-300 tabular-nums">−{fmtUSD(totals.lineDiscount)}</span></span>
              ) : null}
              <span>
                Customer pays (parts){" "}
                <span className="text-white font-semibold tabular-nums">{fmtUSD(totals.partsNet)}</span>
              </span>
              <span>
                Margin{" "}
                <span className={marginD >= 0 ? "text-emerald-300 tabular-nums" : "text-red-400 tabular-nums"}>
                  {fmtUSD(marginD)}
                  {marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""}
                </span>
              </span>
              <span>
                Markup{" "}
                <span className={marginD >= 0 ? "text-emerald-300" : "text-red-400"}>
                  {markupPctCalc != null ? `${markupPctCalc.toFixed(1)}%` : "—"}
                </span>
              </span>
              {totals.labor || totals.fees ? (
                <span className="text-zinc-500 tabular-nums">
                  + Labor {fmtUSD(totals.labor)} · Fees {fmtUSD(totals.fees)} · Total {fmtUSD(totals.total)}
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <a href="/packages" className="text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors">
                Back
              </a>
              <SubmitButton className="font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">
                Save package
              </SubmitButton>
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
          <div className="w-24">
            <PercentInput value={markup} onChange={(v) => setMarkup(v ? String(v) : "")} ariaLabel="Markup or margin percent" placeholder="e.g. 40" />
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
        const tooHigh = valid && bp > totals.partsGross + 0.005;
        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-body font-semibold text-white uppercase tracking-wider">
                Bundle / promo price
              </label>
              <div className="w-40">
                <MoneyInput
                  value={bundlePrice}
                  allowEmpty
                  onChange={(v) => setBundlePrice(v == null ? "" : String(v))}
                  ariaLabel="Bundle or promo price"
                  placeholder=""
                />
              </div>
              <input type="hidden" name="packagePrice" value={bundlePrice} />
              {bundlePrice.trim() !== "" ? (
                <button type="button" onClick={() => setBundlePrice("")} className="text-[11px] text-zinc-500 hover:text-white">
                  Clear
                </button>
              ) : null}
              {hasBundle && !tooHigh ? (
                <span className="text-[11px] text-emerald-300">
                  Customer saves {fmtUSD(totals.bundleDiscount)} vs à la carte parts ({fmtUSD(totals.partsGross)}).
                  {totals.lineDiscount > 0
                    ? ` Line discounts take a further ${fmtUSD(totals.lineDiscount)} off on top.`
                    : ""}
                </span>
              ) : null}
              {tooHigh ? (
                <span className="text-[11px] text-red-400">
                  Bundle price is above the à la carte parts total ({fmtUSD(totals.partsGross)}); it can&apos;t allocate. Lower it or leave blank.
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-zinc-500">
              Optional. Leave blank to quote at à la carte line prices. When set, dropping this package on a quote
              allocates this total across the <em>part</em> lines so their totals sum to it (labor/fees quote
              separately). A per-line discount still applies <em>on top</em> of this price — neither overrides the other.
            </p>
          </div>
        );
      })()}
    </form>
  );
}

/** A fresh item line from a part hit. Prefers the authoritative average cost. */
function itemFromPart(part: PartHit): PackageComponent {
  return {
    kind: "item",
    description: `${part.sku} — ${part.name}`,
    quantity: 1,
    unitPrice: part.price ? Number(part.price) : 0,
    ...costFromPart(part),
    partId: part.id,
    sku: part.sku,
  };
}

function itemFieldsFromPart(p: PartHit) {
  return {
    description: `${p.sku} — ${p.name}`,
    unitPrice: p.price ? Number(p.price) : 0,
    ...costFromPart(p),
    partId: p.id,
    sku: p.sku,
  };
}

/**
 * Internal cost for a package line.
 *
 * `avgCost` is the weighted-average basis job costing actually uses; `cost` is a
 * 2dp mirror that only tracks it when the receive path updates it, so it goes
 * stale and can be overwritten by hand. Packages were reading the mirror, which
 * is why a line's internal cost could disagree with what the same part costs on
 * a work order. Prefer the average, fall back to the mirror.
 */
function costFromPart(p: PartHit): { cost: number | null } {
  const avg = p.avgCost == null || p.avgCost === "" ? null : Number(p.avgCost);
  if (avg != null && Number.isFinite(avg)) return { cost: round2(avg) };
  const c = p.cost == null || p.cost === "" ? null : Number(p.cost);
  return { cost: c != null && Number.isFinite(c) ? round2(c) : null };
}
