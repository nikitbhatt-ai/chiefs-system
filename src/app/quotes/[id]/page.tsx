import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers, parts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { QuoteEditor, type QuoteLine } from "./QuoteEditor";

async function saveQuote(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const customerId = String(formData.get("customerId") ?? "") || null;
  const status = String(formData.get("status") ?? "draft") as
    | "draft"
    | "sent"
    | "approved"
    | "converted";
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = JSON.parse(linesJson) as QuoteLine[];

  let subtotal = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  for (const l of lines) {
    if (l.kind === "item") {
      const gross = (l.quantity || 0) * (l.unitPrice || 0);
      const disc =
        l.discountKind === "pct"
          ? gross * ((l.discount || 0) / 100)
          : l.discount || 0;
      subtotal += gross;
      discountTotal += disc;
    } else if (l.kind === "fee") {
      feeTotal += l.amount || 0;
    }
  }
  const taxRate = Number(formData.get("taxRate") ?? "0") || 0;
  const taxableBase = subtotal - discountTotal + feeTotal;
  const taxTotal = taxableBase * (taxRate / 100);
  const grandTotal = taxableBase + taxTotal;

  await db
    .update(quotes)
    .set({
      customerId,
      status,
      notes,
      lineItems: lines as never,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, id));
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/workflow");
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) notFound();

  const customerRows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .orderBy(customers.name);

  const partRows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      name: parts.name,
      price: parts.price,
      cost: parts.cost,
    })
    .from(parts)
    .where(eq(parts.archived, false))
    .orderBy(parts.sku);

  const initial = (q.lineItems as unknown as QuoteLine[]) ?? [];

  return (
    <AppShell
      title={q.quoteNumber ?? "Quote"}
      subtitle={`Status: ${q.status}`}
    >
      <QuoteEditor
        id={q.id}
        customerId={q.customerId}
        status={q.status}
        notes={q.notes ?? ""}
        initialLines={initial}
        customers={customerRows}
        parts={partRows}
        action={saveQuote}
      />
    </AppShell>
  );
}
