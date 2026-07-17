import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { bills, billLines, glAccounts, departments, vendors, payments, purchaseOrders } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PaymentForm } from "@/components/accounting/PaymentForm";
import { fmtCents } from "@/lib/accounting";
import { paidCentsForBill, voidBill, AP_TERM_LABELS } from "@/lib/ap";
import { fmtDate, fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-400 bg-amber-500/10",
  paid: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5",
};

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const bill = await db.query.bills.findFirst({ where: eq(bills.id, id) });
  if (!bill) notFound();

  const [vendor, po, lines, billPayments, paidCents] = await Promise.all([
    db.query.vendors.findFirst({ where: eq(vendors.id, bill.vendorId) }),
    bill.purchaseOrderId
      ? db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, bill.purchaseOrderId) })
      : Promise.resolve(null),
    db
      .select({
        id: billLines.id,
        description: billLines.description,
        amountCents: billLines.amountCents,
        accountCode: glAccounts.code,
        accountName: glAccounts.name,
        departmentName: departments.name,
      })
      .from(billLines)
      .leftJoin(glAccounts, eq(glAccounts.id, billLines.accountId))
      .leftJoin(departments, eq(departments.id, billLines.departmentId))
      .where(eq(billLines.billId, id))
      .orderBy(asc(billLines.createdAt)),
    db.select().from(payments).where(eq(payments.billId, id)).orderBy(asc(payments.paymentDate)),
    paidCentsForBill(id),
  ]);

  const balance = bill.totalCents - paidCents;
  const now = new Date();
  const overdue = bill.status === "open" && balance > 0 && bill.dueDate < now;

  async function voidThis() {
    "use server";
    const session = await auth();
    await voidBill(id, session?.user?.id ?? null);
    revalidatePath(`/accounting/bills/${id}`);
    revalidatePath("/accounting/bills");
    redirect("/accounting/bills");
  }

  return (
    <AppShell title={`Bill ${bill.billNumber}`} subtitle={vendor?.name ?? undefined}>
      <div className="flex items-center gap-3">
        <Link href="/accounting/bills" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Bills</Link>
        <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[bill.status]}`}>{bill.status}</span>
        {overdue && <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-red-400 bg-red-500/10">overdue</span>}
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-body">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Bill date</div>
          <div className="text-white">{fmtDate(bill.billDate)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Due date</div>
          <div className={overdue ? "text-red-400" : "text-white"}>{fmtDate(bill.dueDate)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Terms</div>
          <div className="text-white">{AP_TERM_LABELS[bill.terms] ?? bill.terms}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Vendor invoice #</div>
          <div className="text-white">{bill.vendorInvoiceNumber ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total</div>
          <div className="text-white font-mono">{fmtCents(bill.totalCents)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Balance</div>
          <div className={`font-mono font-semibold ${balance > 0 ? "text-amber-300" : "text-emerald-400"}`}>{fmtCents(balance)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">PO</div>
          <div className="text-white">{po?.poNumber ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Journal</div>
          <div className="text-white">
            {bill.journalEntryId ? (
              <Link href={`/accounting/journal/${bill.journalEntryId}`} className="text-amber-400 hover:text-amber-300">entry</Link>
            ) : "—"}
          </div>
        </div>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Description</th>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/5">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-zinc-400">{l.accountCode}</span> <span className="text-white">{l.accountName}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-400">{l.description ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">{l.departmentName ?? "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-body font-semibold text-white">
              <td className="px-4 py-2.5" colSpan={3}>Total</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(bill.totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Payments applied ({billPayments.length})
        </div>
        <table className="w-full text-sm">
          <tbody className="font-body text-zinc-200">
            {billPayments.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-xs text-zinc-500">No payments applied yet.</td></tr>
            ) : (
              billPayments.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.paymentNumber}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{fmtDate(p.paymentDate)}</td>
                  <td className="px-4 py-2.5 text-xs capitalize">{p.method}{p.reference ? ` · ${p.reference}` : ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(p.amountCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {bill.status !== "void" && balance > 0 && (
        <PaymentForm
          vendors={vendor ? [{ id: vendor.id, name: vendor.name }] : []}
          openBills={[{ id: bill.id, vendorId: bill.vendorId, label: `${bill.billNumber} · ${fmtCents(balance)} due` }]}
          fixedVendorId={bill.vendorId}
          fixedBillId={bill.id}
        />
      )}

      {bill.status === "open" && billPayments.length === 0 && (
        <div className="flex justify-end">
          <form action={voidThis}>
            <button type="submit" className="text-xs font-body text-zinc-400 hover:text-red-400 bg-white/5 border border-white/10 rounded-md px-4 py-2 transition-colors">
              Void bill
            </button>
          </form>
        </div>
      )}

      {bill.status === "void" && (
        <p className="text-[11px] text-zinc-500 font-body">
          This bill was voided — its ledger entry has been reversed. Posted history is kept intact.
        </p>
      )}
      <p className="text-[10px] text-zinc-600 font-body">Created {fmtDateTime(bill.createdAt)}</p>
    </AppShell>
  );
}
