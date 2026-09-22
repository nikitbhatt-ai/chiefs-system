"use client";

import { useCallback, useRef, useState } from "react";
import { prepareAndUpload } from "@/lib/photoUpload";
import { createSerialQueue } from "@/lib/serialQueue";

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

export type UploadStatus = "idle" | "pending" | "uploading" | "done" | "failed";

type SlotState = {
  status: UploadStatus;
  pct: number;
  error?: string;
  // The original File is kept so Retry re-sends THIS photo. Without it the
  // only recovery would be walking back to the vehicle and shooting it again.
  file?: File;
  label?: string;
};

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

  // One upload at a time. On a lot with one bar, six parallel uploads all
  // crawl and any of them can time out; serialised, each gets the whole pipe
  // and a failure is isolated to its own slot. See src/lib/serialQueue.ts.
  const enqueue = useRef(createSerialQueue()).current;

  const setSlotState = useCallback((key: string, s: Partial<SlotState>) => {
    setState((prev) => {
      const base: SlotState = prev[key] ?? { status: "idle", pct: 0 };
      return { ...prev, [key]: { ...base, ...s } };
    });
  }, []);

  // `photos` is read through a ref inside the queued task so a task that ran
  // while an earlier one finished still sees the current list.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const run = useCallback(
    (file: File, slot: string, key: string, label: string) => {
      setSlotState(key, { status: "pending", pct: 0, error: undefined, file, label });

      const task = async () => {
        setSlotState(key, { status: "uploading", pct: 0 });
        try {
          const { url } = await prepareAndUpload(
            file,
            `check-ins/${vin || "unknown-vin"}/${slot}`,
            (pct) => setSlotState(key, { status: "uploading", pct }),
          );
          setSlotState(key, { status: "done", pct: 100, error: undefined });
          // A re-shot guided slot replaces its previous photo; damage stacks.
          const current = photosRef.current;
          const withoutOld =
            slot === "damage" ? current : current.filter((p) => p.slot !== slot);
          const next = [...withoutOld.filter((p) => p.key !== key), { url, slot, key }];
          photosRef.current = next;
          onChange(next);
        } catch (err) {
          // Caught here rather than left to reject, so the rest of the queue
          // still runs: a failure on photo four must not take out five and six.
          setSlotState(key, {
            status: "failed",
            pct: 0,
            error: (err as Error).message || "Upload failed.",
            file,
          });
        }
      };

      void enqueue(task);
    },
    [enqueue, onChange, setSlotState, vin],
  );

  const retry = useCallback(
    (key: string) => {
      const st = state[key];
      if (!st?.file) return;
      const slot = key.startsWith("damage-") ? "damage" : key;
      run(st.file, slot, key, st.label ?? "Photo");
    },
    [run, state],
  );

  function remove(key: string) {
    onChange(photos.filter((p) => p.key !== key));
    setState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const damagePhotos = photos.filter((p) => p.slot === "damage");
  // Damage photos that are still in flight or have failed have no URL yet, so
  // they are not in `photos` — surface them from the status map instead.
  const damagePending = Object.entries(state).filter(
    ([key, st]) =>
      key.startsWith("damage-") && st.status !== "done" && st.status !== "idle",
  );

  const inFlight = Object.values(state).filter(
    (s) => s.status === "pending" || s.status === "uploading",
  ).length;
  const failed = Object.entries(state).filter(([, s]) => s.status === "failed");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {PHOTO_SLOTS.map(({ slot, label }) => {
          const existing = photos.find((p) => p.slot === slot);
          const st = state[slot] ?? { status: "idle" as UploadStatus, pct: 0 };
          return (
            <SlotTile
              key={slot}
              label={label}
              photoUrl={existing?.url}
              state={st}
              onPick={(file) => run(file, slot, slot, label)}
              onRetry={() => retry(slot)}
              onRemove={existing ? () => remove(existing.key) : undefined}
            />
          );
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={() => damageInput.current?.click()}
          className="w-full lg:w-auto lg:px-6 min-h-[52px] lg:min-h-[44px] rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 text-amber-300 text-sm font-body font-semibold active:bg-amber-500/15 hover:bg-amber-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
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
              run(f, "damage", `damage-${Date.now()}-${i}`, "Damage"),
            );
            e.target.value = "";
          }}
        />

        {damagePhotos.length > 0 || damagePending.length > 0 ? (
          <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {damagePhotos.map((p) => (
              <div
                key={p.key}
                className="relative aspect-square rounded-lg overflow-hidden border border-white/10"
              >
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
            {damagePending.map(([key, st]) => (
              <div
                key={key}
                className="relative aspect-square rounded-lg border border-white/10 bg-black/40 flex flex-col items-center justify-center gap-1 p-1"
              >
                <StatusPill status={st.status} pct={st.pct} />
                {st.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => retry(key)}
                    className="text-[10px] font-body font-semibold text-amber-300 underline"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* One honest line about the whole set, so nobody taps Save while four
          photos are still climbing up a one-bar connection. */}
      {inFlight > 0 || failed.length > 0 ? (
        <p
          className={`text-[12px] font-body rounded-lg px-3 py-2 border ${
            failed.length > 0
              ? "text-red-300 bg-red-500/10 border-red-500/30"
              : "text-zinc-300 bg-black/30 border-white/10"
          }`}
          aria-live="polite"
        >
          {failed.length > 0
            ? `${failed.length} photo${failed.length > 1 ? "s" : ""} failed to upload. Tap Retry — the rest are safe.`
            : `Uploading ${inFlight} photo${inFlight > 1 ? "s" : ""}…`}
        </p>
      ) : null}
    </div>
  );
}

function StatusPill({ status, pct }: { status: UploadStatus; pct: number }) {
  if (status === "pending")
    return <span className="text-[10px] font-body text-zinc-400">Queued</span>;
  if (status === "uploading")
    return <span className="text-[11px] font-body text-white">{Math.round(pct)}%</span>;
  if (status === "failed")
    return <span className="text-[10px] font-body text-red-400">Failed</span>;
  return null;
}

function SlotTile({
  label,
  photoUrl,
  state,
  onPick,
  onRetry,
  onRemove,
}: {
  label: string;
  photoUrl?: string;
  state: SlotState;
  onPick: (file: File) => void;
  onRetry: () => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = state.status === "pending" || state.status === "uploading";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        // Tall enough to hit with a thumb in a glove, on gravel.
        className="w-full aspect-[4/3] min-h-[92px] rounded-lg border border-white/10 bg-black/40 overflow-hidden flex flex-col items-center justify-center gap-1 active:bg-white/5 hover:border-white/25 transition-colors disabled:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={label} className="w-full h-full object-cover" />
        ) : (
          <>
            <svg
              className="w-6 h-6 text-zinc-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
            <span className="text-[11px] font-body text-zinc-400 px-1 text-center leading-tight">
              {label}
            </span>
          </>
        )}
        {busy ? (
          <span className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <StatusPill status={state.status} pct={state.pct} />
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
        <div className="mt-1">
          <button
            type="button"
            onClick={onRetry}
            className="w-full min-h-[36px] rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-[12px] font-body font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          >
            Retry {label}
          </button>
          <p className="mt-0.5 text-[10px] text-red-400/80 leading-tight">
            {state.error ?? "Upload failed."}
          </p>
        </div>
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
