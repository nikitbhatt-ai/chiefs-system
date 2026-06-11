"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, customers, deals } from "@/db/schema";
import { pipelineForCustomerType } from "@/lib/pipelines";

type CustomerTypeValue = "government" | "commercial" | "retail" | "walk_in_credentialed";

function toCustomerType(value: string | null | undefined): CustomerTypeValue {
  if (value === "government") return "government";
  if (value === "walk_in_credentialed") return "walk_in_credentialed";
  if (value === "retail") return "retail";
  return "commercial";
}

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

  const customerTypeValue = toCustomerType(lead.customerType);
  const pipeline = pipelineForCustomerType(lead.customerType);

  // All-or-nothing: previously this did three sequential writes without a
  // transaction, so a mid-flight failure left orphan customer or orphan
  // customer+deal rows tied to a still-"new" lead. Wrap in db.transaction
  // so either every row is created or none are.
  try {
    await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          name: lead.name,
          type: customerTypeValue,
          email: lead.email,
          phone: lead.phone,
        })
        .returning();

      const [deal] = await tx
        .insert(deals)
        .values({
          customerId: customer.id,
          pipeline,
          stage: "prospect",
          source: lead.source,
          subSource: lead.subSource,
          subSourceMeta: lead.subSourceMeta,
          partnerId: lead.partnerId,
          partnerContactId: lead.partnerContactId,
          notes: lead.notes,
        })
        .returning();

      await tx
        .update(leads)
        .set({
          status: "converted",
          convertedCustomerId: customer.id,
          convertedDealId: deal.id,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id));
    });
  } catch (err) {
    console.error("convertLeadAction failed:", err);
    return;
  }
  revalidatePath("/leads");
  revalidatePath("/crm");
  revalidatePath("/deals");
}
