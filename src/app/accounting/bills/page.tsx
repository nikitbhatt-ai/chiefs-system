import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bills, payments, glAccounts, departments, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { BillForm } from "@/components/accounting/BillForm";
import { fmtCents } from "@/lib/accounting";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-400 bg-amber-500/10",
  paid: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5 line-through",
};

export default async function BillsPage() {
  const now = new Date();
  const [vendorRows, accountRows, deptRows, rows] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(asc(vendors.name)),
    db.select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name }).from(glAccounts).where(eq(glAccounts.isActive, true)).orderBy(asc(glAccounts.code)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
    db
      .select({
        id: bills.id,
        billNumber: bills.billNumber,
        vendorName: vendors.name,
        billDate: bills.billDate,
        dueDate: bills.dueDate,
        totalCents: bills.totalCents,
        status: bills.status,
        paidCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`.mapWith(Number),
      })
      .from(bills)
      .leftJoin(vendors, eq(vendors.id, bills.vendorId))
      .leftJoin(payments, eq(payments.billId, bills.id))
      .groupBy(bills.id, vendors.name)
      .orderBy(desc(bills.billDate))
      .limit(200),
  ]);

  const totalOutstanding = rows
    .filter((r) => r.status === "open")
    .reduce((s, r) => s + (r.totalCents - r.paidCents), 0);

  return (
    <AppShell title="Bills" subtitle="What we owe vendors — posts to Accounts Payable automatically">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/payments" className="text-xs text-amber-400 hover:text-amber-300 font-body">Payments →</Link>
      </div>

      <BillForm vendors={vendorRows} accounts={accountRows} departments={deptRows} />

      <div className="text-xs font-body text-zinc-400">
        Outstanding AP: <span className="text-white font-semibold">{fmtCents(totalOutstanding)}</span> across{" "}
        {rows.filter((r) => r.status === "open").length} open bill(s).
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Bill</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Billed</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">No bills yet — enter one above.</td>
              </tr>
            ) : (
              rows.map((r) => {
                const balance = r.totalCents - r.paidCents;
                const overdue = r.status === "open" && balance > 0 && r.dueDate < now;
                return (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <Link href={`/accounting/bills/${r.id}`} className="font-mono text-xs text-white hover:text-amber-300">{r.billNumber}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{r.vendorName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDate(r.billDate)}</td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${overdue ? "text-red-400 font-semibold" : "text-zinc-400"}`}>
                      {fmtDate(r.dueDate)}{overdue ? " · overdue" : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(r.totalCents)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(balance)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
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
