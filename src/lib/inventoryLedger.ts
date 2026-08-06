// Accounting hooks for inventory movements — Phase 4.
//
// These post journal entries as a side effect of the existing, already-
// transactional inventory operations in src/lib/inventory.ts. They run INSIDE
// that operation's transaction (passed the same `tx`), so stock and ledger move
// atomically.
//
// Design rules:
//   - Non-fatal: if the chart of accounts hasn't been seeded (Phase 1 SQL not
//     run), every required account resolves to null and we SKIP posting rather
//     than throw — core inventory must keep working with or without accounting.
//   - Never post a one-sided entry: we resolve ALL accounts up front and bail as
//     a unit if any is missing.
//   - Cost basis is real: receiving values at PO unit cost; issuing/restoring
//     value at the exact FIFO layer cost drained/refilled. That keeps the
//     Inventory GL account reconciled to the FIFO subledger (rule #6).
//
// GL codes (seeded by accounting_phase1.sql):
//   1200 Inventory · 1300 Work in Progress · 2050 Accrued Purchases (GRNI)
//
// Postings:
//   Receive parts:  Dr Inventory / Cr Accrued Purchases   (NOT Accounts Payable —
//                   the vendor bill credits AP when it relieves this accrual)
//   Issue to build: Dr Work in Progress / Cr Inventory   (tagged work_order_id)
//   Restore build:  Dr Inventory / Cr Work in Progress   (reverses an issue)

import { db } from "@/db";
import { resolveAccountId, postJournalEntryTx } from "@/lib/accounting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CODES = { inventory: "1200", wip: "1300", accrued: "2050" } as const;

/**
 * Dr Inventory / Cr Accrued Purchases for goods received. No-op if <= 0 or the
 * chart of accounts isn't seeded.
 *
 * Credits the ACCRUAL (2050), not Accounts Payable. Receiving goods and being
 * billed for them are two events against one liability; this used to credit
 * 2000 and so did the vendor bill, which meant a $10,000 PO received and billed
 * showed $20,000 owed and booked the cost twice — once as an Inventory asset,
 * once as an expense. The bill now relieves 2050 and credits 2000 instead (see
 * `createBill` in src/lib/ap.ts), so over the full cycle 2050 returns to zero.
 */
export async function postInventoryReceipt(
  tx: Tx,
  opts: { totalCents: number; poNumber?: string | null; createdBy?: string | null },
) {
  const totalCents = Math.round(opts.totalCents);
  if (totalCents <= 0) return;
  const inventoryId = await resolveAccountId(tx, CODES.inventory);
  const accruedId = await resolveAccountId(tx, CODES.accrued);
  if (!inventoryId || !accruedId) return; // accounting not set up — skip silently

  await postJournalEntryTx(tx, {
    memo: `Inventory received${opts.poNumber ? ` (PO ${opts.poNumber})` : ""}`,
    source: "system",
    createdBy: opts.createdBy ?? null,
    lines: [
      { accountId: inventoryId, debitCents: totalCents, memo: "Inventory" },
      { accountId: accruedId, creditCents: totalCents, memo: "Accrued purchases (not yet invoiced)" },
    ],
  });
}

/** Dr Work in Progress / Cr Inventory for parts issued to a build. */
export async function postInventoryIssue(
  tx: Tx,
  opts: { totalCents: number; workOrderId?: string | null; woNumber?: string | null; createdBy?: string | null },
) {
  const totalCents = Math.round(opts.totalCents);
  if (totalCents <= 0) return;
  const inventoryId = await resolveAccountId(tx, CODES.inventory);
  const wipId = await resolveAccountId(tx, CODES.wip);
  if (!inventoryId || !wipId) return;

  await postJournalEntryTx(tx, {
    memo: `Parts issued to build${opts.woNumber ? ` (WO ${opts.woNumber})` : ""}`,
    source: "system",
    createdBy: opts.createdBy ?? null,
    lines: [
      { accountId: wipId, debitCents: totalCents, workOrderId: opts.workOrderId ?? null, memo: "Work in progress" },
      { accountId: inventoryId, creditCents: totalCents, workOrderId: opts.workOrderId ?? null, memo: "Inventory" },
    ],
  });
}

/** Dr Inventory / Cr Work in Progress — reverses an issue when a build is walked back. */
export async function postInventoryRestore(
  tx: Tx,
  opts: { totalCents: number; workOrderId?: string | null; woNumber?: string | null; createdBy?: string | null },
) {
  const totalCents = Math.round(opts.totalCents);
  if (totalCents <= 0) return;
  const inventoryId = await resolveAccountId(tx, CODES.inventory);
  const wipId = await resolveAccountId(tx, CODES.wip);
  if (!inventoryId || !wipId) return;

  await postJournalEntryTx(tx, {
    memo: `Parts returned from build${opts.woNumber ? ` (WO ${opts.woNumber})` : ""}`,
    source: "system",
    createdBy: opts.createdBy ?? null,
    lines: [
      { accountId: inventoryId, debitCents: totalCents, workOrderId: opts.workOrderId ?? null, memo: "Inventory" },
      { accountId: wipId, creditCents: totalCents, workOrderId: opts.workOrderId ?? null, memo: "Work in progress" },
    ],
  });
}
