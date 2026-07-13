import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDocumentNumber } from "@/lib/documentNumber";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  partial: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  paid: "bg-green-500/10 text-green-300 border-green-500/30",
  overdue: "bg-red-500/10 text-red-300 border-red-500/30",
  void: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
};

function money(v: string | null | undefined): string {
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function InvoicesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));

  const customerIds = Array.from(new Set(rows.map((r) => r.customerId).filter(Boolean) as string[]));
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerName = new Map(customerRows.map((c) => [c.id, c.name]));

  const totalOutstanding = rows
    .filter((r) => r.status !== "paid" && r.status !== "void")
    .reduce((s, r) => s + (Number(r.balanceDue ?? 0) || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (Number(r.amountPaid ?? 0) || 0), 0);

  return (
    <AppShell title="Invoices" subtitle="Customer + accounting docs. Share the same 6-digit document number as their originating work order.">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Outstanding balance</div>
          <div className="text-2xl font-display font-bold text-amber-300 mt-1">{money(String(totalOutstanding))}</div>
          <div className="text-[10px] text-zinc-500 font-body mt-1">Across all unpaid + partial invoices</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Total received</div>
          <div className="text-2xl font-display font-bold text-green-300 mt-1">{money(String(totalPaid))}</div>
          <div className="text-[10px] text-zinc-500 font-body mt-1">Sum of all recorded payments</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Total invoices</div>
          <div className="text-2xl font-display font-bold text-white mt-1">{rows.length}</div>
        </div>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Doc #</th>
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 text-right">Paid</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No invoices yet. Generate one from a work order — from <Link href="/work-orders" className="text-amber-300 hover:text-amber-200">/work-orders</Link>, click <strong>Generate invoice</strong> on the row.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-white">
                    <Link href={`/invoices/${r.id}`} className="hover:text-amber-300">
                      {fmtDocumentNumber(r.documentNumber)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.customerId ? customerName.get(r.customerId) ?? "—" : "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[r.status] ?? STATUS_COLORS.draft}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-white">{money(r.grandTotal)}</td>
                  <td className="px-4 py-2.5 text-xs text-right text-green-300">{money(r.amountPaid)}</td>
                  <td className="px-4 py-2.5 text-xs text-right text-amber-300">{money(r.balanceDue)}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    {r.dueDate ? new Date(r.dueDate).toLocaleDateString("en-US") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Link href={`/invoices/${r.id}`} className="text-[11px] text-amber-400 hover:text-amber-300 font-body">
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
