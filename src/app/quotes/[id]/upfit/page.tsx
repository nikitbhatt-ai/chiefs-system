import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, parts, upfitConfigs, type UpfitPin } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { QuoteTabs } from "@/components/QuoteTabs";
import { UpfitBuilder } from "@/components/UpfitBuilder";
import { resolveVehicleLabel } from "@/lib/upfit/vehicleLabel";
import { upsertUpfitLink } from "@/lib/customerDocLinks";

export const dynamic = "force-dynamic";

async function saveUpfit(formData: FormData) {
  "use server";
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return;
  const bodyStyle = String(formData.get("bodyStyle") ?? "suv");
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

  const partRows = await db
    .select({ id: parts.id, sku: parts.sku, name: parts.name })
    .from(parts)
    .where(eq(parts.archived, false))
    .orderBy(parts.sku);

  // Stored override wins; otherwise prefill from the linked deal/vehicle.
  const defaultVehicleLabel =
    config?.vehicleLabel?.trim() || (await resolveVehicleLabel(q)) || "";

  return (
    <AppShell
      title={q.quoteNumber ?? "Quote"}
      subtitle={`Upfit builder · Status: ${q.status}`}
    >
      <div className="flex justify-between items-center gap-2">
        <QuoteTabs quoteId={q.id} active="upfit" />
        <a
          href={`/api/pdf/upfit/${q.id}`}
          target="_blank"
          rel="noopener"
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
        >
          Download spec PDF
        </a>
      </div>

      <UpfitBuilder
        quoteId={q.id}
        initialBodyStyle={config?.bodyStyle ?? "suv"}
        initialVehicleLabel={defaultVehicleLabel}
        initialPins={config?.pins ?? []}
        initialNotes={config?.notes ?? ""}
        parts={partRows}
        action={saveUpfit}
      />
    </AppShell>
  );
}
