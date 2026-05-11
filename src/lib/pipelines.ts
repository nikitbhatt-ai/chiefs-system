export type PipelineSlug = "government" | "walk_in_credentialed" | "commercial";

export type DealStage =
  | "prospect"
  | "credential_verification"
  | "quote_sent"
  | "po_received"
  | "deposit_received"
  | "in_production"
  | "delivered"
  | "lost";

export type PipelineDef = {
  slug: PipelineSlug;
  label: string;
  description: string;
  stages: DealStage[];
  procurementGate: DealStage;
  hardGate: DealStage | null;
};

export const PIPELINES: Record<PipelineSlug, PipelineDef> = {
  government: {
    slug: "government",
    label: "Government",
    description:
      "Procurement-driven. Requires a PO before any parts can be ordered or work begun.",
    stages: [
      "prospect",
      "quote_sent",
      "po_received",
      "in_production",
      "delivered",
      "lost",
    ],
    procurementGate: "po_received",
    hardGate: null,
  },
  walk_in_credentialed: {
    slug: "walk_in_credentialed",
    label: "Walk-In Credentialed",
    description:
      "Credential verification is a hard gate before any advancement. Restricted-equipment flagging applies.",
    stages: [
      "prospect",
      "credential_verification",
      "quote_sent",
      "deposit_received",
      "in_production",
      "delivered",
      "lost",
    ],
    procurementGate: "deposit_received",
    hardGate: "credential_verification",
  },
  commercial: {
    slug: "commercial",
    label: "Commercial",
    description:
      "Simpler deposit-based flow. Deposit required before parts are procured.",
    stages: [
      "prospect",
      "quote_sent",
      "deposit_received",
      "in_production",
      "delivered",
      "lost",
    ],
    procurementGate: "deposit_received",
    hardGate: null,
  },
};

export const PIPELINE_SLUGS = Object.keys(PIPELINES) as PipelineSlug[];

export function isPipelineSlug(s: string | null | undefined): s is PipelineSlug {
  return !!s && s in PIPELINES;
}

export function getPipeline(slug: string | null | undefined): PipelineDef {
  return isPipelineSlug(slug) ? PIPELINES[slug] : PIPELINES.commercial;
}

export function stagesFor(slug: string | null | undefined): DealStage[] {
  return getPipeline(slug).stages;
}

export function stageLabel(stage: string): string {
  return stage
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export type StageTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

// Maps a customer_type value to the pipeline that drives it. Retail is treated
// as commercial; walk-ins that need credentialing should be set to
// walk_in_credentialed at lead creation.
export function pipelineForCustomerType(
  type: string | null | undefined,
): PipelineSlug {
  if (type === "government") return "government";
  if (type === "walk_in_credentialed") return "walk_in_credentialed";
  return "commercial";
}

export function canAdvanceTo(
  pipelineSlug: string | null | undefined,
  fromStage: string,
  toStage: string,
): StageTransitionResult {
  const pipeline = getPipeline(pipelineSlug);

  if (toStage === "lost") return { ok: true };

  if (!pipeline.stages.includes(toStage as DealStage)) {
    return {
      ok: false,
      reason: `"${stageLabel(toStage)}" is not a valid stage for the ${pipeline.label} pipeline.`,
    };
  }

  if (fromStage === toStage) return { ok: true };

  const fromIdx = pipeline.stages.indexOf(fromStage as DealStage);
  const toIdx = pipeline.stages.indexOf(toStage as DealStage);

  if (fromIdx < 0) {
    return {
      ok: false,
      reason: `Current stage "${stageLabel(fromStage)}" is not part of the ${pipeline.label} pipeline.`,
    };
  }

  if (toIdx > fromIdx + 1) {
    const skipped = pipeline.stages
      .slice(fromIdx + 1, toIdx)
      .map(stageLabel)
      .join(", ");
    return {
      ok: false,
      reason: `Cannot skip ${skipped}. Advance one stage at a time in the ${pipeline.label} pipeline.`,
    };
  }

  return { ok: true };
}

export const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  credential_verification:
    "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  quote_sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  po_received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  deposit_received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_production: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  delivered: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
};
