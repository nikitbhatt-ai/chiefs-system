// Promo vs backfill savings report — Phase 7.
//
// The number that says whether the package discount is real. Built from the
// LAYER table's source_kind + per-layer unit_cost — NOT from job costing: under
// weighted average the promo saving is smeared into the average and is
// invisible in work-order cost by construction (§0.8). The layer table keeps the
// package-vs-full-price distinction regardless of the active costing method.
//
// Per SKU over a period:
//   • package units + allocated cost, and their à la carte basis (from the
//     promo line) → the discount captured.
//   • individual + backfill units + actual cost paid.
//   • units consumed (from inventory_issue).
// Headline: total saved by packages, minus the extra spent backfilling at full
// price. If backfill spend is eating the package saving, the promo isn't saving
// money — it's just deferring full-price buying.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { partReceipts, parts, inventoryIssue, vendorPromoLine } from "@/db/schema";

export type PromoSavingsRow = {
  partId: string;
  sku: string | null;
  name: string | null;
  packageUnits: number;
  packageCostCents: number; // allocated cost paid on package layers
  packageAlacarteCents: number; // à la carte basis for those same units
  packageSavingCents: number; // alacarte − allocated
  individualUnits: number;
  individualCostCents: number;
  backfillUnits: number;
  backfillCostCents: number;
  consumedUnits: number;
  // Extra paid to backfill vs the package unit cost for this SKU (0 if no
  // package baseline). backfillUnits × max(0, backfillAvgUnit − packageAvgUnit).
  backfillPremiumCents: number;
  netSavingCents: number; // packageSaving − backfillPremium
  // backfillUnits / packageUnits — high share flags a promo to reconsider.
  backfillShare: number | null;
  reconsider: boolean;
};

export type PromoSavingsReport = {
  from: Date;
  to: Date;
  rows: PromoSavingsRow[];
  totals: {
    packageUnits: number;
    packageCostCents: number;
    packageAlacarteCents: number;
    packageSavingCents: number;
    individualUnits: number;
    individualCostCents: number;
    backfillUnits: number;
    backfillCostCents: number;
    backfillPremiumCents: number;
    consumedUnits: number;
    netSavingCents: number;
  };
};

// Share of backfill-to-package volume above which a SKU is flagged.
const RECONSIDER_THRESHOLD = 0.5;

