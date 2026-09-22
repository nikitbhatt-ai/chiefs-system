// The header facts every customer-facing document about a quote/invoice needs:
// who it is for, how to reach them, which vehicle is being built, and who sold
// it.
//
// This exists as one function because the same facts are printed by the PDF
// template AND the on-screen print view. Two copies of these lookups is how a
// customer ends up with an invoice whose sales rep disagrees with the screen —
// the same trap the line-item discount arithmetic fell into before it was
// consolidated into `quoteTotals`.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, deals, parts, users, vehicles, type quotes } from "@/db/schema";
import { resolveVehicleLabel } from "@/lib/upfit/vehicleLabel";

type QuoteRow = typeof quotes.$inferSelect;

export type QuoteDocumentFacts = {
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  /** "2026 Chevrolet Silverado 1500 WT" — the vehicle this build is for. */
  vehicleSummary: string | null;
  vin: string | null;
  unitNumber: string | null;
  vehicleColor: string | null;
  vehicleMileage: number | null;
  /** Who this is assigned to, for the "Sales rep" line on the document. */
  salesPerson: string | null;
  /** partId → part number, for the Part # column. */
  partNumbers: Record<string, string>;
  /**
   * partId → weighted-average unit cost. **Internal only** — this feeds the
   * editor and the internal copy of a document, never the customer's.
   */
  partCosts: Record<string, number>;
};

/** The distinct part ids referenced by a quote's lines. */
function linePartIds(quote: QuoteRow): string[] {
  return [
    ...new Set(
      ((quote.lineItems as unknown as { partId?: string }[]) ?? [])
        .map((l) => l?.partId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

/**
 * Part numbers AND internal average costs for the lines on a quote, keyed by
 * `partId`. One query for both, because they come from the same rows.
 *
 * The manufacturer's number is preferred over our internal SKU — it is the one
 * a customer can look up or cross-reference with a vendor. The cost is
 * `avg_cost`, the weighted-average basis job costing uses, falling back to the
 * catalogue `cost` when no average has been built up yet.
 */
async function resolvePartFacts(
  quote: QuoteRow,
): Promise<{ partNumbers: Record<string, string>; partCosts: Record<string, number> }> {
  const ids = linePartIds(quote);
  if (ids.length === 0) return { partNumbers: {}, partCosts: {} };
  const rows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      mfg: parts.mfgPartNumber,
      avgCost: parts.avgCost,
      cost: parts.cost,
    })
    .from(parts)
    .where(inArray(parts.id, ids));

  const partNumbers: Record<string, string> = {};
  const partCosts: Record<string, number> = {};
  for (const r of rows) {
    const n = r.mfg?.trim() || r.sku?.trim();
    if (n) partNumbers[r.id] = n;
    const raw = r.avgCost ?? r.cost;
    const c = raw == null ? NaN : Number(raw);
    if (Number.isFinite(c)) partCosts[r.id] = c;
  }
  return { partNumbers, partCosts };
}

/**
 * Load the document header facts for a quote.
 *
 * Vehicle detail beyond year/make/model comes from the deal's linked vehicle
 * row, which is the only place colour and mileage are recorded. Engine and
 * transmission are deliberately absent: the app does not store them, and a
 * blank line on a customer's invoice is better than an invented one.
 *
 * The sales person prefers the assigned user's display name, falls back to the
 * deal's free-text `sales_rep` (which pre-dates user assignment), and is null
 * when the quote has no deal — an unassigned quote must not print somebody
 * else's name.
 */
export async function quoteDocumentFacts(quote: QuoteRow): Promise<QuoteDocumentFacts> {
  const customer = quote.customerId
    ? (await db.select().from(customers).where(eq(customers.id, quote.customerId)))[0] ?? null
    : null;

  const deal = quote.dealId
    ? (await db.select().from(deals).where(eq(deals.id, quote.dealId)))[0] ?? null
    : null;

  let salesPerson: string | null = null;
  if (deal?.assignedTo) {
    const [u] = await db.select().from(users).where(eq(users.id, deal.assignedTo));
    salesPerson = u?.displayName?.trim() || u?.name?.trim() || u?.email || null;
  }
  if (!salesPerson) salesPerson = deal?.salesRep?.trim() || null;

  let vehicleColor: string | null = null;
  let vehicleMileage: number | null = null;
  if (deal?.vehicleId) {
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, deal.vehicleId));
    vehicleColor = v?.color?.trim() || null;
    vehicleMileage = v?.mileage ?? null;
  }

  return {
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? null,
    customerPhone: customer?.phone ?? null,
    customerAddress: customer?.address ?? null,
    vehicleSummary: (await resolveVehicleLabel(quote)) || null,
    vin: quote.vin ?? null,
    unitNumber: quote.unitNumber ?? null,
    vehicleColor,
    vehicleMileage,
    salesPerson,
    ...(await resolvePartFacts(quote)),
  };
}
