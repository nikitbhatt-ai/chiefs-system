import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
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

// Quote line shape (mirrors QuoteEditor's QuoteLine union). Kept local so
// this server file doesn't import the client editor module.
type QuoteLine =
  | { kind: "item"; description: string; quantity: number; unitPrice: number; discount: number; discountKind: "pct" | "amt"; partId?: string }
  | { kind: "fee"; description: string; amount: number; fixed: boolean }
  | { kind: "labor"; description: string; hours: number; rate: number };

// Save the diagram, then rebuild the quote's PART lines from the placed
// equipment. Labor and fee lines already on the quote are preserved;
// only the parts are re-synced so the quote mirrors the diagram. Pins
// sharing a partId collapse into one line with summed quantity;
// custom-label pins (no partId) become one line each at $0 for the rep
// to price. Redirects to the quote editor to review.
async function generateQuoteFromUpfit(formData: FormData) {
  "use server";
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return;

  // Persist the diagram first so nothing the rep placed is lost.
  await saveUpfit(formData);

  let pins: UpfitPin[] = [];
  try {
    pins = JSON.parse(String(formData.get("pins") ?? "[]")) as UpfitPin[];
  } catch {
    pins = [];
  }

  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return;

  // Group pins with a partId; keep custom-label pins in placement order.
  const byPart = new Map<string, number>();
  const customLines: QuoteLine[] = [];
  for (const p of pins) {
    if (p.partId) {
      byPart.set(p.partId, (byPart.get(p.partId) ?? 0) + 1);
    } else {
      const desc = (p.caption || p.label || "Equipment").trim();
      customLines.push({ kind: "item", description: desc, quantity: 1, unitPrice: 0, discount: 0, discountKind: "pct" });
    }
  }

  const partIds = [...byPart.keys()];
  const partRows = partIds.length
    ? await db.select().from(parts).where(inArray(parts.id, partIds))
    : [];
  const partMap = new Map(partRows.map((p) => [p.id, p]));

  const partLines: QuoteLine[] = partIds.map((pid) => {
    const part = partMap.get(pid);
    const qty = byPart.get(pid) ?? 1;
    return {
      kind: "item",
      description: part ? `${part.sku} — ${part.name}` : "Part",
      quantity: qty,
      unitPrice: part?.price ? Number(part.price) : 0,
      discount: 0,
      discountKind: "pct",
      partId: pid,
    };
  });

  // Preserve any labor / fee lines the rep already added to the quote.
  const existing = ((q.lineItems as unknown as QuoteLine[]) ?? []).filter(
    (l) => l.kind === "labor" || l.kind === "fee",
  );
  const lines: QuoteLine[] = [...partLines, ...customLines, ...existing];

  // Totals helper: taxable base = items(net of discount) + labor + fees.
  const taxableBaseOf = (ls: QuoteLine[]) => {
    let base = 0;
    for (const l of ls) {
      if (l.kind === "item") {
        const gross = (l.quantity || 0) * (l.unitPrice || 0);
        const disc = l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : l.discount || 0;
        base += gross - disc;
      } else if (l.kind === "labor") {
        base += (l.hours || 0) * (l.rate || 0);
      } else {
        base += l.amount || 0;
      }
    }
    return base;
  };

  // subtotal = sum of item gross (matches saveQuote's stored `subtotal`).
  const subtotal = lines.reduce(
    (s, l) => (l.kind === "item" ? s + (l.quantity || 0) * (l.unitPrice || 0) : s),
    0,
  );
  const taxableBase = taxableBaseOf(lines);
  // Tax rate isn't persisted on the quote, so derive the effective rate
  // from the previous lines' tax and re-apply it to the new base.
  const prevBase = taxableBaseOf((q.lineItems as unknown as QuoteLine[]) ?? []);
  const prevTax = Number(q.taxTotal ?? 0);
  const effectiveTaxRate = prevBase > 0 ? prevTax / prevBase : 0;
  const taxTotal = taxableBase * effectiveTaxRate;
  const grandTotal = taxableBase + taxTotal;

  await db
    .update(quotes)
    .set({
      lineItems: lines as never,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath(`/quotes/${quoteId}/upfit`);
  revalidatePath("/quotes");
  if (q.customerId) revalidatePath(`/crm/${q.customerId}`);
  redirect(`/quotes/${quoteId}`);
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
        initialBodyStyle={config?.bodyStyle ?? "tahoe"}
        initialVehicleLabel={defaultVehicleLabel}
        initialPins={config?.pins ?? []}
        initialNotes={config?.notes ?? ""}
        parts={partRows}
        action={saveUpfit}
        generateQuoteAction={generateQuoteFromUpfit}
      />
    </AppShell>
  );
}
