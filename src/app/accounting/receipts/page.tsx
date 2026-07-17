import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { arInvoices, customers, receipts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { ReceiptForm } from "@/components/accounting/ReceiptForm";
import { fmtCents } from "@/lib/accounting";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const [customerRows, openInvoiceRows, rows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.archived, false))
      .orderBy(asc(customers.name)),
    // Open invoices with a remaining balance, for the "apply to invoice" picker.
    db
      .select({
        id: arInvoices.id,
        invoiceNumber: arInvoices.invoiceNumber,
        customerId: arInvoices.customerId,
        totalCents: arInvoices.totalCents,
        paidCents: sql<number>`COALESCE(SUM(${receipts.amountCents}), 0)`.mapWith(Number),
      })
      .from(arInvoices)
      .leftJoin(receipts, eq(receipts.invoiceId, arInvoices.id))
      .where(eq(arInvoices.status, "open"))
      .groupBy(arInvoices.id),
    db
      .select({
        id: receipts.id,
        receiptNumber: receipts.receiptNumber,
        customerName: customers.name,
        invoiceNumber: arInvoices.invoiceNumber,
        invoiceId: arInvoices.id,
        receiptDate: receipts.receiptDate,
        method: receipts.method,
        reference: receipts.reference,
        amountCents: receipts.amountCents,
      })
      .from(receipts)
      .leftJoin(customers, eq(customers.id, receipts.customerId))
      .leftJoin(arInvoices, eq(arInvoices.id, receipts.invoiceId))
      .orderBy(desc(receipts.receiptDate))
      .limit(200),
  ]);

  const openInvoices = openInvoiceRows
    .map((i) => ({
      id: i.id,
      customerId: i.customerId,
      balance: i.totalCents - i.paidCents,
      label: `${i.invoiceNumber} · ${fmtCents(i.totalCents - i.paidCents)} due`,
    }))
    .filter((i) => i.balance > 0);

  return (
    <AppShell title="Receipts" subtitle="Record cash received — posts Dr Cash / Cr Accounts Receivable">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/invoices" className="text-xs text-amber-400 hover:text-amber-300 font-body">Invoices →</Link>
      </div>

      <ReceiptForm
        customers={customerRows}
        openInvoices={openInvoices.map(({ id, customerId, label }) => ({ id, customerId, label }))}
      />

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Receipt</th>
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-4 py-2.5">Applied to</th>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Method</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No receipts yet — record one above.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-white">{r.receiptNumber}</td>
                  <td className="px-4 py-2.5 text-xs">{r.customerName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.invoiceId ? (
                      <Link href={`/accounting/invoices/${r.invoiceId}`} className="text-amber-400 hover:text-amber-300 font-mono">
                        {r.invoiceNumber}
                      </Link>
                    ) : (
                      <span className="text-zinc-500">on account</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDate(r.receiptDate)}</td>
                  <td className="px-4 py-2.5 text-xs capitalize">{r.method}{r.reference ? ` · ${r.reference}` : ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(r.amountCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
