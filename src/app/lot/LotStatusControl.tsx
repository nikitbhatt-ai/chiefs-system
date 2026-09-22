"use client";

import { useState, useTransition } from "react";
import { setLotStatusAction } from "./actions";
import { LOT_STATUS_LABELS, LOT_STATUSES, type LotStatus } from "@/lib/lot";

// Inline status change, straight from the row. Someone walking the lot with a
// phone should not have to open a vehicle, edit it, and come back.
export function LotStatusControl({
  vehicleId,
  value,
  canEdit,
}: {
  vehicleId: string;
  value: LotStatus;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<LotStatus>(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return <StatusBadge status={current} />;

  function change(next: LotStatus) {
    const previous = current;
    // Optimistic: the row reads correctly the instant it is tapped, and rolls
    // back if the server refuses.
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const res = await setLotStatusAction(vehicleId, next);
      if (!res.ok) {
        setCurrent(previous);
        setError(res.error);
      }
    });
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value as LotStatus)}
        aria-label="Lot status"
        className={`min-h-[40px] rounded-lg border px-2.5 py-1.5 text-[12px] font-body bg-black/40 text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 ${STATUS_BORDER[current]}`}
      >
        {LOT_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-zinc-900">
            {LOT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error ? <span className="text-[10px] text-red-400 max-w-[180px]">{error}</span> : null}
    </div>
  );
}

const STATUS_BORDER: Record<LotStatus, string> = {
  on_lot_available: "border-green-500/40",
  on_lot_assigned: "border-blue-500/40",
  in_shop: "border-amber-500/40",
  departed: "border-white/10",
};

const STATUS_CHIP: Record<LotStatus, string> = {
  on_lot_available: "bg-green-500/10 text-green-300 border-green-500/30",
  on_lot_assigned: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  in_shop: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  departed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

export function StatusBadge({ status }: { status: LotStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-body whitespace-nowrap ${STATUS_CHIP[status]}`}
    >
      {LOT_STATUS_LABELS[status]}
    </span>
  );
}
