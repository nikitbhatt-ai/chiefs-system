import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { accountLedger } from "@/lib/reports";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

function parseRange(sp: Record<string, string | string[] | undefined>) {
  const today = new Date();
  const y = today.getFullYear();
  const from = typeof sp.from === "string" && sp.from ? new Date(`${sp.from}T00:00:00`) : new Date(`${y}-01-01T00:00:00`);
  const to = typeof sp.to === "string" && sp.to ? new Date(`${sp.to}T23:59:59`) : today;
  return { from, to };
}

export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const { from, to } = parseRange(await searchParams);
  const result = await accountLedger(code, from, to);
  if (!result) notFound();
  const { account, lines, totalDebit, totalCredit } = result;

  return (
    <AppShell title={`${account.code} · ${account.name}`} subtitle={`Ledger detail · ${fmtDate(from)} – ${fmtDate(to)}`}>
      <Link href="/accounting/reports/pnl" className="text-xs text-amber-400 hover:text-amber-300 font-body">← P&amp;L</Link>

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Entry</th>
              <th className="px-4 py-2.5 text-right">Debit</th>
              <th className="px-4 py-2.5 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {lines.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-zinc-500">No posted activity in this range.</td></tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2 text-xs text-zinc-400 whitespace-nowrap">
                    <Link href={`/accounting/journal/${l.entryId}`} className="hover:text-amber-300">{fmtDate(l.entryDate)}</Link>
                  </td>
                  <td className="px-4 py-2 text-xs">{l.lineMemo || l.memo || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{l.debitCents ? fmtCents(l.debitCents) : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{l.creditCents ? fmtCents(l.creditCents) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-body font-semibold text-white">
              <td className="px-4 py-2 text-xs" colSpan={2}>Totals · net {fmtCents(totalDebit - totalCredit)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(totalDebit)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AppShell>
  );
}
