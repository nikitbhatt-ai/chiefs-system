"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoSlots, type CheckInPhoto } from "./PhotoSlots";
import { lookupVinAction, saveCheckInAction, type CheckInState } from "./actions";
import type { VinLookupResult } from "@/lib/vin";

// Tap-to-select rather than a text field: nobody types "three quarters" while
// holding a phone in one hand.
const FUEL_LEVELS = [
  { value: "empty", label: "E" },
  { value: "quarter", label: "¼" },
  { value: "half", label: "½" },
  { value: "three_quarter", label: "¾" },
  { value: "full", label: "F" },
] as const;

// Tapping a chip produces DATA. "Describe the damage" produces empty fields.
const DAMAGE_PRESETS = ["Scratch", "Dent", "Chip", "Curb rash", "Cracked glass"] as const;

const LOT_STATUSES = [
  { value: "on_lot_available", label: "On lot — available" },
  { value: "on_lot_assigned", label: "On lot — assigned" },
  { value: "in_shop", label: "In shop" },
] as const;

const OWNERSHIPS = [
  { value: "chiefs", label: "Chiefs-owned" },
  { value: "customer", label: "Customer-owned" },
  { value: "sames", label: "Sames Auto Group" },
] as const;

const FIELD =
  "w-full min-h-[48px] bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-base text-white placeholder:text-zinc-500";
const LABEL = "block text-[11px] font-body font-semibold text-zinc-400 uppercase tracking-wider mb-1.5";
const CARD = "bg-surface border border-white/5 rounded-lg p-4";

const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;

