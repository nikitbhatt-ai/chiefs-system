"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Workflow-stage strip on the quote page. Posts to the same
// /api/quotes/[id]/workflow-stage endpoint the /workflow board uses, so a
// single code path owns the work-order creation, the approval gate, the
// inventory deduction (on the in_progress crossing), and the CRM sync.
// Surfaces the server's error (e.g. the approval gate or the QC gate)
// instead of failing silently — the old server action just returned, which
// looked to the user like the move had reverted.
export function QuoteWorkflowStrip({
  quoteId,
  stages,
  currentStage,
}: {
  quoteId: string;
  stages: readonly string[];
  currentStage: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyStage, setBusyStage] = useState<string | null>(null);

  async function move(stage: string) {
    if (stage === currentStage || pending) return;
    setError(null);
    setBusyStage(stage);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/workflow-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setError(body.detail ? `${body.error ?? "Move failed"}: ${body.detail}` : body.error ?? `Move rejected (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyStage(null);
    }
  }

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-2">
        Workflow stage
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-200 rounded-md px-3 py-2 text-xs font-body flex items-center justify-between mb-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300 hover:text-red-100 ml-3 shrink-0"
          >
            dismiss
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {stages.map((s, i) => {
          const active = currentStage === s;
          return (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => move(s)}
              className={`text-[11px] font-body px-3 py-1.5 rounded border transition-colors disabled:opacity-50 ${
                active
                  ? "bg-amber-500 text-black border-amber-400 font-semibold"
                  : "bg-black/40 text-zinc-300 border-white/10 hover:border-amber-500/50 hover:text-white"
              }`}
            >
              {busyStage === s ? "…" : `${i + 1}. ${s.replace(/_/g, " ")}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
