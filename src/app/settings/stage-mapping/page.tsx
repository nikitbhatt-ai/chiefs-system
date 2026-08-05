import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { stageMapping } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { DEFAULT_MAPPING, WORKFLOW_STAGE_LABELS } from "@/lib/stageMapping";
import { stageLabel } from "@/lib/pipelines";

export const dynamic = "force-dynamic";

const WORKFLOW_STAGE_OPTIONS = [
  { value: "", label: "(none — pre-shop)" },
  { value: "estimate", label: "Estimates" },
  { value: "confirmed", label: "Confirmed Builds" },
  { value: "awaiting_parts", label: "Awaiting Parts" },
  { value: "next_in_line", label: "Next In Line" },
  { value: "in_progress", label: "In Progress" },
  { value: "qc_check", label: "QC Check" },
  { value: "completed", label: "Completed" },
  { value: "delivered", label: "Delivered" },
  { value: "archived", label: "Archived" },
];

export default async function StageMappingPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const rows = await db.select().from(stageMapping);
  const dbMap = new Map(rows.map((r) => [r.crmStage, r]));

  // Render one row per default CRM stage; admin can override workflow target
  // or sort order. A row missing from the DB falls back to its default and
  // is upserted on save.
  const display = DEFAULT_MAPPING.map((d) => {
    const r = dbMap.get(d.crmStage);
    return {
      crmStage: d.crmStage,
      workflowStage: r?.workflowStage ?? d.workflowStage,
      sortOrder: r?.sortOrder ?? d.sortOrder,
    };
  });

  async function save(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    for (const d of DEFAULT_MAPPING) {
      const raw = String(formData.get(`workflow_${d.crmStage}`) ?? "").trim();
      const sortRaw = String(formData.get(`sort_${d.crmStage}`) ?? "").trim();
      const wf = raw === "" ? null : raw;
      const sortOrder = Number(sortRaw) || d.sortOrder;
      const [existing] = await db.select().from(stageMapping).where(eq(stageMapping.crmStage, d.crmStage));
      if (existing) {
        await db
          .update(stageMapping)
          .set({ workflowStage: wf, sortOrder, updatedAt: new Date() })
          .where(eq(stageMapping.crmStage, d.crmStage));
      } else {
        await db.insert(stageMapping).values({ crmStage: d.crmStage, workflowStage: wf, sortOrder });
      }
    }
    revalidatePath("/settings/stage-mapping");
  }

  return (
    <AppShell title="Stage mapping" subtitle="CRM stage → Workflow stage routing">
      <form action={save} className="bg-surface border border-white/5 rounded-lg p-4 space-y-3 max-w-3xl">
        <p className="text-[11px] text-zinc-400 font-body">
          The workflow board is filtered by these targets. A CRM stage with no
          workflow target is pre-shop (won&apos;t appear in /workflow). Use the
          sentinel <span className="font-mono text-zinc-300">archived</span>{" "}
          for lost deals so they drop off the active board but stay auditable.
        </p>
        <table className="w-full text-xs font-body">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/5">
              <th className="text-left py-1.5">CRM stage</th>
              <th className="text-left py-1.5">Workflow target</th>
              <th className="text-left py-1.5 w-20">Sort</th>
            </tr>
          </thead>
          <tbody>
            {display.map((row) => (
              <tr key={row.crmStage} className="border-b border-white/5">
                <td className="py-1.5 text-white">
                  <span className="font-mono text-[10px] text-zinc-500 mr-2">{row.crmStage}</span>
                  {stageLabel(row.crmStage)}
                </td>
                <td className="py-1.5">
                  <select
                    name={`workflow_${row.crmStage}`}
                    defaultValue={row.workflowStage ?? ""}
                    className="bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-white"
                  >
                    {WORKFLOW_STAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {row.workflowStage && (
                    <span className="ml-2 text-[10px] text-zinc-500">
                      → {WORKFLOW_STAGE_LABELS[row.workflowStage] ?? row.workflowStage}
                    </span>
                  )}
                </td>
                <td className="py-1.5">
                  <input
                    name={`sort_${row.crmStage}`}
                    type="number"
                    defaultValue={row.sortOrder}
                    className="bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-white w-16"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">
          Save mapping
        </button>
      </form>
    </AppShell>
  );
}
