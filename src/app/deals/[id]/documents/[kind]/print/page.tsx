import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers } from "@/db/schema";
import { PIPELINE_DOCUMENTS } from "@/lib/documentTemplates";
import { getPipeline } from "@/lib/pipelines";
import { PrintTrigger } from "./PrintTrigger";

export const dynamic = "force-dynamic";

export default async function PrintDocPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind } = await params;
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) notFound();

  const pipeline = getPipeline(d.pipeline);
  const docSpec = PIPELINE_DOCUMENTS[pipeline.slug];
  if (!docSpec) notFound();

  // Allow either the bare doc suffix or the full kind slug in the URL.
  const expectedSuffix = docSpec.slug.replace(/^pipeline_doc:/, "");
  if (kind !== expectedSuffix && kind !== docSpec.slug) notFound();

  const customer = d.customerId
    ? (await db.select().from(customers).where(eq(customers.id, d.customerId)))[0]
    : null;

  return (
    <div className="print-doc">
      <PrintTrigger />
      <button
        id="__print"
        className="no-print fixed top-4 right-4 bg-black text-white rounded px-4 py-2 text-sm"
      >
        Print / Save as PDF
      </button>
      <style>{`
        @page { size: letter; margin: 0.75in; }
        body, .print-doc { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; background: #fff; }
        .print-doc { padding: 0.5in; max-width: 8.5in; margin: 0 auto; }
        .print-doc h1 { font-size: 18pt; margin: 0 0 4pt 0; }
        .print-doc h2 { font-size: 14pt; margin: 16pt 0 6pt 0; border-bottom: 1px solid #000; padding-bottom: 2pt; }
        .print-doc .meta { font-size: 10pt; color: #444; }
        .print-doc table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
        .print-doc td { padding: 6pt 4pt; vertical-align: top; }
        .print-doc td.label { width: 40%; font-weight: bold; }
        .print-doc td.value { border-bottom: 1px solid #000; min-height: 14pt; }
        .print-doc .intro { margin: 8pt 0 12pt 0; }
        .print-doc .sig { margin-top: 36pt; }
        .print-doc .sig-row { display: flex; gap: 24pt; margin-top: 24pt; }
        .print-doc .sig-row > div { flex: 1; border-top: 1px solid #000; padding-top: 4pt; font-size: 10pt; }
        .no-print { display: block; }
        @media print { .no-print { display: none !important; } }
      `}</style>

      <h1>{docSpec.label}</h1>
      <div className="meta">
        {pipeline.label} pipeline · Deal {d.id.slice(0, 8)} · Generated {new Date().toLocaleDateString()}
      </div>

      <p className="intro">{docSpec.intro}</p>

      <h2>Deal</h2>
      <table>
        <tbody>
          <tr><td className="label">Customer</td><td className="value">{customer?.name ?? "—"}</td></tr>
          <tr><td className="label">Vehicle</td><td className="value">{[d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || "—"}</td></tr>
          <tr><td className="label">VIN</td><td className="value">{d.vin ?? "—"}</td></tr>
          <tr><td className="label">Sales Rep</td><td className="value">{d.salesRep ?? "—"}</td></tr>
        </tbody>
      </table>

      <h2>{docSpec.label} Details</h2>
      <table>
        <tbody>
          {docSpec.fields.map((f) => (
            <tr key={f.name}>
              <td className="label">
                {f.label}
                {f.required ? " *" : ""}
              </td>
              <td className="value" style={f.textarea ? { minHeight: "60pt" } : undefined}>
                &nbsp;
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sig">
        <div className="sig-row">
          <div>Customer signature / date</div>
          <div>Authorized representative / date</div>
        </div>
      </div>
    </div>
  );
}
