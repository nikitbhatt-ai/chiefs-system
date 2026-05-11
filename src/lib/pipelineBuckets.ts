import type { DealStage, PipelineSlug } from "@/lib/pipelines";

// Layer 1 of the pipeline UI: seven high-level buckets. Each pipeline stage
// from src/lib/pipelines.ts maps to exactly one bucket (or none, for "lost").
// Buckets are the columns of the kanban view at /pipeline.

export type BucketSlug =
  | "lead"
  | "discovery"
  | "proposal"
  | "won"
  | "build"
  | "delivery"
  | "post_sale";

export const PIPELINE_BUCKETS: { slug: BucketSlug; label: string; color: string; description: string }[] = [
  { slug: "lead", label: "Lead", color: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30", description: "Prospect / new contact" },
  { slug: "discovery", label: "Discovery", color: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30", description: "Qualification / credentialing" },
  { slug: "proposal", label: "Proposal", color: "bg-blue-500/10 text-blue-300 border-blue-500/30", description: "Quote sent to customer" },
  { slug: "won", label: "Won", color: "bg-amber-500/10 text-amber-300 border-amber-500/30", description: "PO or deposit received" },
  { slug: "build", label: "Build", color: "bg-purple-500/10 text-purple-300 border-purple-500/30", description: "In production" },
  { slug: "delivery", label: "Delivery", color: "bg-green-500/10 text-green-300 border-green-500/30", description: "Delivered to customer" },
  { slug: "post_sale", label: "Post-Sale", color: "bg-teal-500/10 text-teal-300 border-teal-500/30", description: "Follow-up & warranty" },
];

const STAGE_TO_BUCKET: Record<DealStage, BucketSlug | null> = {
  prospect: "lead",
  credential_verification: "discovery",
  quote_sent: "proposal",
  po_received: "won",
  deposit_received: "won",
  in_production: "build",
  delivered: "delivery",
  lost: null,
};

export function bucketForStage(stage: string): BucketSlug | null {
  return STAGE_TO_BUCKET[stage as DealStage] ?? null;
}

// Each (pipeline, bucket) maps to a single stage (or null if the pipeline
// doesn't have that bucket — e.g. commercial has no discovery stage).
// Used when the kanban DnD drops a card onto a bucket: we need to know
// which stage to advance to.
const PIPELINE_BUCKET_STAGE: Record<PipelineSlug, Record<BucketSlug, DealStage | null>> = {
  government: {
    lead: "prospect",
    discovery: null,
    proposal: "quote_sent",
    won: "po_received",
    build: "in_production",
    delivery: "delivered",
    post_sale: null,
  },
  walk_in_credentialed: {
    lead: "prospect",
    discovery: "credential_verification",
    proposal: "quote_sent",
    won: "deposit_received",
    build: "in_production",
    delivery: "delivered",
    post_sale: null,
  },
  commercial: {
    lead: "prospect",
    discovery: null,
    proposal: "quote_sent",
    won: "deposit_received",
    build: "in_production",
    delivery: "delivered",
    post_sale: null,
  },
};

export function stageForBucket(pipelineSlug: string | null | undefined, bucket: BucketSlug): DealStage | null {
  if (!pipelineSlug) return null;
  const map = PIPELINE_BUCKET_STAGE[pipelineSlug as PipelineSlug];
  return map ? map[bucket] : null;
}

// Hard-coded fallback SLA defaults per bucket. Database
// `pipeline_stage_sla` rows override these per (pipeline, stage).
export const DEFAULT_BUCKET_SLA: Record<BucketSlug, { warningDays: number; overdueDays: number }> = {
  lead: { warningDays: 3, overdueDays: 7 },
  discovery: { warningDays: 5, overdueDays: 10 },
  proposal: { warningDays: 7, overdueDays: 14 },
  won: { warningDays: 3, overdueDays: 7 },
  build: { warningDays: 14, overdueDays: 30 },
  delivery: { warningDays: 5, overdueDays: 10 },
  post_sale: { warningDays: 30, overdueDays: 90 },
};

export type CardAge = "fresh" | "warning" | "overdue";

export function cardAge(
  enteredAt: Date | null,
  thresholds: { warningDays: number; overdueDays: number },
  now: Date = new Date(),
): CardAge {
  if (!enteredAt) return "fresh";
  const days = (now.getTime() - new Date(enteredAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days >= thresholds.overdueDays) return "overdue";
  if (days >= thresholds.warningDays) return "warning";
  return "fresh";
}

export const CARD_AGE_COLORS: Record<CardAge, string> = {
  fresh: "bg-green-500/10 text-green-300 border-green-500/30",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  overdue: "bg-red-500/10 text-red-300 border-red-500/30",
};
