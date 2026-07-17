import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts, journalEntries, journalLines, arInvoices, receipts, bills, payments } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { inventoryReconciliation } from "@/lib/inventoryValuation";
import { listJobCosts } from "@/lib/jobCosting";

export const dynamic = "force-dynamic";

export default async function AccountingHomePage() {
  const [[acct], [entryCounts], [bal], [ar], [receiptAgg], [ap], [paymentAgg]] = await Promise.all([
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(glAccounts),
    db
      .select({
        posted: sql<number>`count(*) filter (where ${journalEntries.status} = 'posted')`.mapWith(Number),
        draft: sql<number>`count(*) filter (where ${journalEntries.status} = 'draft')`.mapWith(Number),
      })
      .from(journalEntries),
    // Trial balance across all POSTED lines — must net to zero if the books tie.
    db
      .select({
        debit: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
        credit: sql<number>`COALESCE(SUM(${journalLines.creditCents}), 0)`.mapWith(Number),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(eq(journalEntries.status, "posted")),
    db
      .select({
        openCount: sql<number>`count(*) filter (where ${arInvoices.status} = 'open')`.mapWith(Number),
        openTotal: sql<number>`COALESCE(SUM(${arInvoices.totalCents}) filter (where ${arInvoices.status} = 'open'), 0)`.mapWith(Number),
      })
      .from(arInvoices),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(receipts),
    db
      .select({
        openCount: sql<number>`count(*) filter (where ${bills.status} = 'open')`.mapWith(Number),
        openTotal: sql<number>`COALESCE(SUM(${bills.totalCents}) filter (where ${bills.status} = 'open'), 0)`.mapWith(Number),
      })
      .from(bills),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(payments),
  ]);

  const [recon, jobs] = await Promise.all([inventoryReconciliation(), listJobCosts()]);
  const openWip = jobs.reduce((s, j) => s + j.wipBalanceCents, 0);
  const ties = bal.debit === bal.credit;

  const cards = [
    { href: "/accounting/accounts", title: "Chart of Accounts", desc: "View and add ledger accounts", stat: `${acct.n} accounts` },
    { href: "/accounting/journal", title: "Journal", desc: "Create and review journal entries", stat: `${entryCounts.posted} posted · ${entryCounts.draft} draft` },
    { href: "/accounting/invoices", title: "Invoices (AR)", desc: "Bill quotes; posts to Accounts Receivable", stat: `${ar.openCount} open · ${fmtCents(ar.openTotal)} billed` },
    { href: "/accounting/receipts", title: "Receipts", desc: "Record cash received against AR", stat: `${receiptAgg.n} recorded` },
    { href: "/accounting/bills", title: "Bills (AP)", desc: "Vendor bills; posts to Accounts Payable", stat: `${ap.openCount} open · ${fmtCents(ap.openTotal)} owed` },
    { href: "/accounting/payments", title: "Payments", desc: "Record cash paid against AP", stat: `${paymentAgg.n} recorded` },
    { href: "/accounting/inventory", title: "Inventory", desc: "FIFO subledger reconciled to the ledger", stat: recon.ties ? `${fmtCents(recon.subledgerCents)} · reconciled` : `off by ${fmtCents(Math.abs(recon.differenceCents))}` },
    { href: "/accounting/job-costing", title: "Job costing", desc: "Materials + labor per work order", stat: `${jobs.length} jobs · ${fmtCents(openWip)} in WIP` },
    { href: "/accounting/reports", title: "Reports", desc: "P&L, balance sheet, AR/AP aging", stat: "Financial statements" },
    { href: "/accounting/agents", title: "AR / AP agents", desc: "Claude drafts reminders & payment plans", stat: "Draft · you approve" },
  ];

  return (
    <AppShell title="Accounting" subtitle="Double-entry ledger — runs alongside QuickBooks, not a replacement">
      <div
        className={`rounded-lg border px-4 py-3 font-body text-sm ${
          ties ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"
        }`}
      >
        {ties ? (
          <>
            <span className="font-semibold">Books are in balance.</span>{" "}
            Posted debits {fmtCents(bal.debit)} = credits {fmtCents(bal.credit)}.
          </>
        ) : (
          <>
            <span className="font-semibold">Ledger out of balance!</span>{" "}
            Posted debits {fmtCents(bal.debit)} ≠ credits {fmtCents(bal.credit)}. This should never happen — investigate.
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block bg-[#161624] border border-white/5 rounded-lg p-5 hover:border-amber-500/40 transition-colors"
          >
            <div className="text-white font-display font-semibold">{c.title}</div>
            <div className="text-xs text-zinc-500 font-body mt-1">{c.desc}</div>
            <div className="text-[11px] text-amber-400 font-body mt-3">{c.stat}</div>
          </Link>
        ))}
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Phases 1–7 live: the core ledger, Accounts Receivable, Accounts Payable, Inventory cost
        accounting, Job costing, Financial reports, and the AR/AP agents (Claude drafts reminders and
        payment plans for you to approve). Tax tracking and QuickBooks sync come in later phases.
      </p>
    </AppShell>
  );
}
