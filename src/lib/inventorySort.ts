import { asc, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { parts } from "@/db/schema";

// Column keys the inventory list can be sorted by. Shared between the list
// page (clickable headers) and the print/export view so both order identically.
export const INVENTORY_SORT_KEYS = [
  "sku",
  "name",
  "category",
  "manufacturer",
  "supplier",
  "onhand",
  "onorder",
  "cost",
  "price",
  "margin",
] as const;

export type InventorySortKey = (typeof INVENTORY_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

// Default view: alphabetical by name.
const DEFAULT_SORT: InventorySortKey = "name";
const DEFAULT_DIR: SortDir = "asc";

export function normalizeInventorySort(
  rawSort: string | undefined,
  rawDir: string | undefined,
): { sort: InventorySortKey; dir: SortDir } {
  const sort = (INVENTORY_SORT_KEYS as readonly string[]).includes(rawSort ?? "")
    ? (rawSort as InventorySortKey)
    : DEFAULT_SORT;
  const dir: SortDir = rawDir === "desc" ? "desc" : rawDir === "asc" ? "asc" : DEFAULT_DIR;
  return { sort, dir };
}

// Margin as a fraction of price: (price - cost) / price. Null when either side
// is missing or non-positive, so those rows sort to the end (NULLS LAST).
const marginExpr = sql`case
  when ${parts.cost} is null or ${parts.price} is null
    or ${parts.cost} <= 0 or ${parts.price} <= 0 then null
  else (${parts.price} - ${parts.cost}) / ${parts.price}
end`;

// Order an expression in the requested direction, always pushing NULLs last so
// parts with no cost/price/vendor don't crowd the top of a descending sort.
function ordered(expr: SQL | PgColumn, dir: SortDir): SQL {
  return sql`${expr} ${sql.raw(dir === "desc" ? "desc" : "asc")} nulls last`;
}

/**
 * Build the Drizzle orderBy for the parts query. Vendor-name sorts use the
 * caller's aliased `vendors` joins (supplier = parts.vendorId, manufacturer =
 * parts.manufacturerId). A stable `sku` tiebreaker keeps paging deterministic.
 */
export function inventoryOrderBy(
  sort: InventorySortKey,
  dir: SortDir,
  aliases: { supplierName: PgColumn; manufacturerName: PgColumn },
): SQL[] {
  const primary: SQL = (() => {
    switch (sort) {
      case "sku":
        return ordered(parts.sku, dir);
      case "name":
        return ordered(parts.name, dir);
      case "category":
        return ordered(parts.category, dir);
      case "manufacturer":
        return ordered(aliases.manufacturerName, dir);
      case "supplier":
        return ordered(aliases.supplierName, dir);
      case "onhand":
        return ordered(parts.quantityOnHand, dir);
      case "onorder":
        return ordered(parts.quantityOnOrder, dir);
      case "cost":
        return ordered(parts.cost, dir);
      case "price":
        return ordered(parts.price, dir);
      case "margin":
        return ordered(marginExpr, dir);
    }
  })();
  // Deterministic tiebreaker (sku is unique). Skip when it's already the key.
  return sort === "sku" ? [primary] : [primary, asc(parts.sku)];
}

// Human-readable label for the active sort, e.g. for the print header.
export function inventorySortLabel(sort: InventorySortKey, dir: SortDir): string {
  const labels: Record<InventorySortKey, string> = {
    sku: "SKU",
    name: "Name",
    category: "Category",
    manufacturer: "Manufacturer",
    supplier: "Supplier",
    onhand: "On hand",
    onorder: "On order",
    cost: "Internal cost",
    price: "Price",
    margin: "Margin",
  };
  const numeric: InventorySortKey[] = ["onhand", "onorder", "cost", "price", "margin"];
  const direction = numeric.includes(sort)
    ? dir === "desc"
      ? "high → low"
      : "low → high"
    : dir === "desc"
      ? "Z → A"
      : "A → Z";
  return `${labels[sort]} (${direction})`;
}
