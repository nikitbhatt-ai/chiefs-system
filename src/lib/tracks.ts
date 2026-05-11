import type { PipelineDef } from "@/lib/pipelines";
import { stageLabel } from "@/lib/pipelines";
import {
  credentialStatus,
  type CredentialStatus,
} from "@/lib/credentials";

// A track is one progression in the deal's lifecycle: Sales, Credential, Build.
// Each track is rendered as a horizontal strip on the deal entity page so the
// user sees all parallel progressions at once.

export type TrackStage = {
  value: string;
  label: string;
  // Status drives the badge color when this stage is the current one.
  status?: "neutral" | "warning" | "error" | "ok";
};

export type Track = {
  slug: "sales" | "credential" | "build";
  label: string;
  description: string;
  stages: TrackStage[];
  currentValue: string;
  // If true, render in red — current stage is a blocker.
  blocked?: boolean;
};

export function salesTrack(pipeline: PipelineDef, currentStage: string): Track {
  return {
    slug: "sales",
    label: "Sales",
    description: pipeline.description,
    stages: pipeline.stages.map((s) => ({ value: s, label: stageLabel(s) })),
    currentValue: currentStage,
    blocked: currentStage === "lost",
  };
}

type CredentialLike = {
  verifiedAt: Date | null;
  expiresAt: Date | null;
};

// Reduce a set of credential rows to a single track state.
export function credentialTrack(credentials: CredentialLike[]): Track {
  const stages: TrackStage[] = [
    { value: "needed", label: "Needed" },
    { value: "pending", label: "Pending verification", status: "warning" },
    { value: "verified", label: "Verified", status: "ok" },
    { value: "expiring_soon", label: "Expiring soon", status: "warning" },
    { value: "expired", label: "Expired", status: "error" },
  ];

  let current: TrackStage["value"] = "needed";
  if (credentials.length > 0) {
    const statuses = credentials.map((c) => credentialStatus(c));
    const has = (s: CredentialStatus) => statuses.includes(s);
    if (has("verified")) current = "verified";
    else if (has("expiring_soon")) current = "expiring_soon";
    else if (has("pending")) current = "pending";
    else if (has("expired")) current = "expired";
  }

  return {
    slug: "credential",
    label: "Credential",
    description:
      "Verification status of the credential authorizing this deal.",
    stages,
    currentValue: current,
    blocked: current === "needed" || current === "pending" || current === "expired",
  };
}

export const BUILD_STAGES: TrackStage[] = [
  { value: "not_started", label: "Not started" },
  { value: "estimate", label: "Estimate" },
  { value: "confirmed", label: "Confirmed" },
  { value: "awaiting_parts", label: "Awaiting parts" },
  { value: "next_in_line", label: "Next in line" },
  { value: "in_progress", label: "In progress" },
  { value: "qc_check", label: "QC check" },
  { value: "completed", label: "Completed" },
  { value: "delivered", label: "Delivered" },
];

export function buildTrack(quoteWorkflowStage: string | null | undefined): Track {
  const current = quoteWorkflowStage && BUILD_STAGES.some((s) => s.value === quoteWorkflowStage)
    ? quoteWorkflowStage
    : "not_started";
  return {
    slug: "build",
    label: "Build",
    description: "Workshop progression from estimate through delivery.",
    stages: BUILD_STAGES,
    currentValue: current,
  };
}

// Style buckets for the track stage badges.
export const TRACK_STAGE_COLORS: Record<string, string> = {
  ok: "bg-green-500/10 text-green-300 border-green-500/30",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  error: "bg-red-500/10 text-red-300 border-red-500/30",
  neutral: "bg-zinc-500/10 text-zinc-300 border-white/10",
};
