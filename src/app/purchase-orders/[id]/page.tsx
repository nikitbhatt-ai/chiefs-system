import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  purchaseOrders,
  vendors,
  parts,
  partReceipts,
  partCostHistory,
  type POLineItem,
} from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { POEditor } from "./POEditor";

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
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!po) return;
  const lines = (po.lineItems as POLineItem[]) ?? [];
  const updatedLines: POLineItem[] = [];
  let allFullyReceived = true;
  let anyReceivedThisRound = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const receiveNowRaw = String(formData.get(`receive_${i}`) ?? "").trim();
    const receiveNow = receiveNowRaw ? Number(receiveNowRaw) : 0;
    const remaining = (l.quantity || 0) - (l.quantityReceived || 0);
    const qty = Math.max(0, Math.min(receiveNow, remaining));
    if (qty > 0 && l.partId) {
      anyReceivedThisRound = true;
      // Append to receipt ledger.
      await db.insert(partReceipts).values({
        partId: l.partId,
        purchaseOrderId: po.id,
        vendorId: po.vendorId ?? null,
        quantityReceived: qty,
        quantityRemaining: qty,
        unitCost: String(l.unitCost),
      });
      // Increment on-hand qty atomically.
      await db
        .update(parts)
        .set({
          quantityOnHand: sql`${parts.quantityOnHand} + ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, l.partId));
      // Historical price chart row.
      await db.insert(partCostHistory).values({
        partId: l.partId,
        cost: String(l.unitCost),
        source: po.poNumber ?? "PO",
      });
    }
    const newReceived = (l.quantityReceived || 0) + qty;
    if (newReceived < (l.quantity || 0)) allFullyReceived = false;
    updatedLines.push({ ...l, quantityReceived: newReceived });
  }

  const nextStatus = allFullyReceived
    ? ("received" as const)
    : anyReceivedThisRound
      ? ("partially_received" as const)
      : po.status;

  await db
    .update(purchaseOrders)
    .set({
      lineItems: updatedLines as never,
      status: nextStatus,
      receivedAt: allFullyReceived ? new Date() : po.receivedAt,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id));

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
