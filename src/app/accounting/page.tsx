import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts, journalEntries, journalLines, arInvoices, receipts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";

export const dynamic = "force-dynamic";

export default async function AccountingHomePage() {
  const [[acct], [entryCounts], [bal], [ar], [receiptAgg]] = await Promise.all([
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
  ]);

  const ties = bal.debit === bal.credit;

  const cards = [
    { href: "/accounting/accounts", title: "Chart of Accounts", desc: "View and add ledger accounts", stat: `${acct.n} accounts` },
    { href: "/accounting/journal", title: "Journal", desc: "Create and review journal entries", stat: `${entryCounts.posted} posted · ${entryCounts.draft} draft` },
    { href: "/accounting/invoices", title: "Invoices (AR)", desc: "Bill quotes; posts to Accounts Receivable", stat: `${ar.openCount} open · ${fmtCents(ar.openTotal)} billed` },
    { href: "/accounting/receipts", title: "Receipts", desc: "Record cash received against AR", stat: `${receiptAgg.n} recorded` },
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
        Phases 1–2 live: the core ledger plus Accounts Receivable (invoice a quote, record receipts).
        AP, inventory costing, job costing, P&amp;L reporting, the AR/AP agents, tax tracking, and
        QuickBooks sync come in later phases.
      </p>
    </AppShell>
  );
}
