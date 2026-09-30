import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, upfitConfigs, type UpfitPin } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { UpfitBuilder } from "@/components/UpfitBuilder";
import { resolveVehicleLabel } from "@/lib/upfit/vehicleLabel";
import { removeUpfitLink, upsertUpfitLink } from "@/lib/customerDocLinks";

export const dynamic = "force-dynamic";

async function saveUpfit(formData: FormData) {
  "use server";
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return;
  const bodyStyle = String(formData.get("bodyStyle") ?? "tahoe");
  const vehicleLabel = String(formData.get("vehicleLabel") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const pinsJson = String(formData.get("pins") ?? "[]");
  let pins: UpfitPin[] = [];
  try {
    pins = JSON.parse(pinsJson) as UpfitPin[];
  } catch {
    pins = [];
  }

  const [existing] = await db
    .select()
    .from(upfitConfigs)
    .where(eq(upfitConfigs.quoteId, quoteId));

  if (existing) {
    await db
      .update(upfitConfigs)
      .set({ bodyStyle, vehicleLabel, pins, notes, updatedAt: new Date() })
      .where(eq(upfitConfigs.id, existing.id));
  } else {
    await db.insert(upfitConfigs).values({ quoteId, bodyStyle, vehicleLabel, pins, notes });
  }

  // Auto-link the spec PDF into the customer's folder under
  // Photos / Build Documentation. Best-effort: the upfit save is already
  // committed, so a customer-folder failure must not bubble up as a
  // user-facing error.
  try {
    await upsertUpfitLink(quoteId);
  } catch (err) {
    console.error("upsertUpfitLink failed:", err);
  }

  revalidatePath(`/quotes/${quoteId}/upfit`);
  revalidatePath(`/quotes/${quoteId}`);
  const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (quoteRow?.customerId) revalidatePath(`/crm/${quoteRow.customerId}`);
}

// "Reset builder": delete this estimate's vehicle configuration (vehicle,
// lights, build notes) so sales can start over. Touches ONLY the
// configuration — the estimate's line items, prices and status are left
// exactly as they are (the diagram never fed the price anyway).
async function resetUpfit(formData: FormData) {
  "use server";
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return;
  await db.delete(upfitConfigs).where(eq(upfitConfigs.quoteId, quoteId));
  try {
    await removeUpfitLink(quoteId);
  } catch (err) {
    console.error("removeUpfitLink failed:", err);
  }
  revalidatePath(`/quotes/${quoteId}/upfit`);
  revalidatePath(`/quotes/${quoteId}`);
  const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (quoteRow?.customerId) revalidatePath(`/crm/${quoteRow.customerId}`);
}

export default async function UpfitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) notFound();

  const [config] = await db
    .select()
    .from(upfitConfigs)
    .where(eq(upfitConfigs.quoteId, id));

  // Stored override wins; otherwise prefill from the linked deal/vehicle.
  const defaultVehicleLabel =
    config?.vehicleLabel?.trim() || (await resolveVehicleLabel(q)) || "";

  return (
    <AppShell title="Vehicle Configurator" subtitle={q.quoteNumber ?? "Estimate"}>
      <UpfitBuilder
        quoteId={q.id}
        quoteNumber={q.quoteNumber ?? "Estimate"}
        initialBodyStyle={config?.bodyStyle ?? null}
        initialVehicleLabel={defaultVehicleLabel}
        initialPins={config?.pins ?? []}
        initialNotes={config?.notes ?? ""}
        action={saveUpfit}
        resetAction={resetUpfit}
      />
    </AppShell>
  );
}
