"use client";

import { useRef, useState } from "react";
import { prepareAndUpload } from "@/lib/photoUpload";

export type CheckInPhoto = { url: string; slot: string | null; key: string };

// The six guided slots, in the order someone walks around the vehicle.
// Guided slots rather than one "upload photos" button: a labelled empty box
// is a prompt, and the set comes back consistent across every check-in.
export const PHOTO_SLOTS = [
  { slot: "front", label: "Front" },
  { slot: "rear", label: "Rear" },
  { slot: "driver_side", label: "Driver side" },
  { slot: "passenger_side", label: "Passenger side" },
  { slot: "odometer", label: "Odometer" },
  { slot: "vin_plate", label: "VIN plate" },
] as const;

type SlotState = { status: "idle" | "uploading" | "done" | "failed"; pct: number; error?: string };

export function PhotoSlots({
  vin,
  photos,
  onChange,
}: {
  vin: string;
  photos: CheckInPhoto[];
  onChange: (next: CheckInPhoto[]) => void;
}) {
  const [state, setState] = useState<Record<string, SlotState>>({});
  const damageInput = useRef<HTMLInputElement>(null);

  function setSlotState(key: string, s: Partial<SlotState>) {
    setState((prev) => {
      const base: SlotState = prev[key] ?? { status: "idle", pct: 0 };
      return { ...prev, [key]: { ...base, ...s } };
    });
  }

  async function upload(file: File, slot: string, key: string) {
    setSlotState(key, { status: "uploading", pct: 0, error: undefined });
    try {
      const { url } = await prepareAndUpload(
        file,
        `check-ins/${vin || "unknown-vin"}/${slot}`,
        (pct) => setSlotState(key, { status: "uploading", pct }),
      );
      setSlotState(key, { status: "done", pct: 100 });
      // A re-shot guided slot replaces the previous photo; damage photos stack.
      const withoutOld =
        slot === "damage" ? photos : photos.filter((p) => p.slot !== slot);
      onChange([...withoutOld, { url, slot, key }]);
    } catch (err) {
      setSlotState(key, { status: "failed", pct: 0, error: (err as Error).message });
    }
  }

  function remove(key: string) {
    onChange(photos.filter((p) => p.key !== key));
    setState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const damagePhotos = photos.filter((p) => p.slot === "damage");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {PHOTO_SLOTS.map(({ slot, label }) => {
          const existing = photos.find((p) => p.slot === slot);
          const st = state[slot] ?? { status: "idle", pct: 0 };
          return (
            <SlotTile
              key={slot}
              label={label}
              photoUrl={existing?.url}
              state={st}
              onPick={(file) => upload(file, slot, slot)}
              onRemove={existing ? () => remove(existing.key) : undefined}
            />
          );
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={() => damageInput.current?.click()}
          className="w-full min-h-[52px] rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 text-amber-300 text-sm font-body font-semibold active:bg-amber-500/15 transition-colors"
        >
          + Add damage photo
        </button>
        <input
          ref={damageInput}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.forEach((f, i) =>
              upload(f, "damage", `damage-${Date.now()}-${i}`),
            );
            e.target.value = "";
          }}
        />
        {damagePhotos.length > 0 ? (
          <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {damagePhotos.map((p) => (
              <div key={p.key} className="relative aspect-square rounded-lg overflow-hidden border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Damage" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(p.key)}
                  aria-label="Remove damage photo"
                  className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 text-white text-sm leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SlotTile({
  label,
  photoUrl,
  state,
  onPick,
  onRemove,
}: {
  label: string;
  photoUrl?: string;
  state: SlotState;
  onPick: (file: File) => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => input.current?.click()}
        // Tall enough to hit with a thumb in a glove, on gravel.
        className="w-full aspect-[4/3] min-h-[92px] rounded-lg border border-white/10 bg-black/40 overflow-hidden flex flex-col items-center justify-center gap-1 active:bg-white/5 transition-colors"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={label} className="w-full h-full object-cover" />
        ) : (
          <>
            <svg className="w-6 h-6 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" strokeLinejoin="round" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
            <span className="text-[11px] font-body text-zinc-400 px-1 text-center leading-tight">
              {label}
            </span>
          </>
        )}
        {state.status === "uploading" ? (
          <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-[11px] text-white font-body">
            {Math.round(state.pct)}%
          </span>
        ) : null}
      </button>

      {photoUrl ? (
        <>
          <span className="absolute bottom-1 left-1 text-[10px] font-body bg-black/70 text-white rounded px-1.5 py-0.5">
            {label}
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label} photo`}
            className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 text-white text-sm leading-none"
          >
            ×
          </button>
        </>
      ) : null}

      {state.status === "failed" ? (
        <p className="mt-1 text-[10px] text-red-400 leading-tight">
          {state.error ?? "Upload failed."} Tap to retry.
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the rear camera on a phone, a file picker on desktop — one
        // component, both users.
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
