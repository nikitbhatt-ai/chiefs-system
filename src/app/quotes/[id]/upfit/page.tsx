import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, upfitConfigs, upfitSnapPoints, upfitStarters, type UpfitPin, type UpfitSnapPoint } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { UpfitBuilder } from "@/components/UpfitBuilder";
import { resolveVehicleLabel } from "@/lib/upfit/vehicleLabel";
import { normalizePins } from "@/lib/upfit/composites";
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

// ── Snap points + starter layouts (shared per vehicle template) ────────────
// Both live in their own tables (docs/sql/upfit_snap_starters.sql). Reads
// are best-effort so the configurator still works before that SQL is run.

const clampFrac = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

async function saveSnapPoints(formData: FormData) {
  "use server";
  const bodyStyle = String(formData.get("bodyStyle") ?? "").trim();
  if (!bodyStyle) return;
  let raw: unknown = [];
  try {
    raw = JSON.parse(String(formData.get("points") ?? "[]"));
  } catch {
    raw = [];
  }
  const points: UpfitSnapPoint[] = (Array.isArray(raw) ? raw : [])
    .slice(0, 200)
    .map((p) => ({ x: clampFrac((p as UpfitSnapPoint).x), y: clampFrac((p as UpfitSnapPoint).y) }));
  await db
    .insert(upfitSnapPoints)
    .values({ bodyStyle, points, updatedAt: new Date() })
    .onConflictDoUpdate({ target: upfitSnapPoints.bodyStyle, set: { points, updatedAt: new Date() } });
}

async function saveStarter(formData: FormData): Promise<{ id: string } | null> {
  "use server";
  const bodyStyle = String(formData.get("bodyStyle") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!bodyStyle || !name) return null;
  let pins: UpfitPin[] = [];
  try {
    pins = JSON.parse(String(formData.get("pins") ?? "[]")) as UpfitPin[];
  } catch {
    pins = [];
  }
  if (!Array.isArray(pins) || pins.length === 0) return null;
  const [row] = await db
    .insert(upfitStarters)
    .values({ bodyStyle, name, pins: pins.slice(0, 200) })
    .returning({ id: upfitStarters.id });
  return row ?? null;
}

async function deleteStarter(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(upfitStarters).where(eq(upfitStarters.id, id));
}

async function loadSnapAndStarters() {
  try {
    const [snapRows, starterRows] = await Promise.all([
      db.select().from(upfitSnapPoints),
      db.select().from(upfitStarters).orderBy(asc(upfitStarters.name)),
    ]);
    return {
      snapPoints: Object.fromEntries(snapRows.map((r) => [r.bodyStyle, r.points ?? []])) as Record<string, UpfitSnapPoint[]>,
      starters: starterRows.map((r) => ({ id: r.id, bodyStyle: r.bodyStyle, name: r.name, pins: r.pins ?? [] })),
      ready: true,
    };
  } catch (err) {
    console.error("upfit snap points / starters unavailable (run docs/sql/upfit_snap_starters.sql?)", err);
    return { snapPoints: {} as Record<string, UpfitSnapPoint[]>, starters: [], ready: false };
  }
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

  const extras = await loadSnapAndStarters();

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
        initialPins={config ? normalizePins(config.bodyStyle, config.pins ?? []) : []}
        initialNotes={config?.notes ?? ""}
        action={saveUpfit}
        resetAction={resetUpfit}
        snapPoints={extras.snapPoints}
        starters={extras.starters}
        extrasReady={extras.ready}
        saveSnapPointsAction={saveSnapPoints}
        saveStarterAction={saveStarter}
        deleteStarterAction={deleteStarter}
      />
    </AppShell>
  );
}
