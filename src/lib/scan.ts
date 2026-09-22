import { inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { parts, purchaseOrders, vehicles } from "@/db/schema";
import { normalizeScan, scanCandidates } from "@/lib/scanCodes";

export { normalizeScan, scanCandidates };

// Barcode-scan lookup shared by /api/scan (header Scan button, phone camera,
// USB/Bluetooth keyboard-wedge scanners). A scan is an exact code, not a
// search phrase, so this matches whole values only — never substrings — so a
// short code can't pull up dozens of unrelated parts.

export type ScanHit = {
  type: "part" | "vehicle" | "purchase_order";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  // Which field the code matched, shown in the picker when a scan is ambiguous.
  matchedOn: "barcode" | "sku" | "mfg_part_number" | "vin" | "po_number";
  archived?: boolean;
};

export async function lookupScan(raw: string): Promise<ScanHit[]> {
  const code = normalizeScan(raw);
  if (!code) return [];
  const lowers = scanCandidates(code).map((c) => c.toLowerCase());
  const has = (v: string | null) => v != null && lowers.includes(v.toLowerCase());

  const [partRows, vehicleRows, poRows] = await Promise.all([
    db
      .select({
        id: parts.id,
        sku: parts.sku,
        name: parts.name,
        barcode: parts.barcode,
        mfgPartNumber: parts.mfgPartNumber,
        quantityOnHand: parts.quantityOnHand,
        archived: parts.archived,
      })
      .from(parts)
      .where(
        or(
          inArray(sql`lower(${parts.barcode})`, lowers),
          inArray(sql`lower(${parts.sku})`, lowers),
          inArray(sql`lower(${parts.mfgPartNumber})`, lowers),
        ),
      )
      .limit(20),
    db
      .select({
        id: vehicles.id,
        vin: vehicles.vin,
        year: vehicles.year,
        make: vehicles.make,
        model: vehicles.model,
        status: vehicles.status,
      })
      .from(vehicles)
      .where(inArray(sql`lower(${vehicles.vin})`, lowers))
      .limit(5),
    // PO number — so scanning/typing it (e.g. off the packing slip) jumps
    // straight to the PO to receive against.
    db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(inArray(sql`lower(${purchaseOrders.poNumber})`, lowers))
      .limit(5),
  ]);

  const rank = { barcode: 0, sku: 1, mfg_part_number: 2, vin: 3, po_number: 4 } as const;
  const hits: ScanHit[] = partRows.map((p) => ({
    type: "part",
    id: p.id,
    title: `${p.sku} — ${p.name}`,
    subtitle: `On hand: ${p.quantityOnHand}${p.barcode ? ` · Barcode ${p.barcode}` : ""}`,
    href: `/inventory/${p.id}`,
    matchedOn: has(p.barcode) ? "barcode" : has(p.sku) ? "sku" : "mfg_part_number",
    archived: p.archived,
  }));
  for (const v of vehicleRows) {
    hits.push({
      type: "vehicle",
      id: v.id,
      title: [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle",
      subtitle: `VIN ${v.vin} · ${v.status}`,
      href: `/vehicles/${v.id}/edit`,
      matchedOn: "vin",
    });
  }
  for (const po of poRows) {
    hits.push({
      type: "purchase_order",
      id: po.id,
      title: `Purchase order ${po.poNumber}`,
      subtitle: `Status: ${po.status.replace(/_/g, " ")}`,
      href: `/purchase-orders/${po.id}`,
      matchedOn: "po_number",
    });
  }
  // Best match first; archived parts sink below active ones.
  hits.sort(
    (a, b) =>
      Number(a.archived ?? false) - Number(b.archived ?? false) ||
      rank[a.matchedOn] - rank[b.matchedOn],
  );
  return hits;
}
