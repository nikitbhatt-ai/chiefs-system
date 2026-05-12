"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CARD_AGE_COLORS, type BucketSlug, type CardAge } from "@/lib/pipelineBuckets";

export type StageOption = { value: string; label: string };

export type KanbanCard = {
  id: string;
  customerId: string | null;
  customerName: string;
  vehicle: string | null;
  vin: string | null;
  notes: string | null;
  stage: string;
  subStatus: string | null;
  bucket: BucketSlug;
  pipelineLabel: string;
  pipelineSlug: string;
  availableStages: StageOption[];
  assignedTo: string | null;
  age: CardAge;
  daysInStage: number;
  latestActivity: { kind: string; body: string | null; createdAt: string } | null;
  openTaskCount: number;
  quotes: { id: string; quoteNumber: string | null; workflowStage: string }[];
};

type Bucket = { slug: BucketSlug; label: string; color: string; description: string };

export function KanbanBoard({
  buckets,
  cards: initialCards,
  customers,
  pipelines,
}: {
  buckets: Bucket[];
  cards: KanbanCard[];
  customers: { id: string; name: string }[];
  pipelines: { slug: string; label: string; stages: StageOption[] }[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverBucket, setHoverBucket] = useState<BucketSlug | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const cardsByBucket = new Map<BucketSlug, KanbanCard[]>();
  for (const b of buckets) cardsByBucket.set(b.slug, []);
  for (const c of cards) cardsByBucket.get(c.bucket)?.push(c);

  // POST helper that handles the guardrail override flow: on a 400 marked
  // overridable, asks the user for a manager reason; on a 400 marked
  // requiresReason (a backwards move), asks for the reason; either way
  // retries once with { override, reason }. Returns the parsed body on
  // success, or null on failure (after surfacing the error in setError).
  async function postWithOverride(
    url: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const first = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (first.ok) return first.json();
    const body = (await first.json().catch(() => ({}))) as {
      error?: string;
      overridable?: boolean;
      requiresReason?: boolean;
      backwards?: boolean;
    };
    if (!body.overridable && !body.requiresReason) {
      setError(body.error ?? `Move rejected (${first.status})`);
      return null;
    }
    const prompt = body.backwards
      ? `Moving this deal backwards: ${body.error}\n\nEnter a reason (will be logged):`
      : `${body.error}\n\nManager override — enter a reason (will be logged):`;
    const reason = window.prompt(prompt, "");
    if (!reason || !reason.trim()) {
      setError("Move cancelled — reason is required.");
      return null;
    }
    const second = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, override: !body.backwards, reason: reason.trim() }),
    });
    if (!second.ok) {
      const b2 = await second.json().catch(() => ({}));
      setError((b2 as { error?: string })?.error ?? `Override rejected (${second.status})`);
      return null;
    }
    return second.json();
  }

  async function moveBucket(cardId: string, target: BucketSlug) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.bucket === target) return;
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, bucket: target } : c)));
    setError(null);
    try {
      const body = await postWithOverride(`/api/deals/${cardId}/move-bucket`, { bucket: target });
      if (!body) {
        setCards(prev);
        return;
      }
      setCards((cs) =>
        cs.map((c) =>
          c.id === cardId ? { ...c, bucket: target, stage: (body.stage as string) ?? c.stage, daysInStage: 0, age: "fresh" } : c,
        ),
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setCards(prev);
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  async function changeStage(cardId: string, stage: string) {
    setError(null);
    const body = await postWithOverride(`/api/deals/${cardId}/stage`, { stage });
    if (!body) return false;
    startTransition(() => router.refresh());
    return true;
  }

  const openCard = cards.find((c) => c.id === openCardId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowNewDeal(true)}
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5"
        >
          + New deal
        </button>
      </div>
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
                if (id) void moveBucket(id, b.slug);
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
                      onClick={() => setOpenCardId(c.id)}
                      className={`bg-black/40 border border-white/10 rounded-md p-2 cursor-pointer hover:border-amber-400/40 text-[11px] font-body space-y-1 ${
                        draggingId === c.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white font-semibold truncate">{c.customerName}</span>
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
                      <div className="flex items-center justify-between text-[9px] text-zinc-500">
                        {c.assignedTo && (<span className="truncate">→ {c.assignedTo}</span>)}
                        {c.openTaskCount > 0 && (<span className="text-amber-300">{c.openTaskCount} task{c.openTaskCount === 1 ? "" : "s"}</span>)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openCard && (
        <DealModal
          card={openCard}
          onClose={() => setOpenCardId(null)}
          onChangeStage={async (stage) => {
            const ok = await changeStage(openCard.id, stage);
            if (ok) setOpenCardId(null);
          }}
        />
      )}
      {showNewDeal && (
        <NewDealModal
          customers={customers}
          pipelines={pipelines}
          onClose={() => setShowNewDeal(false)}
          onCreated={() => {
            setShowNewDeal(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#161624] border border-white/10 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-[#161624]">
          <h3 className="text-sm font-body font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DealModal({
  card,
  onClose,
  onChangeStage,
}: {
  card: KanbanCard;
  onClose: () => void;
  onChangeStage: (stage: string) => Promise<void>;
}) {
  const [stage, setStage] = useState(card.stage);
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell title={`${card.customerName}${card.vehicle ? ` — ${card.vehicle}` : ""}`} onClose={onClose}>
      <div className="space-y-3 text-xs font-body text-zinc-300">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pipeline" value={card.pipelineLabel} />
          <Field label="Stage" value={card.stage.replace(/_/g, " ")} />
          <Field label="Sub-status" value={card.subStatus ?? "—"} />
          <Field label="Days in stage" value={`${card.daysInStage}`} />
          <Field label="Assignee" value={card.assignedTo ?? "—"} />
          <Field label="VIN" value={card.vin ?? "—"} />
        </div>
        {card.notes && (
          <div className="border-t border-white/5 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Notes</div>
            <div className="text-zinc-200 whitespace-pre-wrap mt-1">{card.notes}</div>
          </div>
        )}
        {card.latestActivity && (
          <div className="border-t border-white/5 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Latest activity</div>
            <div className="mt-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">{card.latestActivity.kind}</span>
              <span className="text-zinc-200">{card.latestActivity.body ?? ""}</span>
              <div className="text-[10px] text-zinc-500 mt-0.5">{new Date(card.latestActivity.createdAt).toLocaleString()}</div>
            </div>
          </div>
        )}
        {card.quotes.length > 0 && (
          <div className="border-t border-white/5 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Quotes</div>
            <ul className="mt-1 space-y-1">
              {card.quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between">
                  <a href={`/quotes/${q.id}`} className="text-amber-400 hover:text-amber-300">
                    {q.quoteNumber ?? q.id.slice(0, 8)}
                  </a>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">{q.workflowStage.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="border-t border-white/5 pt-3 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Move to stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
          >
            {card.availableStages.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
          <button
            onClick={async () => {
              if (stage === card.stage) return;
              setSaving(true);
              await onChangeStage(stage);
              setSaving(false);
            }}
            disabled={saving || stage === card.stage}
            className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-1 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="border-t border-white/5 pt-3 flex items-center justify-between text-[11px]">
          <a href={`/deals/${card.id}`} className="text-amber-400 hover:text-amber-300 font-body font-semibold">
            Open full deal page →
          </a>
          {card.customerId && (
            <a href={`/crm/${card.customerId}`} className="text-zinc-400 hover:text-white font-body">
              Customer folder
            </a>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-zinc-200 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function NewDealModal({
  customers,
  pipelines,
  onClose,
  onCreated,
}: {
  customers: { id: string; name: string }[];
  pipelines: { slug: string; label: string; stages: StageOption[] }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [pipelineSlug, setPipelineSlug] = useState(pipelines[0]?.slug ?? "commercial");
  const [stage, setStage] = useState(pipelines[0]?.stages[0]?.value ?? "prospect");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pipeline = pipelines.find((p) => p.slug === pipelineSlug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || null,
          pipeline: pipelineSlug,
          stage,
          vehicleYear: vehicleYear ? Number(vehicleYear) : null,
          vehicleMake: vehicleMake || null,
          vehicleModel: vehicleModel || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.error ?? `Create failed (${res.status})`);
        return;
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="New deal" onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-body">
        {err && (<div className="md:col-span-2 bg-red-500/10 border border-red-500/40 text-red-200 rounded-md px-3 py-2">{err}</div>)}
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 md:col-span-2">
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
            <option value="">— Pick later —</option>
            {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500">
          Pipeline
          <select
            value={pipelineSlug}
            onChange={(e) => {
              setPipelineSlug(e.target.value);
              const p = pipelines.find((pp) => pp.slug === e.target.value);
              setStage(p?.stages[0]?.value ?? "prospect");
            }}
            className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
          >
            {pipelines.map((p) => (<option key={p.slug} value={p.slug}>{p.label}</option>))}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500">
          Starting stage
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
            {pipeline?.stages.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </label>
        <input placeholder="Year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
        <input placeholder="Make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
        <input placeholder="Model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="md:col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
        <textarea placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="md:col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
        <div className="md:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-[11px] text-zinc-400 hover:text-white border border-white/10 rounded px-3 py-1">Cancel</button>
          <button type="submit" disabled={submitting} className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-1 disabled:opacity-40">
            {submitting ? "Creating…" : "Create deal"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
