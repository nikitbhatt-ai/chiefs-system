// Inventory valuation + reconciliation — Phase 4.
//
// Rule #6: the inventory subledger must always reconcile to the Inventory
// ledger account. The subledger here is the FIFO layer table (part_receipts):
// on-hand value = Σ quantity_remaining × unit_cost. The ledger side is the
// posted balance of GL account 1200 (Inventory). This module computes both and
// offers a one-click adjustment that books the difference to equity so the two
// tie — used once to seed the opening balance (inventory that existed before
// accounting went live) and thereafter to catch any drift.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { parts, partReceipts, glAccounts, journalEntries, journalLines } from "@/db/schema";
import { postJournalEntry, LedgerError } from "@/lib/accounting";

const INVENTORY_CODE = "1200";
const EQUITY_CODE = "3000"; // Owner's Equity — the offset for opening balance / adjustments

/** FIFO on-hand value across all parts, in integer cents. */
export async function inventorySubledgerCents(): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
    })
    .from(partReceipts);
  return row?.cents ?? 0;
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

/** Per-part on-hand valuation (only parts with remaining FIFO layers). */
export async function inventoryValuationByPart() {
  return db
    .select({
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      quantityOnHand: parts.quantityOnHand,
      layerQty: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining}), 0)`.mapWith(Number),
      valueCents: sql<number>`COALESCE(SUM(${partReceipts.quantityRemaining} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(Number),
    })
    .from(parts)
    .leftJoin(partReceipts, eq(partReceipts.partId, parts.id))
    .groupBy(parts.id)
    .having(sql`COALESCE(SUM(${partReceipts.quantityRemaining}), 0) > 0`)
    .orderBy(parts.sku);
}

export type InventoryReconciliation = {
  subledgerCents: number;
  glBalanceCents: number;
  differenceCents: number; // subledger − ledger; >0 means ledger needs to catch up
  ties: boolean;
};

export async function inventoryReconciliation(): Promise<InventoryReconciliation> {
  const [subledgerCents, glBalanceCents] = await Promise.all([
    inventorySubledgerCents(),
    inventoryGlBalanceCents(),
  ]);
  const differenceCents = subledgerCents - glBalanceCents;
  return { subledgerCents, glBalanceCents, differenceCents, ties: differenceCents === 0 };
}

/**
 * Book the current subledger↔ledger difference to Owner's Equity so the
 * Inventory GL account matches the FIFO valuation. Idempotent in effect: once
 * they tie the difference is zero and this no-ops. Offsets to equity because the
 * primary use is seeding the opening inventory balance.
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
