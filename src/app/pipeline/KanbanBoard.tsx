"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CARD_AGE_COLORS, type BucketSlug, type CardAge } from "@/lib/pipelineBuckets";

export type KanbanCard = {
  id: string;
  customerId: string | null;
  customerName: string;
  vehicle: string | null;
  stage: string;
  subStatus: string | null;
  bucket: BucketSlug;
  pipelineLabel: string;
  pipelineSlug: string;
  assignedTo: string | null;
  age: CardAge;
  daysInStage: number;
};

type Bucket = { slug: BucketSlug; label: string; color: string; description: string };

export function KanbanBoard({
  buckets,
  cards: initialCards,
}: {
  buckets: Bucket[];
  cards: KanbanCard[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverBucket, setHoverBucket] = useState<BucketSlug | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const cardsByBucket = new Map<BucketSlug, KanbanCard[]>();
  for (const b of buckets) cardsByBucket.set(b.slug, []);
  for (const c of cards) cardsByBucket.get(c.bucket)?.push(c);

  async function move(cardId: string, target: BucketSlug) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.bucket === target) return;
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, bucket: target } : c)));
    setError(null);
    try {
      const res = await fetch(`/api/deals/${cardId}/move-bucket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCards(prev);
        setError(body?.error ?? `Move rejected (${res.status})`);
        return;
      }
      const body = await res.json();
      setCards((cs) =>
        cs.map((c) => (c.id === cardId ? { ...c, bucket: target, stage: body.stage ?? c.stage, daysInStage: 0, age: "fresh" } : c)),
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setCards(prev);
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-200 rounded-md px-3 py-2 text-xs font-body">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-300 hover:text-white">dismiss</button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-2 overflow-x-auto pb-2">
        {buckets.map((b) => {
          const bucketCards = cardsByBucket.get(b.slug) ?? [];
          const isHover = hoverBucket === b.slug;
          return (
            <div
              key={b.slug}
              onDragOver={(e) => {
                e.preventDefault();
                setHoverBucket(b.slug);
              }}
              onDragLeave={() => setHoverBucket((h) => (h === b.slug ? null : h))}
              onDrop={(e) => {
                e.preventDefault();
                setHoverBucket(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) void move(id, b.slug);
              }}
              className={`bg-[#161624] border rounded-lg p-2 min-h-[200px] transition-colors ${
                isHover ? "border-amber-400/60 bg-amber-500/5" : "border-white/5"
              }`}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <span className={`inline-block text-[10px] uppercase tracking-wider font-body font-semibold rounded border px-2 py-0.5 ${b.color}`}>
                  {b.label}
                </span>
                <span className="text-[10px] text-zinc-500 font-body">{bucketCards.length}</span>
              </div>
              <div className="space-y-1.5">
                {bucketCards.length === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-body px-1">—</p>
                ) : (
                  bucketCards.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(c.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      className={`bg-black/40 border border-white/10 rounded-md p-2 cursor-grab active:cursor-grabbing text-[11px] font-body space-y-1 ${
                        draggingId === c.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <a href={`/deals/${c.id}`} className="text-white font-semibold hover:text-amber-300 truncate">
                          {c.customerName}
                        </a>
                        <span className={`text-[9px] uppercase tracking-wider rounded border px-1.5 py-0.5 whitespace-nowrap ${CARD_AGE_COLORS[c.age]}`}>
                          {c.daysInStage}d
                        </span>
                      </div>
                      {c.vehicle && (<div className="text-zinc-400 truncate">{c.vehicle}</div>)}
                      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-zinc-500">
                        <span>{c.pipelineLabel}</span>
                        <span>{c.stage.replace(/_/g, " ")}</span>
                      </div>
                      {c.subStatus && (
                        <div className="text-[10px] text-amber-300 italic truncate">{c.subStatus}</div>
                      )}
                      {c.assignedTo && (
                        <div className="text-[10px] text-zinc-500 truncate">→ {c.assignedTo}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
