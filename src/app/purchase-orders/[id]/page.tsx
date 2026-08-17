import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, vendors, type POLineItem } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { POEditor } from "./POEditor";
import { receivePurchaseOrder } from "@/lib/inventory";
import { listPromos } from "@/lib/promos";
import { poStatusLabel } from "@/lib/poStatus";

async function saveDraft(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const vendorId = String(formData.get("vendorId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const expectedAt = String(formData.get("expectedAt") ?? "").trim();
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = (JSON.parse(linesJson) as POLineItem[]).map((l) => ({
    ...l,
    // Every persisted line carries a stable id so receiving keys on identity,
    // not array position, and can build an idempotent receipt key.
    id: l.id ?? randomUUID(),
  }));
  const total = lines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
    0,
  );
  // Manual status (Pending/Ordered) — but never override an auto received/
  // fulfilled state from a plain save; those are driven by receiving.
  const [cur] = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id));
  const submitted = String(formData.get("status") ?? "");
  const receivedStates = ["partially_received", "received", "fulfilled"];
  const status =
    (submitted === "pending" || submitted === "ordered") && !receivedStates.includes(cur?.status ?? "")
      ? submitted
      : cur?.status;
  await db
    .update(purchaseOrders)
    .set({
      vendorId,
      notes,
      status: status as typeof purchaseOrders.$inferSelect.status,
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

  const [vendorRows, allPromos] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(vendors.name),
    listPromos(),
  ]);
  const activePromos = allPromos
    .filter((p) => p.status === "active")
    .map((p) => ({ id: p.id, name: p.name, vendorId: p.vendorId }));

  const initial = (po.lineItems as POLineItem[]) ?? [];

  return (
    <AppShell title={po.poNumber ?? "Purchase Order"} subtitle={`Status: ${poStatusLabel(po.status)}`}>
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
        promos={activePromos}
        status={po.status}
        saveDraft={saveDraft}
        receivePO={receivePO}
      />
    </AppShell>
  );
}
