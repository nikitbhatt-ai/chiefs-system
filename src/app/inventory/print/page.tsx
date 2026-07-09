import { and, eq, or, ilike, arrayContains, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";
import { PrintTrigger } from "../../quotes/[id]/print/PrintTrigger";
import { normalizeInventorySort, inventoryOrderBy, inventorySortLabel } from "@/lib/inventorySort";

function fmt(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pct(cost: string | null, price: string | null) {
  const c = cost ? Number(cost) : null;
  const p = price ? Number(price) : null;
  if (c == null || p == null || c <= 0 || p <= 0) return null;
  return ((p - c) / p) * 100;
}

export default async function PrintInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    vendor?: string;
    archived?: string;
    sort?: string;
    dir?: string;
    tag?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const { sort, dir } = normalizeInventorySort(sp.sort, sp.dir);
  const tag = (sp.tag ?? "").trim();
  const q = (sp.q ?? "").trim();
  const filters = [];
  if (sp.category) filters.push(eq(parts.category, sp.category));
  if (sp.vendor) filters.push(eq(parts.vendorId, sp.vendor));
  if (tag) filters.push(arrayContains(parts.tags, [tag]));
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(parts.sku, like), ilike(parts.name, like))!);
  }
  if (sp.archived === "1") filters.push(eq(parts.archived, true));
  else filters.push(eq(parts.archived, false));

  // Aliased joins mirror the list page so the export orders (and shows vendor
  // names) exactly as displayed on screen.
  const supplier = alias(vendors, "supplier_v");
  const manufacturer = alias(vendors, "manufacturer_v");
  const rows = await db
    .select({
      ...getTableColumns(parts),
      supplierName: supplier.name,
      manufacturerName: manufacturer.name,
    })
    .from(parts)
    .leftJoin(supplier, eq(parts.vendorId, supplier.id))
    .leftJoin(manufacturer, eq(parts.manufacturerId, manufacturer.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      ...inventoryOrderBy(sort, dir, {
        supplierName: supplier.name,
        manufacturerName: manufacturer.name,
      }),
    );

  let vendorLabel = sp.vendor ?? "";
  if (sp.vendor) {
    const [v] = await db
      .select({ name: vendors.name })
      .from(vendors)
      .where(eq(vendors.id, sp.vendor));
    vendorLabel = v?.name ?? sp.vendor;
  }

  let totalOnHandValue = 0;
  for (const p of rows) {
    if (p.cost) totalOnHandValue += p.quantityOnHand * Number(p.cost);
  }

  const filterLabels: string[] = [];
  if (q) filterLabels.push(`Search: "${q}"`);
  if (sp.category) filterLabels.push(`Category: ${sp.category}`);
  if (sp.vendor) filterLabels.push(`Vendor: ${vendorLabel}`);
  if (tag) filterLabels.push(`Tag: ${tag}`);
  if (sp.archived === "1") filterLabels.push("Archived only");

  return (
    <div className="print-doc">
      <PrintTrigger />
      <style>{`
        body { background: white; }
        .print-doc {
          font-family: "Times New Roman", Times, serif;
          font-size: 11pt;
          color: #000;
          background: #fff;
          padding: 0.5in;
          max-width: 11in;
          margin: 0 auto;
        }
        .print-doc h1 { font-size: 18pt; margin: 0; }
        .print-doc table { width: 100%; border-collapse: collapse; }
        .print-doc th, .print-doc td {
          border: 1px solid #000;
          padding: 4pt 6pt;
          text-align: left;
          font-size: 10pt;
        }
        .print-doc th { background: #eee; font-weight: bold; }
        .print-doc .right { text-align: right; }
        .print-doc .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16pt;
          border-bottom: 2pt solid #000;
          padding-bottom: 8pt;
        }
        .print-doc .meta { font-size: 10pt; color: #444; }
        .print-doc .actions { margin-bottom: 12pt; }
        @media print {
          .print-doc .actions { display: none; }
          @page { size: letter landscape; margin: 0.4in; }
        }
        .print-doc button, .print-doc a.btn {
          font-family: "Times New Roman", Times, serif;
          font-size: 11pt;
          padding: 4pt 10pt;
          border: 1px solid #000;
          background: #fff;
          color: #000;
          cursor: pointer;
          text-decoration: none;
          margin-right: 6pt;
        }
      `}</style>

      <div className="actions">
        <button type="button" id="__print">Print</button>
        <a href="/inventory" className="btn">Back to inventory</a>
        <span style={{ fontSize: "10pt", color: "#666", marginLeft: "12pt" }}>
          Browser print dialog → choose &ldquo;Save as PDF&rdquo;.
        </span>
      </div>

      <div className="header">
        <div>
          <h1>Chiefs Pursuit Surplus</h1>
          <div className="meta">Inventory Report</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="meta">Generated: {new Date().toLocaleString()}</div>
          <div className="meta">Items: {rows.length}</div>
          <div className="meta">
            On-hand cost value: {fmt(totalOnHandValue.toFixed(2))}
          </div>
        </div>
      </div>

      {filterLabels.length > 0 ? (
        <div style={{ marginBottom: "10pt", fontSize: "10pt" }}>
          <strong>Filters:</strong> {filterLabels.join(" · ")}
        </div>
      ) : null}

      <div style={{ marginBottom: "10pt", fontSize: "10pt" }}>
        <strong>Sorted by:</strong> {inventorySortLabel(sort, dir)}
      </div>

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Category</th>
            <th>Manufacturer</th>
            <th>Supplier</th>
            <th className="right">On hand</th>
            <th className="right">On order</th>
            <th className="right">Internal cost</th>
            <th className="right">Price</th>
            <th className="right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ textAlign: "center", color: "#666" }}>
                No parts in current filter.
              </td>
            </tr>
          ) : (
            rows.map((p) => {
              const margin = pct(p.cost, p.price);
              return (
                <tr key={p.id}>
                  <td style={{ fontFamily: "monospace" }}>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category ?? "—"}</td>
                  <td>{p.manufacturerName ?? "—"}</td>
                  <td>{p.supplierName ?? "—"}</td>
                  <td className="right">{p.quantityOnHand}</td>
                  <td className="right">{p.quantityOnOrder}</td>
                  <td className="right">{fmt(p.cost)}</td>
                  <td className="right">{fmt(p.price)}</td>
                  <td className="right">
                    {margin != null ? `${margin.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div style={{ marginTop: "20pt", fontSize: "9pt", color: "#666", textAlign: "center" }}>
        Generated by Chiefs Pursuit Surplus ERP
      </div>
    </div>
  );
}
