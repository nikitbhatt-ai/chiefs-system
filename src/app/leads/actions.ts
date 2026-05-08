"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, customers } from "@/db/schema";

export async function createLeadAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const customerType = String(formData.get("customerType") ?? "").trim() || null;
  const source = String(formData.get("source") ?? "").trim() || null;
  const subSource = String(formData.get("subSource") ?? "").trim() || null;

  let subSourceMeta: Record<string, unknown> | null = null;
  if (source === "Sames Reference") {
    subSourceMeta = {
      salespersonContactId: String(formData.get("samesSalespersonId") ?? "").trim() || null,
      location: String(formData.get("samesLocation") ?? "").trim() || null,
      referralDate: String(formData.get("samesReferralDate") ?? "").trim() || null,
      referralNotes: String(formData.get("samesReferralNotes") ?? "").trim() || null,
    };
  }

  await db.insert(leads).values({
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    customerType,
    source,
    subSource,
    subSourceMeta,
    partnerId: String(formData.get("partnerId") ?? "").trim() || null,
    partnerContactId: String(formData.get("samesSalespersonId") ?? "").trim() || null,
    status: "new",
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/leads");
}

export async function deleteLeadAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
}

export async function convertLeadAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) return;
  const [customer] = await db
    .insert(customers)
    .values({
      name: lead.name,
      type: "commercial",
      email: lead.email,
      phone: lead.phone,
    })
    .returning();
  await db
    .update(leads)
    .set({
      status: "converted",
      convertedCustomerId: customer.id,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));
  revalidatePath("/leads");
  revalidatePath("/crm");
}
