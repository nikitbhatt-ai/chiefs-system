import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, vehicles, type quotes } from "@/db/schema";

type QuoteRow = typeof quotes.$inferSelect;

// Resolve a human-readable "year make model" label for the vehicle a
// quote's upfit targets. Prefers the deal's denormalized vehicle fields,
// then the linked vehicle row. Returns null when nothing is linked yet so
// callers can fall back to the body-style label.
export async function resolveVehicleLabel(quote: QuoteRow): Promise<string | null> {
  if (!quote.dealId) return null;
  const [deal] = await db.select().from(deals).where(eq(deals.id, quote.dealId));
  if (!deal) return null;

  const dealParts = [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean);
  if (dealParts.length) return dealParts.join(" ");

  if (deal.vehicleId) {
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, deal.vehicleId));
    if (v) {
      const vParts = [v.year, v.make, v.model, v.trim].filter(Boolean);
      if (vParts.length) return vParts.join(" ");
    }
  }
  return null;
}
