import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { arInvoices, customers, quotes, receipts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { ReceiptForm } from "@/components/accounting/ReceiptForm";
import { fmtCents } from "@/lib/accounting";
import { paidCentsForInvoice, voidInvoice, AR_TERM_LABELS } from "@/lib/ar";
import { fmtDate, fmtDateTime } from "@/lib/datetime";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-400 bg-amber-500/10",
  paid: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const invoice = await db.query.arInvoices.findFirst({ where: eq(arInvoices.id, id) });
  if (!invoice) notFound();

  const [customer, quote, appliedReceipts, paidCents] = await Promise.all([
    invoice.customerId
      ? db.query.customers.findFirst({ where: eq(customers.id, invoice.customerId) })
      : Promise.resolve(null),
    db.query.quotes.findFirst({ where: eq(quotes.id, invoice.quoteId) }),
    db.select().from(receipts).where(eq(receipts.invoiceId, id)).orderBy(asc(receipts.receiptDate)),
    paidCentsForInvoice(id),
  ]);

  const balance = invoice.totalCents - paidCents;
  const now = new Date();
  const overdue = invoice.status === "open" && balance > 0 && invoice.dueDate < now;

  async function voidThis() {
    "use server";
    const session = await auth();
    await voidInvoice(id, session?.user?.id ?? null);
    revalidatePath(`/accounting/invoices/${id}`);
    revalidatePath("/accounting/invoices");
    redirect("/accounting/invoices");
  }

  return (
    <AppShell title={`Invoice ${invoice.invoiceNumber}`} subtitle={customer?.name ?? undefined}>
      <div className="flex items-center gap-3">
        <Link href="/accounting/invoices" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Invoices</Link>
        <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[invoice.status]}`}>
          {invoice.status}
        </span>
        {overdue && <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-red-400 bg-red-500/10">overdue</span>}
      </div>

      <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-body">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Invoice date</div>
          <div className="text-white">{fmtDate(invoice.invoiceDate)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Due date</div>
          <div className={overdue ? "text-red-400" : "text-white"}>{fmtDate(invoice.dueDate)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Terms</div>
          <div className="text-white">{AR_TERM_LABELS[invoice.terms] ?? invoice.terms}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Source</div>
          <div className="text-white">
            {quote ? (
              <Link href={`/quotes/${quote.id}`} className="text-amber-400 hover:text-amber-300">
                {quote.quoteNumber ?? "quote"}
              </Link>
            ) : "—"}
            {invoice.journalEntryId && (
              <>
                {" · "}
                <Link href={`/accounting/journal/${invoice.journalEntryId}`} className="text-amber-400 hover:text-amber-300">
                  journal
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-body">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Subtotal</div>
          <div className="text-white font-mono">{fmtCents(invoice.subtotalCents)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Sales tax</div>
          <div className="text-white font-mono">{fmtCents(invoice.taxCents)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total</div>
          <div className="text-white font-mono">{fmtCents(invoice.totalCents)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Balance</div>
          <div className={`font-mono font-semibold ${balance > 0 ? "text-amber-300" : "text-emerald-400"}`}>
            {fmtCents(balance)}
          </div>
        </div>
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Receipts applied ({appliedReceipts.length})
        </div>
        <table className="w-full text-sm">
          <tbody className="font-body text-zinc-200">
            {appliedReceipts.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-xs text-zinc-500">No receipts applied yet.</td>
              </tr>
            ) : (
              appliedReceipts.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs">{r.receiptNumber}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{fmtDate(r.receiptDate)}</td>
                  <td className="px-4 py-2.5 text-xs capitalize">{r.method}{r.reference ? ` · ${r.reference}` : ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(r.amountCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {invoice.status !== "void" && balance > 0 && invoice.customerId && (
        <ReceiptForm
          customers={customer ? [{ id: customer.id, name: customer.name }] : []}
          openInvoices={[{ id: invoice.id, customerId: invoice.customerId, label: `${invoice.invoiceNumber} · ${fmtCents(balance)} due` }]}
          fixedCustomerId={invoice.customerId}
          fixedInvoiceId={invoice.id}
        />
      )}

      {invoice.status === "open" && appliedReceipts.length === 0 && (
        <div className="flex justify-end">
          <form action={voidThis}>
            <SubmitButton
              className="text-xs font-body text-zinc-400 hover:text-red-400 bg-white/5 border border-white/10 rounded-md px-4 py-2 transition-colors"
            >
              Void invoice
            </SubmitButton>
          </form>
        </div>
      )}

      {invoice.status === "void" && (
        <p className="text-[11px] text-zinc-500 font-body">
          This invoice was voided — its ledger entry has been reversed. Posted history is kept intact.
        </p>
      )}
      <p className="text-[10px] text-zinc-600 font-body">Created {fmtDateTime(invoice.createdAt)}</p>
    </AppShell>
  );
}
