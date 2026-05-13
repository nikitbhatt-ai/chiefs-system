"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type WorkflowStage = {
  key: string;
  label: string;
  index: number;
};

export type WorkflowCard = {
  id: string;
  quoteNumber: string | null;
  status: string;
  workflowStage: string;
  notes: string | null;
  customerName: string | null;
  vehicle: string | null;
  grandTotal: string | null;
  dealId: string | null;
  crmStage: string | null;
  crmStageColor: string | null;
};

type Props = {
  stages: WorkflowStage[];
  cards: WorkflowCard[];
};

function fmtMoney(v: string | null) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function WorkflowBoard({ stages, cards: initialCards }: Props) {
  const [cards, setCards] = useState(initialCards);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const cardsByStage = new Map<string, WorkflowCard[]>();
  for (const s of stages) cardsByStage.set(s.key, []);
  for (const c of cards) {
    const key = stages.some((s) => s.key === c.workflowStage) ? c.workflowStage : "estimate";
    cardsByStage.get(key)?.push(c);
  }

  async function moveTo(cardId: string, targetStage: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.workflowStage === targetStage) return;
    const prev = cards;
    // Optimistic update
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, workflowStage: targetStage } : c)));
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${cardId}/workflow-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: targetStage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCards(prev);
        const b = body as { error?: string; detail?: string };
        const msg = b.detail ? `${b.error ?? "Move failed"}: ${b.detail}` : b.error ?? `Move rejected (${res.status})`;
        setError(msg);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setCards(prev);
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-200 rounded-md px-3 py-2 text-xs font-body flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100">dismiss</button>
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const items = cardsByStage.get(stage.key) ?? [];
          const isHover = hoverStage === stage.key;
          return (
            <div
              key={stage.key}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverStage !== stage.key) setHoverStage(stage.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (hoverStage === stage.key) setHoverStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || draggingId;
                setHoverStage(null);
                setDraggingId(null);
                if (id) moveTo(id, stage.key);
              }}
              className={`min-w-[260px] w-[260px] rounded-lg flex-shrink-0 transition-colors border ${
                isHover
                  ? "bg-amber-500/10 border-amber-500/40"
                  : "bg-[#0f0f1a] border-white/5"
              }`}
            >
              <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="text-[11px] font-body font-semibold text-zinc-300">
                  <span className="text-zinc-500 mr-1">{stage.index}.</span>
                  {stage.label}
                </div>
                <span className="text-[10px] text-zinc-500 bg-white/5 rounded px-1.5 py-0.5">
                  {items.length}
                </span>
              </div>
              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="text-[11px] text-zinc-600 text-center py-6 font-body">
                    {isHover ? "Drop here" : "Empty"}
                  </div>
                ) : (
                  items.map((q) => {
                    const isDragging = draggingId === q.id;
                    return (
                      <div
                        key={q.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", q.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(q.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setHoverStage(null);
                        }}
                        className={`bg-[#161624] border rounded-md p-2.5 space-y-1.5 cursor-grab active:cursor-grabbing ${
                          isDragging ? "opacity-40 border-amber-500/40" : "border-white/10 hover:border-amber-500/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <a
                            href={`/quotes/${q.id}`}
                            className="text-[10px] font-mono text-amber-400 hover:text-amber-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {q.quoteNumber ?? `Q-${q.id.slice(0, 6)}`}
                          </a>
                          <span className="text-[9px] uppercase tracking-wider text-zinc-400 bg-white/5 rounded px-1.5">
                            {q.status}
                          </span>
                        </div>
                        {q.customerName ? (
                          <div className="text-xs text-white font-body font-semibold line-clamp-1">{q.customerName}</div>
                        ) : (
                          <div className="text-xs text-zinc-500 italic font-body">No customer linked</div>
                        )}
                        {q.notes ? (
                          <div className="text-[11px] text-zinc-300 font-body line-clamp-2">{q.notes}</div>
                        ) : null}
                        {q.dealId && q.crmStage ? (
                          <a
                            href={`/deals/${q.dealId}`}
                            onClick={(e) => e.stopPropagation()}
                            className={`inline-block text-[9px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${
                              q.crmStageColor ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                            } hover:opacity-80`}
                            title="CRM stage — click to open deal"
                          >
                            CRM · {q.crmStage.replace(/_/g, " ")}
                          </a>
                        ) : null}
                        {q.vehicle ? (
                          <div className="text-[10px] text-zinc-500 font-mono">{q.vehicle}</div>
                        ) : null}
                        <div className="flex items-center justify-between pt-1 gap-2">
                          <span className="text-[11px] font-body font-semibold text-green-400">
                            {fmtMoney(q.grandTotal) ?? "—"}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-zinc-600">drag to move</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-600 font-body">
        Drag a card to a different column to advance or back-step the build. Updates are server-side and trigger the CRM sync automatically.
      </p>
    </div>
  );
}
