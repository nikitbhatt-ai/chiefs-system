import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { arInvoices, customers, receipts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { IssueInvoiceForm } from "@/components/accounting/IssueInvoiceForm";
import { fmtCents, dollarsToCents } from "@/lib/accounting";
import { invoiceableQuotes } from "@/lib/ar";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-400 bg-amber-500/10",
  paid: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5 line-through",
};

export default async function InvoicesPage() {
  const now = new Date();
  const [rows, quotesForForm] = await Promise.all([
    db
      .select({
        id: arInvoices.id,
        invoiceNumber: arInvoices.invoiceNumber,
        customerName: customers.name,
        invoiceDate: arInvoices.invoiceDate,
        dueDate: arInvoices.dueDate,
        totalCents: arInvoices.totalCents,
        status: arInvoices.status,
        paidCents: sql<number>`COALESCE(SUM(${receipts.amountCents}), 0)`.mapWith(Number),
      })
      .from(arInvoices)
      .leftJoin(customers, eq(customers.id, arInvoices.customerId))
      .leftJoin(receipts, eq(receipts.invoiceId, arInvoices.id))
      .groupBy(arInvoices.id, customers.name)
      .orderBy(desc(arInvoices.invoiceDate))
      .limit(200),
    invoiceableQuotes(),
  ]);

  const quoteOptions = quotesForForm.map((q) => ({
    id: q.id,
    label: `${q.quoteNumber ?? "Quote"} · ${q.customerName ?? "—"} · ${fmtCents(dollarsToCents(q.grandTotal))}`,
  }));

  const totalOutstanding = rows
    .filter((r) => r.status === "open")
    .reduce((s, r) => s + (r.totalCents - r.paidCents), 0);

  return (
    <AppShell title="Invoices" subtitle="Bill a quote — posts to Accounts Receivable automatically">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/receipts" className="text-xs text-amber-400 hover:text-amber-300 font-body">Receipts →</Link>
      </div>

      <IssueInvoiceForm quotes={quoteOptions} />

      <div className="text-xs font-body text-zinc-400">
        Outstanding AR: <span className="text-white font-semibold">{fmtCents(totalOutstanding)}</span> across{" "}
        {rows.filter((r) => r.status === "open").length} open invoice(s).
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Invoice</th>
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-4 py-2.5">Invoiced</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No invoices yet — issue one from a quote above.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const balance = r.totalCents - r.paidCents;
                const overdue = r.status === "open" && balance > 0 && r.dueDate < now;
                return (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <Link href={`/accounting/invoices/${r.id}`} className="font-mono text-xs text-white hover:text-amber-300">
                        {r.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{r.customerName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDate(r.invoiceDate)}</td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${overdue ? "text-red-400 font-semibold" : "text-zinc-400"}`}>
                      {fmtDate(r.dueDate)}{overdue ? " · overdue" : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(r.totalCents)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(balance)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
