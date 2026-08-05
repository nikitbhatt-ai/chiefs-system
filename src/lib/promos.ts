// Vendor promos — Phase 3 db layer. Wraps the pure allocation engine
// (src/lib/promoAllocation.ts) with the persistence + snapshot rules:
//   • On save, each line snapshots its à la carte cost from vendor_part_price so
//     a later price-list edit never changes an already-defined promo.
//   • A promo is validated through the allocation engine BEFORE it is stored, so
//     an impossible package (priced above its à la carte basket) is refused at
//     save time, not discovered later on a PO.
// Allocation itself lives ONLY in promoAllocation.ts and is reachable only with
// a vendor_promo — never from an individual PO line.

import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { vendorPromo, vendorPromoLine, vendors, parts, type POLineItem } from "@/db/schema";
import { currentAlacarteCost } from "@/lib/vendorPricing";
import { allocatePromo, PromoAllocationError, type PromoAllocationResult } from "@/lib/promoAllocation";

export type PromoLineInput = { sku: string; quantity: number };

export type PromoWithLines = {
  promo: typeof vendorPromo.$inferSelect;
  lines: (typeof vendorPromoLine.$inferSelect)[];
};

/** List promos with vendor name and a line count, newest first. */
export async function listPromos() {
  return db
    .select({
      id: vendorPromo.id,
      name: vendorPromo.name,
      vendorId: vendorPromo.vendorId,
      vendorName: vendors.name,
      packagePrice: vendorPromo.packagePrice,
      freight: vendorPromo.freight,
      status: vendorPromo.status,
      effectiveFrom: vendorPromo.effectiveFrom,
      lineCount: sql<number>`(SELECT COUNT(*) FROM ${vendorPromoLine} WHERE ${vendorPromoLine.promoId} = ${vendorPromo.id})`.mapWith(Number),
    })
    .from(vendorPromo)
    .leftJoin(vendors, eq(vendors.id, vendorPromo.vendorId))
    .orderBy(desc(vendorPromo.createdAt));
}

/** A promo and its lines, or null. */
export async function getPromoWithLines(id: string): Promise<PromoWithLines | null> {
  const [promo] = await db.select().from(vendorPromo).where(eq(vendorPromo.id, id)).limit(1);
  if (!promo) return null;
  const lines = await db
    .select()
    .from(vendorPromoLine)
    .where(eq(vendorPromoLine.promoId, id))
    .orderBy(vendorPromoLine.createdAt);
  return { promo, lines };
}

/** Build the allocation-engine input from a stored promo + lines. */
export function allocationInputFor(pwl: PromoWithLines) {
  return {
    packagePrice: Number(pwl.promo.packagePrice),
    freight: pwl.promo.freight != null ? Number(pwl.promo.freight) : null,
    lines: pwl.lines.map((l) => ({
      sku: l.sku,
      quantity: l.quantity,
      alacarteCostSnap: Number(l.alacarteCostSnap),
    })),
  };
}

/** Run the allocation for a stored promo. Throws PromoAllocationError if invalid. */
export async function allocationForPromo(id: string): Promise<PromoAllocationResult | null> {
  const pwl = await getPromoWithLines(id);
  if (!pwl) return null;
  return allocatePromo(allocationInputFor(pwl));
}

export type CreatePromoInput = {
  vendorId: string;
  name: string;
  packagePrice: number;
  freight?: number | null;
  notes?: string | null;
  lines: PromoLineInput[];
};

/**
 * Create a promo, snapshotting each line's à la carte cost from the price list
 * and validating the whole thing through the allocation engine first. Throws a
 * clear Error if a line has no current à la carte price, or PromoAllocationError
 * if the package can't be allocated (e.g. priced above its basket).
 */
