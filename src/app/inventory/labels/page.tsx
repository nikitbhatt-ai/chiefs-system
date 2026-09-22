import { and, asc, count, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { parts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { parseLabelItems } from "@/lib/labels";
import { LabelBuilder } from "./LabelBuilder";

// Label builder: pick parts + copies + label stock, then open the print view.
// ?items=id:qty,… prefills the list (from a part page or a PO).
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ items?: string }> }) {
  const sp = await searchParams;
  const pre = parseLabelItems(sp.items);
  const preRows = pre.length
    ? await db
        .select({ id: parts.id, sku: parts.sku, name: parts.name, barcode: parts.barcode })
        .from(parts)
        .where(inArray(parts.id, pre.map((p) => p.partId)))
    : [];
  const preById = new Map(preRows.map((r) => [r.id, r]));
  const initial = pre
    .filter((p) => preById.has(p.partId))
    .map((p) => {
      const r = preById.get(p.partId)!;
      return { partId: r.id, sku: r.sku, name: r.name, hasBarcode: !!r.barcode, copies: p.copies };
    });

  const noBarcode = and(eq(parts.archived, false), or(isNull(parts.barcode), eq(parts.barcode, "")));
  const [{ n: missingCount }] = await db.select({ n: count() }).from(parts).where(noBarcode);
  const categoryRows = await db
    .selectDistinct({ category: parts.category })
    .from(parts)
    .where(and(noBarcode, isNotNull(parts.category)))
    .orderBy(asc(parts.category));

  return (
    <AppShell
      title="Barcode labels"
      subtitle="Print a scannable label for any part — the barcode is the part's SKU, so it scans everywhere right away."
    >
      <LabelBuilder
        initial={initial}
        missingCount={missingCount}
        categories={categoryRows.map((c) => c.category!).filter(Boolean)}
      />
    </AppShell>
  );
}
