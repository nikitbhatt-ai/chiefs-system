import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, vendors, parts, type POLineItem } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { POEditor } from "./POEditor";
import { receivePurchaseOrder } from "@/lib/inventory";

async function saveDraft(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const vendorId = String(formData.get("vendorId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const expectedAt = String(formData.get("expectedAt") ?? "").trim();
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = JSON.parse(linesJson) as POLineItem[];
  const total = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
    0,
  );
  await db
    .update(purchaseOrders)
    .set({
      vendorId,
      notes,
      lineItems: lines as never,
      total: total.toFixed(2),
      expectedAt: expectedAt ? new Date(expectedAt) : null,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id));
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
}

async function receivePO(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Read the line count to know which receive_<i> fields to collect; the
  // authoritative quantities are re-read inside the locked transaction in
  // receivePurchaseOrder, which makes the whole receipt atomic and idempotent
  // (concurrent double-submits can't double-increment stock).
  const [po] = await db
    .select({ lineItems: purchaseOrders.lineItems })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id));
  if (!po) return;
  const lines = (po.lineItems as POLineItem[]) ?? [];
  const receiveByIndex = new Map<number, number>();
  for (let i = 0; i < lines.length; i++) {
    const raw = String(formData.get(`receive_${i}`) ?? "").trim();
    const n = raw ? Number(raw) : 0;
    if (n > 0) receiveByIndex.set(i, n);
  }

  await receivePurchaseOrder(id, receiveByIndex);

  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/inventory");
}

export default async function POPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!po) notFound();

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);

  const partRows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      name: parts.name,
      cost: parts.cost,
    })
    .from(parts)
    .orderBy(parts.sku);

  const initial = (po.lineItems as POLineItem[]) ?? [];

  return (
    <AppShell title={po.poNumber ?? "Purchase Order"} subtitle={`Status: ${po.status.replace(/_/g, " ")}`}>
      <div className="flex justify-end">
        <a
          href={`/api/pdf/purchase-orders/${po.id}`}
          target="_blank"
          rel="noopener"
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
        >
          Download PDF
        </a>
      </div>
      <POEditor
        id={po.id}
        vendorId={po.vendorId ?? ""}
        notes={po.notes ?? ""}
        expectedAt={po.expectedAt ? new Date(po.expectedAt).toISOString().slice(0, 10) : ""}
        initialLines={initial}
        vendors={vendorRows}
        parts={partRows}
        status={po.status}
        saveDraft={saveDraft}
        receivePO={receivePO}
      />
    </AppShell>
  );
}
