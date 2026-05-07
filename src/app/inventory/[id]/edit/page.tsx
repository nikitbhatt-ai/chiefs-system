import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PartEditForm } from "./PartEditForm";

export default async function EditPartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [p] = await db.select().from(parts).where(eq(parts.id, id));
  if (!p) notFound();

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);

  async function update(formData: FormData) {
    "use server";
    const sku = String(formData.get("sku") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    if (!sku || !name) return;
    const num = (k: string) => {
      const v = String(formData.get(k) ?? "").trim();
      return v === "" ? null : Number(v);
    };
    const costNum = num("cost");
    const priceNum = num("price");
    await db
      .update(parts)
      .set({
        sku,
        name,
        description: String(formData.get("description") ?? "").trim() || null,
        category: String(formData.get("category") ?? "").trim() || null,
        quantityOnHand: num("quantityOnHand") ?? 0,
        quantityOnOrder: num("quantityOnOrder") ?? 0,
        reorderPoint: num("reorderPoint"),
        cost: costNum != null ? String(costNum) : null,
        price: priceNum != null ? String(priceNum) : null,
        vendorId: String(formData.get("vendorId") ?? "") || null,
        manufacturerId: String(formData.get("manufacturerId") ?? "") || null,
        updatedAt: new Date(),
      })
      .where(eq(parts.id, id));
    revalidatePath("/inventory");
    redirect("/inventory");
  }

  return (
    <AppShell title="Edit part" subtitle={`${p.sku} · ${p.name}`}>
      <PartEditForm
        action={update}
        vendors={vendorRows}
        initial={{
          sku: p.sku,
          name: p.name,
          description: p.description ?? "",
          category: p.category ?? "",
          quantityOnHand: p.quantityOnHand,
          quantityOnOrder: p.quantityOnOrder,
          reorderPoint: p.reorderPoint,
          cost: p.cost ?? "",
          price: p.price ?? "",
          vendorId: p.vendorId ?? "",
          manufacturerId: p.manufacturerId ?? "",
        }}
      />
    </AppShell>
  );
}
