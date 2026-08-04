import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts, departments, journalEntries, journalLines } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm";
import { fmtCents } from "@/lib/accounting";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  draft: "text-zinc-400 bg-white/5",
  posted: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5 line-through",
};

export default async function JournalPage() {
  const [accountRows, deptRows, entries] = await Promise.all([
    db.select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name }).from(glAccounts).where(eq(glAccounts.isActive, true)).orderBy(asc(glAccounts.code)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
    db
      .select({
        id: journalEntries.id,
        entryDate: journalEntries.entryDate,
        memo: journalEntries.memo,
        source: journalEntries.source,
        status: journalEntries.status,
        totalCents: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .groupBy(journalEntries.id)
      .orderBy(desc(journalEntries.entryDate))
      .limit(100),
  ]);

  const needsSeed = accountRows.length === 0;

  return (
    <AppShell title="Journal" subtitle="Every transaction is a balanced entry — debits equal credits">
      {needsSeed ? (
        <p className="text-xs text-amber-400 font-body bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
          No accounts found. Run <code>docs/sql/accounting_phase1.sql</code> in Neon first to create the tables and seed the chart of accounts.
        </p>
      ) : (
        <JournalEntryForm accounts={accountRows} departments={deptRows} />
      )}

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Memo</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No journal entries yet — create your first one above.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    <Link href={`/accounting/journal/${e.id}`} className="hover:text-amber-300">
                      {fmtDateTime(e.entryDate)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/accounting/journal/${e.id}`} className="text-white hover:text-amber-300">
                      {e.memo || <span className="text-zinc-500">(no memo)</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize text-zinc-400">{e.source}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[e.status]}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(e.totalCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