export async function createPromo(input: CreatePromoInput) {
  const name = input.name.trim();
  if (!input.vendorId) throw new Error("Pick a vendor for this promo.");
  if (!name) throw new Error("Give the promo a name.");
  if (!(input.packagePrice > 0)) throw new Error("Package price must be greater than zero.");
  const cleanLines = input.lines
    .map((l) => ({ sku: l.sku.trim(), quantity: Math.trunc(Number(l.quantity)) }))
    .filter((l) => l.sku && l.quantity > 0);
  if (cleanLines.length === 0) throw new Error("Add at least one line (SKU + quantity).");

  // Snapshot the à la carte basis from the price list for this vendor.
  const snapped: { sku: string; quantity: number; alacarteCostSnap: number }[] = [];
  const missing: string[] = [];
  for (const l of cleanLines) {
    const cost = await currentAlacarteCost(input.vendorId, l.sku);
    if (cost == null) missing.push(l.sku);
    else snapped.push({ sku: l.sku, quantity: l.quantity, alacarteCostSnap: cost });
  }
  if (missing.length) {
    throw new Error(
      `No current à la carte price for: ${missing.join(", ")}. Set them on /vendor-pricing first, then define the promo.`,
    );
  }

  // Validate through the engine BEFORE persisting (throws on an impossible promo).
  allocatePromo({ packagePrice: input.packagePrice, freight: input.freight ?? null, lines: snapped });

  return db.transaction(async (tx) => {
    const [promo] = await tx
      .insert(vendorPromo)
      .values({
        vendorId: input.vendorId,
        name,
        packagePrice: input.packagePrice.toFixed(2),
        freight: input.freight != null ? Number(input.freight).toFixed(2) : null,
        notes: input.notes?.trim() || null,
      })
      .returning();

    await tx.insert(vendorPromoLine).values(
      snapped.map((l) => ({
        promoId: promo.id,
        sku: l.sku,
        quantity: l.quantity,
        alacarteCostSnap: l.alacarteCostSnap.toFixed(2),
      })),
    );
    return promo;
  });
}

/**
 * Build the PO lines for a package buy — runs the allocation engine ONCE and
 * stamps the allocated unit cost, source_promo_id, and à la carte snapshot onto
 * each line. This is the single place a promo becomes PO lines; individual PO
 * lines never pass through here. Throws if the promo is missing/retired or the
 * allocation is invalid.
 */
export async function buildPackagePOLines(promoId: string): Promise<{ vendorId: string; lines: POLineItem[] }> {
  const pwl = await getPromoWithLines(promoId);
  if (!pwl) throw new Error("Promo not found.");
  if (pwl.promo.status !== "active") throw new Error("This promo is retired — reactivate it before ordering.");

  const alloc = allocatePromo(allocationInputFor(pwl));

  const skus = Array.from(new Set(pwl.lines.map((l) => l.sku)));
  const partRows = skus.length
    ? await db.select({ id: parts.id, sku: parts.sku, name: parts.name }).from(parts).where(inArray(parts.sku, skus))
    : [];
  const bySku = new Map(partRows.map((p) => [p.sku, p]));

  const lines: POLineItem[] = alloc.lines.map((al) => {
    const p = bySku.get(al.sku);
    return {
      id: randomUUID(),
      partId: p?.id,
      sku: al.sku,
      description: p ? `${al.sku} — ${p.name}` : al.sku,
      quantity: al.quantity,
      quantityReceived: 0,
      unitCost: al.allocatedUnitCost,
      sourcePromoId: promoId,
      alacarteCostSnap: al.alacarteCostSnap,
      sourceKind: "package",
    };
  });
  return { vendorId: pwl.promo.vendorId, lines };
}

/** Retire / reactivate a promo. Retired promos can't be picked on a new PO. */
export async function setPromoStatus(id: string, status: "active" | "retired") {
  await db.update(vendorPromo).set({ status, updatedAt: new Date() }).where(eq(vendorPromo.id, id));
}

/** Delete a promo (and its lines, via cascade). */
export async function deletePromo(id: string) {
  await db.delete(vendorPromo).where(eq(vendorPromo.id, id));
}

/** Which of these SKUs exist in the parts catalog (for a soft "not in inventory" hint). */
export async function knownSkus(skus: string[]): Promise<Set<string>> {
  const clean = Array.from(new Set(skus.map((s) => s.trim()).filter(Boolean)));
  if (!clean.length) return new Set();
  const rows = await db.select({ sku: parts.sku }).from(parts).where(inArray(parts.sku, clean));
  return new Set(rows.map((r) => r.sku));
}

export { PromoAllocationError };
