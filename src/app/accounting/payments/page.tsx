import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bills, payments, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PaymentForm } from "@/components/accounting/PaymentForm";
import { fmtCents } from "@/lib/accounting";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const [vendorRows, openBillRows, rows] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(asc(vendors.name)),
    db
      .select({
        id: bills.id,
        billNumber: bills.billNumber,
        vendorId: bills.vendorId,
        totalCents: bills.totalCents,
        paidCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`.mapWith(Number),
      })
      .from(bills)
      .leftJoin(payments, eq(payments.billId, bills.id))
      .where(eq(bills.status, "open"))
      .groupBy(bills.id),
    db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        vendorName: vendors.name,
        billNumber: bills.billNumber,
        billId: bills.id,
        paymentDate: payments.paymentDate,
        method: payments.method,
        reference: payments.reference,
        amountCents: payments.amountCents,
      })
      .from(payments)
      .leftJoin(vendors, eq(vendors.id, payments.vendorId))
      .leftJoin(bills, eq(bills.id, payments.billId))
      .orderBy(desc(payments.paymentDate))
      .limit(200),
  ]);

  const openBills = openBillRows
    .map((b) => ({ id: b.id, vendorId: b.vendorId, balance: b.totalCents - b.paidCents, label: `${b.billNumber} · ${fmtCents(b.totalCents - b.paidCents)} due` }))
    .filter((b) => b.balance > 0);

  return (
    <AppShell title="Payments" subtitle="Cash paid to vendors — posts Dr Accounts Payable / Cr Cash">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/bills" className="text-xs text-amber-400 hover:text-amber-300 font-body">Bills →</Link>
      </div>

      <PaymentForm vendors={vendorRows} openBills={openBills.map(({ id, vendorId, label }) => ({ id, vendorId, label }))} />

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Payment</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Applied to</th>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Method</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No payments yet — record one above.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-white">{r.paymentNumber}</td>
                  <td className="px-4 py-2.5 text-xs">{r.vendorName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.billId ? (
                      <Link href={`/accounting/bills/${r.billId}`} className="text-amber-400 hover:text-amber-300 font-mono">{r.billNumber}</Link>
                    ) : (
                      <span className="text-zinc-500">on account</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDate(r.paymentDate)}</td>
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
