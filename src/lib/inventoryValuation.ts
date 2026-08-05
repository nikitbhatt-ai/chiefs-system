// Inventory valuation + reconciliation — Phase 4, made method-aware in Phase 2.
//
// Rule #6: the inventory subledger must always reconcile to the Inventory GL
// account (1200). There are now two valuations of the same stock:
//   • FIFO      = Σ part_receipts.quantity_remaining × layer unit_cost
//   • Weighted  = Σ parts.quantity_on_hand × parts.avg_cost
// The GL ties to whichever the active costing_policy names (weighted_average by
// default); the other is computed alongside as the comparison view. The two
// agree whenever a SKU fully turns over (both are zero at on-hand zero) — they
// differ only while stock is on the shelf, and the difference is timing, not a
// permanent gap.
//
// The one-click adjustment books any subledger↔ledger difference to equity —
// used once to seed the opening balance and thereafter to catch drift.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { parts, partReceipts, glAccounts, journalEntries, journalLines } from "@/db/schema";
import { postJournalEntry, LedgerError } from "@/lib/accounting";
import { getCostingMethod, type CostingMethod } from "@/lib/costing";

const INVENTORY_CODE = "1200";
const EQUITY_CODE = "3000"; // Owner's Equity — the offset for opening balance / adjustments

/** FIFO on-hand value across all parts (Σ remaining × layer cost), in integer cents. */
export async function inventorySubledgerFifoCents(): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
    })
    .from(partReceipts);
  return row?.cents ?? 0;
}

/** Weighted-average on-hand value (Σ on_hand × avg_cost), in integer cents. */
export async function inventorySubledgerAvgCents(): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${parts.quantityOnHand} * ROUND(COALESCE(${parts.avgCost}, ${parts.cost}, 0) * 100)), 0)`.mapWith(Number),
    })
    .from(parts);
  return row?.cents ?? 0;
}

/** Subledger value under the ACTIVE costing method, in integer cents. */
export async function inventorySubledgerCents(): Promise<number> {
  const method = await getCostingMethod();
  return method === "fifo" ? inventorySubledgerFifoCents() : inventorySubledgerAvgCents();
}

/** Posted balance of the Inventory GL account (debits − credits), in cents. */
export async function inventoryGlBalanceCents(): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(sql`${glAccounts.code} = ${INVENTORY_CODE} AND ${journalEntries.status} = 'posted'`);
  return row?.cents ?? 0;
}

/** Per-part on-hand valuation under both methods (only parts with stock or layers). */
export async function inventoryValuationByPart() {
  return db
    .select({
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      quantityOnHand: parts.quantityOnHand,
      avgCost: parts.avgCost,
      layerQty: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining}), 0)`.mapWith(Number),
      fifoValueCents: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
      avgValueCents: sql<number>`${parts.quantityOnHand} * ROUND(COALESCE(${parts.avgCost}, ${parts.cost}, 0) * 100)`.mapWith(Number),
    })
    .from(parts)
    .leftJoin(partReceipts, eq(partReceipts.partId, parts.id))
    .groupBy(parts.id)
    .having(sql`COALESCE(SUM(${partReceipts.quantityRemaining}), 0) > 0 OR ${parts.quantityOnHand} > 0`)
    .orderBy(parts.sku);
}

export type InventoryReconciliation = {
  method: CostingMethod;
  subledgerCents: number; // active method
  fifoCents: number;
  avgCents: number;
  glBalanceCents: number;
  differenceCents: number; // active subledger − ledger; >0 means ledger needs to catch up
  ties: boolean;
};

export async function inventoryReconciliation(): Promise<InventoryReconciliation> {
  const [method, fifoCents, avgCents, glBalanceCents] = await Promise.all([
    getCostingMethod(),
    inventorySubledgerFifoCents(),
    inventorySubledgerAvgCents(),
    inventoryGlBalanceCents(),
  ]);
  const subledgerCents = method === "fifo" ? fifoCents : avgCents;
  const differenceCents = subledgerCents - glBalanceCents;
  return { method, subledgerCents, fifoCents, avgCents, glBalanceCents, differenceCents, ties: differenceCents === 0 };
}

/**
 * Book the current subledger↔ledger difference to Owner's Equity so the
 * Inventory GL account matches the active-method valuation. Idempotent in
 * effect: once they tie the difference is zero and this no-ops. Offsets to
 * equity because the primary use is seeding the opening inventory balance.
 */
export async function postInventoryAdjustment(createdBy?: string | null) {
  const { differenceCents } = await inventoryReconciliation();
  if (differenceCents === 0) return { posted: false as const };

  const invId = await accountId(INVENTORY_CODE);
  const eqId = await accountId(EQUITY_CODE);
  const amount = Math.abs(differenceCents);

  // difference > 0: subledger exceeds ledger → Dr Inventory / Cr Equity.
  // difference < 0: ledger exceeds subledger → Dr Equity / Cr Inventory.
  const lines =
    differenceCents > 0
      ? [
          { accountId: invId, debitCents: amount, memo: "Inventory opening balance / adjustment" },
          { accountId: eqId, creditCents: amount, memo: "Owner's equity" },
        ]
      : [
          { accountId: eqId, debitCents: amount, memo: "Owner's equity" },
          { accountId: invId, creditCents: amount, memo: "Inventory opening balance / adjustment" },
        ];

  const entry = await postJournalEntry({
    memo: "Inventory reconciliation adjustment",
    source: "system",
    createdBy: createdBy ?? null,
    lines,
  });
  return { posted: true as const, entry };
}

async function accountId(code: string): Promise<string> {
  const [row] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row) throw new LedgerError(`Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`);
  return row.id;
}