export function CheckInForm({
  canSetOwnership,
  canSetLotStatus,
}: {
  canSetOwnership: boolean;
  canSetLotStatus: boolean;
}) {
  const [vin, setVin] = useState("");
  const [lookup, setLookup] = useState<VinLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [photos, setPhotos] = useState<CheckInPhoto[]>([]);
  const [fuel, setFuel] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [damageText, setDamageText] = useState("");

  const [state, formAction] = useActionState<CheckInState, FormData>(saveCheckInAction, {
    ok: false,
  });

  // Fire the lookup the moment a valid 17-character VIN exists, rather than
  // making someone find a "look up" button with one thumb.
  useEffect(() => {
    const clean = vin.trim().toUpperCase();
    if (!VIN_OK.test(clean)) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setLooking(true);
    const t = setTimeout(async () => {
      try {
        const result = await lookupVinAction(clean);
        if (!cancelled) setLookup(result);
      } catch {
        // A lookup failure must never block a check-in: fall through to the
        // full manual form.
        if (!cancelled) setLookup({ status: "new", vin: clean, decoded: null });
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vin]);

  // Damage notes are the chips plus whatever was typed, joined into the one
  // column. Chips first so the common cases are scannable.
  const damageNotes = [chips.join(", "), damageText.trim()].filter(Boolean).join(" — ");

  if (state.ok && state.saved) {
    return <SavedPanel saved={state.saved} onAnother={() => window.location.reload()} />;
  }

  const isExisting = lookup?.status === "existing";
  const decoded = lookup?.status === "new" ? lookup.decoded : null;
  const showDetails = lookup?.status === "existing" || lookup?.status === "new";

  return (
    <form action={formAction} className="space-y-4 pb-28">
      {/* ---- Step 1: VIN --------------------------------------------------- */}
      <div className={CARD}>
        <label className={LABEL} htmlFor="vin">
          VIN
        </label>
        <input
          id="vin"
          name="vin"
          value={vin}
          onChange={(e) => setVin(e.target.value.toUpperCase())}
          placeholder="17 characters"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          className={`${FIELD} font-mono tracking-wider text-lg`}
        />
        <p className="mt-1.5 text-[11px] text-zinc-500 font-body">
          {looking
            ? "Looking up…"
            : lookup?.status === "invalid"
              ? ""
              : `${vin.trim().length}/17`}
        </p>
        {lookup?.status === "invalid" ? (
          <p className="mt-1 text-[12px] text-red-400 font-body">{lookup.error}</p>
        ) : null}
        {state.fieldErrors?.vin ? (
          <p className="mt-1 text-[12px] text-red-400 font-body">{state.fieldErrors.vin}</p>
        ) : null}
      </div>

      {/* ---- Known vehicle banner ------------------------------------------ */}
      {isExisting && lookup.status === "existing" ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <p className="text-[11px] font-body font-semibold text-amber-300 uppercase tracking-wider">
            We already know this vehicle
          </p>
          <p className="mt-1 text-base font-display font-bold text-white">
            {[lookup.vehicle.year, lookup.vehicle.make, lookup.vehicle.model]
              .filter(Boolean)
              .join(" ") || "Vehicle on file"}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] font-body">
            <Fact label="Ownership" value={lookup.vehicle.ownership ?? "Not classified"} />
            <Fact label="Lot status" value={lookup.vehicle.lotStatus.replace(/_/g, " ")} />
            <Fact
              label="Last arrival"
              value={
                lookup.lastCheckIn
                  ? new Date(lookup.lastCheckIn.arrivedAt).toLocaleDateString()
                  : "No previous check-in"
              }
            />
            <Fact
              label="Current deal"
              value={
                lookup.activeDeal
                  ? `${lookup.activeDeal.customerName ?? "Deal"} · ${lookup.activeDeal.stage.replace(/_/g, " ")}`
                  : "Not on a deal"
              }
            />
          </dl>
          <p className="mt-2.5 text-[11px] text-amber-200/70 font-body">
            Only arrival details are needed — its year, make and model are already on file.
          </p>
        </div>
      ) : null}

      {showDetails ? (
        <>
          {/* ---- Step 2: PHOTOS FIRST -------------------------------------
              Deliberately above everything else. If someone gets pulled away
              mid-check-in, the photos are the part that cannot be recreated
              later — the truck will have moved and the damage will be
              someone's word against someone else's. */}
          <div className={CARD}>
            <h2 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-1">
              Photos
            </h2>
            <p className="text-[11px] text-zinc-500 font-body mb-3">
              Take these first. Tap a box to open the camera.
            </p>
            <PhotoSlots vin={vin.trim().toUpperCase()} photos={photos} onChange={setPhotos} />
          </div>

          {/* ---- Identity, new vehicles only ------------------------------ */}
          {!isExisting ? (
            <div className={CARD}>
              <h2 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-1">
                Vehicle
              </h2>
              <p className="text-[11px] text-zinc-500 font-body mb-3">
                {decoded
                  ? "Filled in from the VIN. Correct anything that looks wrong."
                  : "The VIN decoder did not answer — type what you can see."}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Year" name="year" defaultValue={decoded?.year ?? ""} type="number" inputMode="numeric" />
                <Field label="Make" name="make" defaultValue={decoded?.make ?? ""} />
                <Field label="Model" name="model" defaultValue={decoded?.model ?? ""} />
                <Field label="Trim" name="trim" defaultValue={decoded?.trim ?? ""} />
                <div className="col-span-2">
                  <Field label="Color" name="color" defaultValue="" />
                </div>
              </div>
            </div>
          ) : null}

          {/* ---- Step 3: condition and arrival ---------------------------- */}
          <div className={CARD}>
            <h2 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
              Condition &amp; arrival
            </h2>

            <div className="mb-4">
              <span className={LABEL}>Fuel level</span>
              <div className="grid grid-cols-5 gap-1.5">
                {FUEL_LEVELS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFuel(fuel === f.value ? "" : f.value)}
                    aria-pressed={fuel === f.value}
                    className={`min-h-[48px] rounded-lg border text-base font-body font-semibold transition-colors ${
                      fuel === f.value
                        ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                        : "bg-black/40 border-white/10 text-zinc-300 active:bg-white/5"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input type="hidden" name="fuelLevel" value={fuel} />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Odometer" name="odometer" type="number" inputMode="numeric" placeholder="Miles" />
              <Field label="Keys" name="keyCount" type="number" inputMode="numeric" placeholder="How many" />
              <div className="col-span-2">
                <Field label="Key location" name="keyLocation" placeholder="Key board, hook 14" />
              </div>
              <div className="col-span-2">
                <Field label="Where is it parked" name="lotLocation" placeholder="Row A-3" />
              </div>
            </div>

            <div className="mt-4">
              <span className={LABEL}>Damage</span>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DAMAGE_PRESETS.map((d) => {
                  const on = chips.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setChips((c) => (on ? c.filter((x) => x !== d) : [...c, d]))
                      }
                      className={`min-h-[40px] px-3 rounded-full border text-[13px] font-body transition-colors ${
                        on
                          ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                          : "bg-black/40 border-white/10 text-zinc-300 active:bg-white/5"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={damageText}
                onChange={(e) => setDamageText(e.target.value)}
                rows={2}
                placeholder="Anything else worth noting"
                className={FIELD}
              />
              <input type="hidden" name="damageNotes" value={damageNotes} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5">
              <Field label="Items left inside" name="itemsInside" placeholder="Owner manual, jack kit" />
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Delivered by" name="deliveredBy" placeholder="Name" />
                <Field label="Drop contact" name="dropContact" type="tel" inputMode="tel" placeholder="Phone" />
              </div>
            </div>
          </div>

          {/* ---- Step 4: classification ----------------------------------- */}
          {canSetOwnership || canSetLotStatus ? (
            <div className={CARD}>
              <h2 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
                Classification
              </h2>

              {canSetOwnership ? (
                <div className="mb-4">
                  <span className={LABEL}>Ownership</span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {OWNERSHIPS.map((o) => (
                      <label
                        key={o.value}
                        className="flex items-center gap-3 min-h-[48px] px-3 rounded-lg border border-white/10 bg-black/40 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="ownership"
                          value={o.value}
                          defaultChecked={
                            isExisting && lookup.status === "existing"
                              ? lookup.vehicle.ownership === o.value
                              : false
                          }
                          className="w-5 h-5 accent-amber-500"
                        />
                        <span className="text-sm font-body text-zinc-200">{o.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {canSetLotStatus ? (
                <div>
                  <span className={LABEL}>Lot status</span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {LOT_STATUSES.map((s) => (
                      <label
                        key={s.value}
                        className="flex items-center gap-3 min-h-[48px] px-3 rounded-lg border border-white/10 bg-black/40 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="lotStatus"
                          value={s.value}
                          defaultChecked={s.value === "on_lot_available"}
                          className="w-5 h-5 accent-amber-500"
                        />
                        <span className="text-sm font-body text-zinc-200">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <input type="hidden" name="photos" value={JSON.stringify(photos.map(({ url, slot }) => ({ url, slot })))} />

          {state.error ? (
            <p className="text-sm text-red-400 font-body bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              {state.error}
            </p>
          ) : null}

          {/* Sticky so the save button is always under the thumb, however far
              down the form someone has scrolled. */}
          <div className="fixed bottom-0 left-0 right-0 p-3 bg-black/80 backdrop-blur border-t border-white/10">
            <SubmitButton className="w-full min-h-[52px] rounded-lg bg-amber-500 text-black text-base font-body font-bold">
              Save check-in
            </SubmitButton>
          </div>
        </>
      ) : null}
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-amber-200/60 uppercase tracking-wider">{label}</dt>
      <dd className="text-zinc-100 capitalize">{value}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  inputMode,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  inputMode?: "numeric" | "tel" | "text";
  placeholder?: string;
}) {
  return (
    <div>
      <label className={LABEL} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={FIELD}
      />
    </div>
  );
}

function SavedPanel({
  saved,
  onAnother,
}: {
  saved: { checkInId: string; vin: string; wasNewVehicle: boolean };
  onAnother: () => void;
}) {
  return (
    <div className="bg-surface border border-green-500/30 rounded-lg p-6 text-center">
      <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/40 mx-auto flex items-center justify-center">
        <svg className="w-6 h-6 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="mt-3 text-lg font-display font-bold text-white">Checked in</h2>
      <p className="mt-1 text-sm text-zinc-400 font-body font-mono">{saved.vin}</p>
      <p className="mt-1 text-[12px] text-zinc-500 font-body">
        {saved.wasNewVehicle
          ? "New vehicle record created."
          : "Added to this vehicle's existing history."}
      </p>
      <div className="mt-5 grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onAnother}
          className="min-h-[52px] rounded-lg bg-amber-500 text-black text-base font-body font-bold"
        >
          Check in another vehicle
        </button>
        <Link
          href="/vehicles"
          className="min-h-[48px] flex items-center justify-center rounded-lg border border-white/10 text-sm font-body text-zinc-300"
        >
          Go to vehicles
        </Link>
      </div>
    </div>
  );
}
