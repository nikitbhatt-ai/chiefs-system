import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/db";
import { customers, workOrders, quotes } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDocumentNumber } from "@/lib/documentNumber";
import { fmtDateTime } from "@/lib/datetime";
import { loadInvoiceWithPayments, recordInvoicePayment } from "@/lib/invoices";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  partial: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  paid: "bg-green-500/10 text-green-300 border-green-500/30",
  overdue: "bg-red-500/10 text-red-300 border-red-500/30",
  void: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
};

const METHODS = ["cash", "check", "card", "ach", "other"] as const;

function money(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Line = {
  name?: string;
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  lineTotal?: number | string;
  taxable?: boolean;
};

async function addPayment(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;
  const amount = Number(formData.get("amount"));
  const methodRaw = String(formData.get("method") ?? "").trim();
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (!METHODS.includes(methodRaw as (typeof METHODS)[number])) return;
  await recordInvoicePayment({
    invoiceId,
    amount,
    method: methodRaw as (typeof METHODS)[number],
    reference: String(formData.get("reference") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    receivedBy: session.user.id ?? null,
  });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}

async function markSent(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;
  const { invoices } = await import("@/db/schema");
  await db
    .update(invoices)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;

  const loaded = await loadInvoiceWithPayments(id);
  if (!loaded) notFound();
  const { invoice, payments } = loaded;

  const [customer] = invoice.customerId
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, invoice.customerId))
    : [undefined];
  const [wo] = invoice.workOrderId
    ? await db.select({ id: workOrders.id, woNumber: workOrders.woNumber }).from(workOrders).where(eq(workOrders.id, invoice.workOrderId))
    : [undefined];
  const [quote] = invoice.quoteId
    ? await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber }).from(quotes).where(eq(quotes.id, invoice.quoteId))
    : [undefined];

  const lineItems = (invoice.lineItems as Line[] | null) ?? [];

  const balance = Number(invoice.balanceDue ?? 0) || 0;
  const paid = Number(invoice.amountPaid ?? 0) || 0;
  const grand = Number(invoice.grandTotal ?? 0) || 0;

  return (
    <AppShell
      title={`Invoice ${fmtDocumentNumber(invoice.documentNumber)}`}
      subtitle={`${customer?.name ?? "—"} · ${wo?.woNumber ? `WO ${wo.woNumber}` : "no work order"}`}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[invoice.status] ?? STATUS_COLORS.draft}`}>
            {invoice.status}
          </span>
          {invoice.dueDate ? (
            <span className="text-[11px] text-zinc-400 font-body">
              Due {new Date(invoice.dueDate).toLocaleDateString("en-US")}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === "draft" ? (
            <form action={markSent}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button type="submit" className="text-[11px] bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1.5 font-semibold">
                Mark sent
              </button>
            </form>
          ) : null}
          {quote ? (
            <a
              href={`/api/pdf/quotes/${quote.id}?variant=invoice`}
              target="_blank"
              rel="noopener"
              className="text-[11px] bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
            >
              Invoice PDF
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Subtotal</div>
          <div className="text-lg font-display font-bold text-white mt-1">{money(invoice.subtotal)}</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Tax</div>
          <div className="text-lg font-display font-bold text-white mt-1">{money(invoice.taxTotal)}</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Grand total</div>
          <div className="text-lg font-display font-bold text-white mt-1">{money(grand)}</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">Balance due</div>
          <div className={`text-lg font-display font-bold mt-1 ${balance > 0 ? "text-amber-300" : "text-green-300"}`}>
            {money(balance)}
          </div>
          <div className="text-[10px] text-zinc-500 font-body mt-1">Paid: <span className="text-green-300">{money(paid)}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line items snapshot */}
        <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
            Line items (snapshot at invoice creation)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="font-body text-zinc-200">
              {lineItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">No line items.</td>
                </tr>
              ) : (
                lineItems.map((li, idx) => (
                  <tr key={idx} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white">
                      {li.name ?? li.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">{li.quantity ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-right">{money(li.unitPrice)}</td>
                    <td className="px-3 py-2 text-xs text-right text-white">{money(li.lineTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Payment history + record payment */}
        <div className="space-y-6">
          <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5 flex items-center justify-between">
              <span>Payment history</span>
              <span className="text-zinc-400 normal-case">{payments.length} recorded</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="font-body text-zinc-200">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">
                      No payments yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(p.receivedAt)}</td>
                      <td className="px-3 py-2 text-xs uppercase">{p.method}</td>
                      <td className="px-3 py-2 text-xs font-mono">{p.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-right text-green-300">{money(p.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {balance > 0 ? (
            <form action={addPayment} className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Record payment</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500">Amount</label>
                  <input
                    type="number"
                    name="amount"
                    step="0.01"
                    min="0.01"
                    max={balance}
                    defaultValue={balance.toFixed(2)}
                    required
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500">Method</label>
                  <select
                    name="method"
                    required
                    defaultValue="check"
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Reference (check #, txn id, etc.)</label>
                <input
                  name="reference"
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Notes</label>
                <textarea
                  name="notes"
                  rows={2}
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="text-[11px] bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold">
                  Record payment
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 text-center">
              <div className="text-sm text-green-300 font-semibold">Invoice paid in full</div>
              {invoice.paidAt ? (
                <div className="text-[11px] text-zinc-400 mt-1">Marked paid {fmtDateTime(invoice.paidAt)}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-[11px] text-zinc-500 font-body">
        {wo ? <Link href={`/work-orders/${wo.id}`} className="hover:text-amber-300">← Work order {wo.woNumber ?? ""}</Link> : null}
        {quote ? <Link href={`/quotes/${quote.id}`} className="hover:text-amber-300">← Source quote {quote.quoteNumber ?? ""}</Link> : null}
        <Link href="/invoices" className="hover:text-amber-300">← All invoices</Link>
      </div>
    </AppShell>
  );
}
