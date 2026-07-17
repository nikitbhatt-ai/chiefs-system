import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, vehicles, type quotes } from "@/db/schema";

type QuoteRow = typeof quotes.$inferSelect;

// Resolve a human-readable "year make model" label for the vehicle a
// quote targets. Prefers the quote's OWN vehicle (from its VIN decoder),
// then the deal's denormalized fields, then the deal's linked vehicle
// row. Returns null when nothing is set so callers can fall back to the
// body-style label.
export async function resolveVehicleLabel(quote: QuoteRow): Promise<string | null> {
  const ownParts = [quote.vehicleYear, quote.vehicleMake, quote.vehicleModel, quote.vehicleTrim].filter(
    Boolean,
  );
  if (ownParts.length) return ownParts.join(" ");

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
