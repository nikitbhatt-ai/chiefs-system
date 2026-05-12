// CRM (deal) stage -> Workflow (work order) status mapping.
//
// The DB-backed stage_mapping table is the source of truth. DEFAULT_MAPPING
// below is the seed + fallback when a row is missing (so a freshly added
// dealStage value doesn't break the sync). workflowStage === null means
// "not visible on the workflow board" — pre-shop CRM stages. The sentinel
// "archived" is used for lost / closed deals.

import { db } from "@/db";
import { stageMapping } from "@/db/schema";

export type StageMappingRow = {
  crmStage: string;
  workflowStage: string | null;
  sortOrder: number;
};

export const DEFAULT_MAPPING: StageMappingRow[] = [
  { crmStage: "prospect", workflowStage: null, sortOrder: 10 },
  { crmStage: "credential_verification", workflowStage: null, sortOrder: 20 },
  { crmStage: "quote_sent", workflowStage: "estimate", sortOrder: 30 },
  { crmStage: "po_received", workflowStage: "confirmed", sortOrder: 40 },
  { crmStage: "deposit_received", workflowStage: "confirmed", sortOrder: 50 },
  { crmStage: "in_production", workflowStage: "in_progress", sortOrder: 60 },
  { crmStage: "delivered", workflowStage: "delivered", sortOrder: 70 },
  { crmStage: "lost", workflowStage: "archived", sortOrder: 80 },
];

export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  estimate: "Estimates",
  confirmed: "Confirmed Builds",
  awaiting_parts: "Awaiting Parts",
  next_in_line: "Next In Line",
  in_progress: "In Progress",
  qc_check: "QC Check",
  completed: "Completed",
  delivered: "Delivered",
  archived: "Archived",
};

export async function loadStageMapping(): Promise<Map<string, string | null>> {
  const rows = await db.select().from(stageMapping);
  const map = new Map<string, string | null>();
  for (const d of DEFAULT_MAPPING) map.set(d.crmStage, d.workflowStage);
  for (const r of rows) map.set(r.crmStage, r.workflowStage);
  return map;
}

export function mapCrmToWorkflow(
  crmStage: string,
  mapping: Map<string, string | null>,
): string | null {
  if (mapping.has(crmStage)) return mapping.get(crmStage) ?? null;
  const def = DEFAULT_MAPPING.find((d) => d.crmStage === crmStage);
  return def?.workflowStage ?? null;
}

// Reverse: which CRM stage corresponds to a given workflow stage?
// Some workflow stages don't have a one-to-one CRM target — for example,
// awaiting_parts / next_in_line / qc_check / completed are all intermediate
// shop states that should leave the CRM stage at "in_production". The
// "confirmed" target is pipeline-dependent: government pipelines key off
// po_received, walk-in and commercial off deposit_received.
export function mapWorkflowToCrm(
  workflowStage: string,
  pipelineSlug: string | null,
): string | null {
  switch (workflowStage) {
    case "estimate":
      return "quote_sent";
    case "confirmed":
      return pipelineSlug === "government" ? "po_received" : "deposit_received";
    case "awaiting_parts":
    case "next_in_line":
    case "in_progress":
    case "qc_check":
    case "completed":
      return "in_production";
    case "delivered":
      return "delivered";
    case "archived":
      return "lost";
    default:
      return null;
  }
}
