import { desc, gte, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { partReceipts, purchaseOrders, parts, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { rollupVarianceByVendor, type VarianceSample } from "@/lib/procurement";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { slug: "90", label: "90 days", days: 90 },
  { slug: "365", label: "365 days", days: 365 },
  { slug: "all", label: "All-time", days: null },
] as const;

type WindowSlug = (typeof WINDOWS)[number]["slug"];

function isWindowSlug(v: string): v is WindowSlug {
  return WINDOWS.some((w) => w.slug === v);
}

export default async function VendorLeadTimesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const params = await searchParams;
  const windowSlug: WindowSlug = isWindowSlug(params.window ?? "") ? (params.window as WindowSlug) : "365";
  const windowDef = WINDOWS.find((w) => w.slug === windowSlug)!;
  const since = windowDef.days ? new Date(Date.now() - windowDef.days * 24 * 60 * 60 * 1000) : null;

  // Each receipt = one delivered shipment of one part on one PO. Variance =
  // (received_at - po.created_at) days minus the part's quoted lead time.
  // Receipts whose PO is missing (purchase_order_id was nulled) are
  // skipped; we have nothing to compare against.
  const receipts = await db
    .select()
    .from(partReceipts)
    .where(since ? gte(partReceipts.receivedAt, since) : undefined as never)
    .orderBy(desc(partReceipts.receivedAt));

  const poIds = Array.from(new Set(receipts.map((r) => r.purchaseOrderId).filter(Boolean) as string[]));
  const partIds = Array.from(new Set(receipts.map((r) => r.partId)));

  const [poRows, partRows] = await Promise.all([
    poIds.length
      ? db.select({ id: purchaseOrders.id, createdAt: purchaseOrders.createdAt, vendorId: purchaseOrders.vendorId }).from(purchaseOrders).where(inArray(purchaseOrders.id, poIds))
      : Promise.resolve([] as { id: string; createdAt: Date; vendorId: string | null }[]),
    partIds.length
      ? db.select({ id: parts.id, name: parts.name, sku: parts.sku, leadTimeDays: parts.leadTimeDays }).from(parts).where(inArray(parts.id, partIds))
      : Promise.resolve([] as { id: string; name: string; sku: string | null; leadTimeDays: number }[]),
  ]);
  const poMap = new Map(poRows.map((r) => [r.id, r]));
  const partMap = new Map(partRows.map((r) => [r.id, r]));

  const vendorIds = Array.from(new Set(poRows.map((p) => p.vendorId).filter(Boolean) as string[]));
  const vendorRows = vendorIds.length
    ? await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, vendorIds))
    : [];
  const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]));

  const samples: VarianceSample[] = [];
  for (const r of receipts) {
    if (!r.purchaseOrderId) continue;
    const po = poMap.get(r.purchaseOrderId);
    if (!po) continue;
    const part = partMap.get(r.partId);
    if (!part) continue;
    const actualMs = r.receivedAt.getTime() - po.createdAt.getTime();
    const actualDays = actualMs / (24 * 60 * 60 * 1000);
    const variance = actualDays - part.leadTimeDays;
    samples.push({
      vendorId: po.vendorId,
      vendorName: po.vendorId ? vendorMap.get(po.vendorId) ?? null : null,
      partId: part.id,
      partName: part.name,
      quotedLeadDays: part.leadTimeDays,
      actualLeadDays: actualDays,
      variance,
      receivedAt: r.receivedAt,
    });
  }

  const rollup = rollupVarianceByVendor(samples);

  return (
    <AppShell title="Reporting · Vendor lead times" subtitle={`${samples.length} receipts · window ${windowDef.label}`}>
      <div className="flex gap-2 flex-wrap">
        {WINDOWS.map((w) => (
          <a
            key={w.slug}
            href={`/reporting/vendor-lead-times?window=${w.slug}`}
            className={`text-[11px] font-body px-3 py-1.5 rounded-md border ${
              windowSlug === w.slug
                ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                : "border-white/10 text-zinc-400 hover:text-white"
            }`}
          >
            {w.label}
          </a>
        ))}
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-3 py-2 border-b border-white/5">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">By vendor</h3>
          <p className="text-[10px] text-zinc-500 font-body mt-0.5">
            Variance = actual delivery days − parts.lead_time_days. Positive = vendor delivered slower than quoted; negative = faster.
          </p>
        </div>
        <table className="w-full text-xs font-body">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2 text-right">Samples</th>
              <th className="px-3 py-2 text-right">Avg quoted</th>
              <th className="px-3 py-2 text-right">Avg actual</th>
              <th className="px-3 py-2 text-right">Avg variance</th>
              <th className="px-3 py-2 text-right">Worst</th>
            </tr>
          </thead>
          <tbody>
            {rollup.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No receipts in this window. The variance learner needs received POs with linked parts to compute anything.
                </td>
              </tr>
            ) : (
              rollup.map((r) => (
                <tr key={r.vendorId ?? "unset"} className="border-t border-white/5">
                  <td className="px-3 py-2 text-white">{r.vendorName ?? <span className="text-zinc-500">(vendor unset)</span>}</td>
                  <td className="px-3 py-2 text-right text-zinc-200">{r.samples}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.avgQuoted.toFixed(1)}d</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.avgActual.toFixed(1)}d</td>
                  <td className={`px-3 py-2 text-right ${r.avgVariance > 0 ? "text-red-300" : r.avgVariance < 0 ? "text-green-300" : "text-zinc-300"}`}>
                    {r.avgVariance > 0 ? "+" : ""}{r.avgVariance.toFixed(1)}d
                  </td>
                  <td className={`px-3 py-2 text-right ${r.worstVariance > 0 ? "text-red-300" : "text-zinc-300"}`}>
                    {r.worstVariance > 0 ? "+" : ""}{r.worstVariance.toFixed(1)}d
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