export async function promoSavingsReport(range: { from: Date; to: Date }): Promise<PromoSavingsReport> {
  const inPeriod = and(gte(partReceipts.receivedAt, range.from), lt(partReceipts.receivedAt, range.to));

  // Package layers, with à la carte basis joined from the promo line.
  //
  // The basis is looked up via a correlated subquery, NOT a join: one promo can
  // legitimately carry the same SKU on more than one line (a sheet listing
  // XI3JC as 4 roof + 2 grille), and joining would multiply every receipt row
  // by the number of matching promo lines, inflating units and cost. MAX() over
  // the matching lines picks the single à la carte cost for that SKU (all lines
  // for a SKU share it — the importer warns if a sheet disagrees with itself).
  const alacarteSnapCents = sql<number>`ROUND(COALESCE((
    SELECT MAX(${vendorPromoLine.alacarteCostSnap})
    FROM ${vendorPromoLine}
    WHERE ${vendorPromoLine.promoId} = ${partReceipts.promoId}
      AND ${vendorPromoLine.sku} = ${parts.sku}
  ), ${partReceipts.unitCost}) * 100)`;

  const pkgRows = await db
    .select({
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      units: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived}), 0)`.mapWith(Number),
      costCents: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
      alacarteCents: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived} * ${alacarteSnapCents}), 0)`.mapWith(Number),
    })
    .from(partReceipts)
    .innerJoin(parts, eq(parts.id, partReceipts.partId))
    .where(and(inPeriod, eq(partReceipts.sourceKind, "package")))
    .groupBy(parts.id);

  const bySourceRows = await db
    .select({
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      sourceKind: partReceipts.sourceKind,
      units: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived}), 0)`.mapWith(Number),
      costCents: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
    })
    .from(partReceipts)
    .innerJoin(parts, eq(parts.id, partReceipts.partId))
    .where(and(inPeriod, sql`${partReceipts.sourceKind} IN ('individual','backfill')`))
    .groupBy(parts.id, partReceipts.sourceKind);

  const consumedRows = await db
    .select({
      partId: parts.id,
      units: sql<number>`COALESCE(SUM(${inventoryIssue.qty}), 0)`.mapWith(Number),
    })
    .from(inventoryIssue)
    .innerJoin(parts, eq(parts.id, inventoryIssue.partId))
    .where(and(gte(inventoryIssue.issuedAt, range.from), lt(inventoryIssue.issuedAt, range.to)))
    .groupBy(parts.id);

  // Merge into per-part rows.
  const map = new Map<string, PromoSavingsRow>();
  const ensure = (partId: string, sku: string | null, name: string | null): PromoSavingsRow => {
    let r = map.get(partId);
    if (!r) {
      r = {
        partId,
        sku,
        name,
        packageUnits: 0,
        packageCostCents: 0,
        packageAlacarteCents: 0,
        packageSavingCents: 0,
        individualUnits: 0,
        individualCostCents: 0,
        backfillUnits: 0,
        backfillCostCents: 0,
        consumedUnits: 0,
        backfillPremiumCents: 0,
        netSavingCents: 0,
        backfillShare: null,
        reconsider: false,
      };
      map.set(partId, r);
    }
    return r;
  };

  for (const p of pkgRows) {
    const r = ensure(p.partId, p.sku, p.name);
    r.packageUnits = p.units;
    r.packageCostCents = p.costCents;
    r.packageAlacarteCents = p.alacarteCents;
    r.packageSavingCents = p.alacarteCents - p.costCents;
  }
  for (const s of bySourceRows) {
    const r = ensure(s.partId, s.sku, s.name);
    if (s.sourceKind === "individual") {
      r.individualUnits = s.units;
      r.individualCostCents = s.costCents;
    } else if (s.sourceKind === "backfill") {
      r.backfillUnits = s.units;
      r.backfillCostCents = s.costCents;
    }
  }
  for (const c of consumedRows) {
    const r = map.get(c.partId);
    if (r) r.consumedUnits = c.units;
    // A part consumed but with no package/backfill/individual receipt in-period
    // isn't relevant to the savings question, so we don't create a row for it.
  }

  // Derived: backfill premium vs the package unit cost, net saving, flags.
  for (const r of map.values()) {
    const pkgAvgUnitCents = r.packageUnits > 0 ? r.packageCostCents / r.packageUnits : 0;
    const backfillAvgUnitCents = r.backfillUnits > 0 ? r.backfillCostCents / r.backfillUnits : 0;
    r.backfillPremiumCents =
      r.packageUnits > 0 && r.backfillUnits > 0
        ? Math.round(Math.max(0, backfillAvgUnitCents - pkgAvgUnitCents) * r.backfillUnits)
        : 0;
    r.netSavingCents = r.packageSavingCents - r.backfillPremiumCents;
    r.backfillShare = r.packageUnits > 0 ? r.backfillUnits / r.packageUnits : null;
    r.reconsider = r.backfillShare != null && r.backfillShare >= RECONSIDER_THRESHOLD;
  }

  const rows = Array.from(map.values()).sort((a, b) => b.packageUnits - a.packageUnits || (a.sku ?? "").localeCompare(b.sku ?? ""));

  const totals = rows.reduce(
    (t, r) => ({
      packageUnits: t.packageUnits + r.packageUnits,
      packageCostCents: t.packageCostCents + r.packageCostCents,
      packageAlacarteCents: t.packageAlacarteCents + r.packageAlacarteCents,
      packageSavingCents: t.packageSavingCents + r.packageSavingCents,
      individualUnits: t.individualUnits + r.individualUnits,
      individualCostCents: t.individualCostCents + r.individualCostCents,
      backfillUnits: t.backfillUnits + r.backfillUnits,
      backfillCostCents: t.backfillCostCents + r.backfillCostCents,
      backfillPremiumCents: t.backfillPremiumCents + r.backfillPremiumCents,
      consumedUnits: t.consumedUnits + r.consumedUnits,
      netSavingCents: t.netSavingCents + r.netSavingCents,
    }),
    {
      packageUnits: 0,
      packageCostCents: 0,
      packageAlacarteCents: 0,
      packageSavingCents: 0,
      individualUnits: 0,
      individualCostCents: 0,
      backfillUnits: 0,
      backfillCostCents: 0,
      backfillPremiumCents: 0,
      consumedUnits: 0,
      netSavingCents: 0,
    },
  );

  return { from: range.from, to: range.to, rows, totals };
}
