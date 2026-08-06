// Scratch verification for the COGS-by-part-category split. Not part of the app.
// Seeds a job with parts in several categories, settles it, and checks that the
// journal lines land on the right accounts and add up to the WIP balance exactly.
//
// Run against a THROWAWAY database:
//   POSTGRES_URL=... npx tsx scripts/verify-cogs-split.ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  glAccounts,
  inventoryIssue,
  journalEntries,
  journalLines,
  parts,
  workOrders,
  customers,
} from "../src/db/schema";
import { postJournalEntry } from "../src/lib/accounting";
import { settleJobToCogs, reopenJob, jobCostRollup } from "../src/lib/jobCosting";
import { setCategoryAccount, apportion, cogsSplitForWorkOrder } from "../src/lib/cogsCategories";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function accountIdFor(code: string) {
  const [a] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code));
  if (!a) throw new Error(`missing account ${code}`);
  return a.id;
}

async function main() {
  // ── pure-function checks first ────────────────────────────────────────────
  console.log("\napportion() — the split must always add up");
  for (const total of [100_00, 99_99, 1, 3, 1_000_001]) {
    const buckets = [
      { key: "a", weightCents: 1 },
      { key: "b", weightCents: 1 },
      { key: "c", weightCents: 1 },
    ];
    const out = apportion(buckets, total);
    const sum = out.reduce((s, o) => s + o.cents, 0);
    check(`three equal weights, total ${total}`, sum === total, `sum=${sum}`);
  }
  {
    const out = apportion([{ key: "a", weightCents: 7 }, { key: "b", weightCents: 3 }], 10_00);
    check("70/30 of $10.00", out[0].cents === 700 && out[1].cents === 300, JSON.stringify(out));
  }
  {
    const out = apportion([{ key: "a", weightCents: 1 }, { key: "b", weightCents: 0 }], 500);
    check("zero-weight bucket dropped", out.length === 1 && out[0].cents === 500, JSON.stringify(out));
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  const [cust] = await db.insert(customers).values({ name: "Verify PD" }).returning();
  const [wo] = await db
    .insert(workOrders)
    .values({ customerId: cust.id, woNumber: `WO-COGS-${Date.now()}`, status: "in_progress" })
    .returning();

  const seeded = [
    { sku: `S-LIGHT-${Date.now()}`, name: "Lightbar", category: "Emergency Lights", qty: 2, unit: "600.00" },
    { sku: `S-WIRE-${Date.now()}`, name: "14ga wire", category: "Wire & Cable", qty: 10, unit: "12.50" },
    { sku: `S-SIREN-${Date.now()}`, name: "Siren", category: "Sirens", qty: 1, unit: "275.00" },
    { sku: `S-MISC-${Date.now()}`, name: "Widget", category: "Miscellaneous Bits", qty: 4, unit: "9.25" },
    { sku: `S-NOCAT-${Date.now()}`, name: "Unfiled", category: null, qty: 1, unit: "50.00" },
  ];
  const partRows = await db
    .insert(parts)
    .values(seeded.map((s) => ({ sku: s.sku, name: s.name, category: s.category })))
    .returning();

  let issuedCents = 0;
  for (let i = 0; i < seeded.length; i++) {
    const s = seeded[i];
    await db.insert(inventoryIssue).values({
      partId: partRows[i].id,
      workOrderId: wo.id,
      qty: s.qty,
      unitCost: s.unit,
    });
    issuedCents += s.qty * Math.round(Number(s.unit) * 100);
  }

  // Charge WIP at a total that deliberately does NOT equal the FIFO issue total —
  // weighted-average costing does this in real life, and the split must still
  // relieve WIP to the cent.
  const wipCents = issuedCents + 137;
  await postJournalEntry({
    memo: "seed: parts issued to build",
    source: "system",
    lines: [
      { accountId: await accountIdFor("1300"), debitCents: wipCents, workOrderId: wo.id },
      { accountId: await accountIdFor("1200"), creditCents: wipCents, workOrderId: wo.id },
    ],
  });

  // Map two categories; leave "Sirens", "Miscellaneous Bits" and NULL unmapped.
  await setCategoryAccount("emergency lights", await accountIdFor("5120")); // case-insensitive on purpose
  await setCategoryAccount("Wire & Cable", await accountIdFor("5110"));

  console.log("\nsetCategoryAccount() guards");
  await setCategoryAccount("Sirens", await accountIdFor("5300")).then(
    () => check("mapping to direct labor (5300) is rejected", false, "it was accepted"),
    (e: Error) => check("mapping to direct labor (5300) is rejected", true, e.message.slice(0, 48)),
  );
  await setCategoryAccount("Sirens", await accountIdFor("5900")).then(
    () => check("mapping to variance (5900) is rejected", false, "it was accepted"),
    () => check("mapping to variance (5900) is rejected", true),
  );

  // ── preview ───────────────────────────────────────────────────────────────
  console.log("\ncogsSplitForWorkOrder() preview");
  const preview = await cogsSplitForWorkOrder(db, wo.id, wipCents);
  for (const p of preview) console.log(`        ${p.code} ${p.name.padEnd(32)} ${(p.cents / 100).toFixed(2)}  [${p.categories.join(", ")}]`);
  check("preview sums to the WIP balance", preview.reduce((s, p) => s + p.cents, 0) === wipCents);
  check("mapped: lights on 5120", preview.some((p) => p.code === "5120"));
  check("mapped: wire on 5110", preview.some((p) => p.code === "5110"));
  check("unmapped categories collect on 5100", preview.some((p) => p.code === "5100"));

  // ── settle ────────────────────────────────────────────────────────────────
  console.log("\nsettleJobToCogs()");
  const entry = await settleJobToCogs(wo.id);
  const posted = await db
    .select({
      code: glAccounts.code,
      name: glAccounts.name,
      debit: journalLines.debitCents,
      credit: journalLines.creditCents,
      workOrderId: journalLines.workOrderId,
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .where(eq(journalLines.journalEntryId, entry.id))
    .orderBy(glAccounts.code);
  for (const l of posted) console.log(`        ${l.code} ${l.name.padEnd(32)} Dr ${(l.debit / 100).toFixed(2).padStart(10)}  Cr ${(l.credit / 100).toFixed(2).padStart(10)}`);

  const totalDr = posted.reduce((s, l) => s + l.debit, 0);
  const totalCr = posted.reduce((s, l) => s + l.credit, 0);
  check("entry balances", totalDr === totalCr, `Dr ${totalDr} Cr ${totalCr}`);
  check("credits WIP for the full balance", posted.some((l) => l.code === "1300" && l.credit === wipCents));
  check("more than one COGS account debited", posted.filter((l) => l.debit > 0).length > 1, `${posted.filter((l) => l.debit > 0).length} debit lines`);
  check("every line tagged to the work order", posted.every((l) => l.workOrderId === wo.id));

  const wipAfter = await db
    .select({ cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}),0)`.mapWith(Number) })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalLines.workOrderId, wo.id), eq(journalEntries.status, "posted"), eq(glAccounts.code, "1300")));
  check("WIP for the job is zero afterwards", wipAfter[0].cents === 0, `${wipAfter[0].cents}`);

  // The rollup must still see the material — it reads every cogs_parts account now.
  const rollup = await jobCostRollup(wo.id);
  check("rollup still sees the material after a split settle", rollup?.materialsCents === wipCents, `${rollup?.materialsCents} vs ${wipCents}`);
  check("rollup shows the job settled", rollup?.settled === true);
  check("rollup shows nothing left in WIP", rollup?.wipBalanceCents === 0, `${rollup?.wipBalanceCents}`);

  // ── double-settle and reopen ──────────────────────────────────────────────
  console.log("\nidempotency & reversal");
  await settleJobToCogs(wo.id).then(
    () => check("a second settle is refused", false, "it posted again"),
    () => check("a second settle is refused", true),
  );
  await reopenJob(wo.id);
  const afterReopen = await jobCostRollup(wo.id);
  check("reopen puts the cost back in WIP", afterReopen?.wipBalanceCents === wipCents, `${afterReopen?.wipBalanceCents}`);
  check("reopen leaves settled COGS at zero", afterReopen?.materialsCents === wipCents, `materials=${afterReopen?.materialsCents}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
