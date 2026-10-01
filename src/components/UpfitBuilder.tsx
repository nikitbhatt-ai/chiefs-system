"use client";

// Vehicle Configurator — the lighting-layout diagram for one estimate.
//
// Three columns: pick a vehicle (left), drag lights on the diagram
// (middle), add + edit lights (right). The diagram is VISUAL ONLY: it
// never prices, orders or reserves anything — sales quotes the parts as
// line items on the estimate. Changes auto-save.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BODY_STYLES,
  LENS_COLORS,
  LIGHT_TYPES,
  LIGHT_TYPE_GROUP_LABELS,
  PIN_SIZES,
  PUSHBAR_DEFAULT_FRAC,
  getTemplate,
  getViews,
  isPushbarShape,
  lensLabel,
  pinColorWords,
  pinLensState,
  type LensColorKey,
  type LightType,
  type LightTypeGroup,
  type PinSizeKey,
} from "@/lib/upfit/templates";
import type { UpfitPin, UpfitSnapPoint } from "@/db/schema";
import { useAutosave, autosaveLabel, type AutosaveState } from "@/lib/useAutosave";
import { LightSwatch, PinOnDiagram } from "@/components/upfit/PinGraphics";

export type UpfitBuilderProps = {
  quoteId: string;
  quoteNumber: string;
  // Null when this estimate has no configuration yet ("No vehicle selected").
  initialBodyStyle: string | null;
  initialVehicleLabel: string;
  initialPins: UpfitPin[];
  initialNotes: string;
  action: (formData: FormData) => Promise<void>;
  // Deletes this estimate's configuration (not the estimate) — "Reset builder".
  resetAction: (formData: FormData) => Promise<void>;
  // Snap points + starter layouts, shared per vehicle template.
  snapPoints?: Record<string, UpfitSnapPoint[]>;
  starters?: Starter[];
  /** False until docs/sql/upfit_snap_starters.sql has been run. */
  extrasReady?: boolean;
  saveSnapPointsAction?: (formData: FormData) => Promise<void>;
  saveStarterAction?: (formData: FormData) => Promise<{ id: string } | null>;
  deleteStarterAction?: (formData: FormData) => Promise<void>;
  /** The "Choose a light type" list (Settings → Light types). Defaults to the built-in list. */
  lightTypes?: LightType[];
};

type Starter = { id: string; bodyStyle: string; name: string; pins: UpfitPin[] };

// How close (screen px) a dragged light must get to a snap point to jump onto it.
const SNAP_RADIUS_PX = 18;
const SNAP_PREF_KEY = "upfit.snap";

type Shape = NonNullable<UpfitPin["shape"]>;
type Orientation = NonNullable<UpfitPin["orientation"]>;

const DEFAULT_LENSES: LensColorKey[] = ["red", "blue", "amber"];
const LAYOUTS = [
  { n: 1, label: "Solo" },
  { n: 2, label: "Duo" },
  { n: 3, label: "Trio" },
] as const;
const SHAPES: { key: Shape; label: string }[] = [
  { key: "rect", label: "Bar" },
  { key: "circle", label: "Round" },
  { key: "pushbar", label: "Bumper" },
  { key: "pushbar_wrap", label: "Wrap" },
];
const SIZE_CHOICES: { key: PinSizeKey; label: string }[] = [
  { key: "small", label: "S" },
  { key: "medium", label: "M" },
  { key: "large", label: "L" },
  { key: "strip_small", label: "Strip S" },
  { key: "strip_medium", label: "Strip M" },
  { key: "strip_large", label: "Strip L" },
];

// Below this distance (fraction of the image box) a pointerdown is a
// click-to-select rather than a drag, so tapping a light doesn't nudge it.
const DRAG_THRESHOLD = 0.01;

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const renumber = (arr: UpfitPin[]): UpfitPin[] => arr.map((p, idx) => ({ ...p, number: idx + 1 }));

// Resize the lens list to `n`, keeping the colors already chosen.
function resizeLenses(cur: LensColorKey[], n: number): LensColorKey[] {
  return Array.from({ length: n }, (_, i) => cur[i] ?? DEFAULT_LENSES[i] ?? "white");
}

export function UpfitBuilder({
  quoteId,
  quoteNumber,
  initialBodyStyle,
  initialVehicleLabel,
  initialPins,
  initialNotes,
  action,
  resetAction,
  snapPoints = {},
  starters = [],
  extrasReady = true,
  saveSnapPointsAction,
  saveStarterAction,
  deleteStarterAction,
  lightTypes = LIGHT_TYPES,
}: UpfitBuilderProps) {
  const getLightType = (key: string | null | undefined) => lightTypes.find((t) => t.key === key) ?? null;
  const router = useRouter();
  const backHref = `/quotes/${quoteId}`;

  const [bodyStyle, setBodyStyle] = useState<string | null>(initialBodyStyle);
  const [vehicleLabel, setVehicleLabel] = useState(initialVehicleLabel);
  const [pins, setPins] = useState<UpfitPin[]>(initialPins);
  const [notes, setNotes] = useState(initialNotes);
  const [activePinId, setActivePinId] = useState<string | null>(null);

  // Snap points (per vehicle) + starter layouts.
  const [snapMap, setSnapMap] = useState<Record<string, UpfitSnapPoint[]>>(snapPoints);
  const [snapOn, setSnapOn] = useState(false);
  const [editingSnap, setEditingSnap] = useState(false);
  const [snapMsg, setSnapMsg] = useState<string | null>(null);
  const [starterList, setStarterList] = useState<Starter[]>(starters);
  const [starterName, setStarterName] = useState("");
  const [starterMsg, setStarterMsg] = useState<string | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);
  // Remember the Snap checkbox per browser.
  useEffect(() => {
    try {
      setSnapOn(window.localStorage.getItem(SNAP_PREF_KEY) === "1");
    } catch {
      /* storage blocked — default off */
    }
  }, []);
  const toggleSnap = (on: boolean) => {
    setSnapOn(on);
    try {
      window.localStorage.setItem(SNAP_PREF_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // "Add to the diagram" card.
  const [lightTypeKey, setLightTypeKey] = useState("");
  const [lenses, setLenses] = useState<LensColorKey[]>(["red"]);
  const [repeat, setRepeat] = useState(1);
  const [howMany, setHowMany] = useState(1);
  const [shape, setShape] = useState<Shape>("rect");
  const [size, setSize] = useState<PinSizeKey>("medium");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [caption, setCaption] = useState("");
  const [justAdded, setJustAdded] = useState<number | null>(null);

  const template = useMemo(() => (bodyStyle ? getTemplate(bodyStyle) : null), [bodyStyle]);
  const views = useMemo(() => (template ? getViews(template) : []), [template]);
  const [activeView, setActiveView] = useState<string>(views[0]?.key ?? "main");
  const activeViewKey = views.some((v) => v.key === activeView) ? activeView : (views[0]?.key ?? "main");
  const activeViewDef = views.find((v) => v.key === activeViewKey) ?? views[0];
  const firstViewKey = views[0]?.key ?? "main";
  // Legacy pins with no view fall onto the first view so nothing is orphaned.
  const pinViewKey = useCallback((p: UpfitPin) => p.view ?? firstViewKey, [firstViewKey]);
  const visiblePins = pins.filter((p) => pinViewKey(p) === activeViewKey);
  const activePin = pins.find((p) => p.id === activePinId) ?? null;

  // --- Auto-save -----------------------------------------------------------
  // Every change is saved ~1s after the last edit (shared hook, same as the
  // estimate editor). Nothing saves until a vehicle is picked.
  const autosave = useAutosave(
    { bodyStyle, vehicleLabel, pins, notes },
    async (snap) => {
      if (!snap.bodyStyle) return;
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("bodyStyle", snap.bodyStyle);
      fd.set("vehicleLabel", snap.vehicleLabel);
      fd.set("pins", JSON.stringify(snap.pins));
      fd.set("notes", snap.notes);
      await action(fd);
    },
    { enabled: !!bodyStyle },
  );
  const flushSave = autosave.flush;

  const finish = async () => {
    if (!(await flushSave())) {
      window.alert("Couldn't save the layout. Check your connection and try again.");
      return;
    }
    router.push(backHref);
  };

  const downloadSpec = async () => {
    await flushSave();
    // The PDF route answers with Content-Disposition: attachment, so this
    // downloads without leaving the page.
    window.location.href = `/api/pdf/upfit/${quoteId}`;
  };

  // "Reset builder": start over from "Pick a vehicle". Deletes only this
  // estimate's configuration; the estimate's line items and prices are
  // untouched.
  const [resetting, setResetting] = useState(false);
  const resetBuilder = async () => {
    if (
      !window.confirm(
        "Reset the builder? This removes the vehicle, all lights and the build notes so you can start over. " +
          "The estimate's line items and prices are NOT changed.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      // Let any in-flight save land first so it can't re-create the
      // configuration right after it's deleted.
      await flushSave();
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      await resetAction(fd);
      setBodyStyle(null);
      setPins([]);
      setNotes("");
      setVehicleLabel("");
      setActivePinId(null);
      setLightTypeKey("");
      setJustAdded(null);
    } catch {
      window.alert("Couldn't reset the builder. Check your connection and try again.");
    } finally {
      setResetting(false);
    }
  };

  // --- Vehicle -------------------------------------------------------------
  const pickVehicle = (slug: string) => {
    if (slug === bodyStyle) return;
    if (
      pins.length > 0 &&
      !window.confirm(
        "Switch vehicles? Your lights stay on the diagram, but you may need to drag them back into place.",
      )
    ) {
      return;
    }
    setBodyStyle(slug);
    setActiveView(getViews(getTemplate(slug))[0]?.key ?? "main");
  };

  // --- Add lights ----------------------------------------------------------
  const pickLightType = (key: string) => {
    setLightTypeKey(key);
    const t = getLightType(key);
    if (t) {
      setShape(t.shape);
      setSize(t.size);
    }
    // The label starts as the light's name ("Lightbar"); edit it freely.
    setCaption(t ? t.label : "");
  };

  const addToDiagram = () => {
    const t = getLightType(lightTypeKey);
    if (!t) return;
    const n = Math.max(1, Math.min(24, Math.round(howMany) || 1));
    const pushbar = isPushbarShape(shape);
    // Drop the new lights in a row across the middle of the current
    // view, wrapping every 8, ready to drag into place.
    const perRow = 8;
    const spacing = 0.07;
    const added: UpfitPin[] = Array.from({ length: n }, (_, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      return {
        id: randomId(),
        number: 0,
        view: activeViewKey,
        x: Math.max(0.04, Math.min(0.96, 0.5 + (col - (inRow - 1) / 2) * spacing)),
        y: Math.max(0.04, Math.min(0.96, 0.5 + row * 0.08)),
        label: t.label,
        lightType: t.key,
        caption: caption.trim() || undefined,
        shape,
        size,
        orientation: shape === "rect" ? orientation : undefined,
        lenses: pushbar ? undefined : [...lenses],
        lensRepeat: pushbar || repeat <= 1 ? undefined : repeat,
        ...(pushbar
          ? { widthFracOverride: PUSHBAR_DEFAULT_FRAC.width, heightFracOverride: PUSHBAR_DEFAULT_FRAC.height }
          : {}),
      };
    });
    setPins((cur) => renumber([...cur, ...added]));
    setActivePinId(added[added.length - 1].id);
    setJustAdded(n);
    // Start the next light fresh so its label isn't carried over.
    setLightTypeKey("");
    setCaption("");
    setHowMany(1);
  };

  // --- Edit placed lights --------------------------------------------------
  const updatePin = (id: string, patch: Partial<UpfitPin>) =>
    setPins((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removePin = (id: string) => {
    setPins((cur) => renumber(cur.filter((p) => p.id !== id)));
    setActivePinId((cur) => (cur === id ? null : cur));
  };

  const duplicatePin = (pin: UpfitPin) => {
    const copy: UpfitPin = {
      ...pin,
      id: randomId(),
      x: Math.min(0.96, pin.x + 0.04),
      y: Math.min(0.96, pin.y + 0.03),
    };
    setPins((cur) => renumber([...cur, copy]));
    setActivePinId(copy.id);
  };

  const clearAll = () => {
    if (pins.length === 0) return;
    if (!window.confirm(`Remove all ${pins.length} lights from the diagram?`)) return;
    setPins([]);
    setActivePinId(null);
  };

  // Delete / Backspace removes the selected light (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activePinId) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removePin(activePinId);
      } else if (e.key === "Escape") {
        setActivePinId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Drag + resize on the diagram ---------------------------------------
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pinId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<string | null>(null);

  const toFractional = (clientX: number, clientY: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  // Snap a diagram position onto the nearest snap point within reach.
  const currentSnaps: UpfitSnapPoint[] = bodyStyle ? snapMap[bodyStyle] ?? [] : [];
  const snapFrac = (f: { x: number; y: number }) => {
    if (!snapOn || editingSnap || currentSnaps.length === 0) return f;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return f;
    let best: UpfitSnapPoint | null = null;
    let bestD = SNAP_RADIUS_PX;
    for (const p of currentSnaps) {
      const d = Math.hypot((f.x - p.x) * rect.width, (f.y - p.y) * rect.height);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best ? { x: best.x, y: best.y } : f;
  };

  const saveSnaps = async (points: UpfitSnapPoint[]) => {
    if (!bodyStyle || !saveSnapPointsAction) return;
    const fd = new FormData();
    fd.set("bodyStyle", bodyStyle);
    fd.set("points", JSON.stringify(points));
    try {
      await saveSnapPointsAction(fd);
      setSnapMsg(`Saved ${points.length} snap point${points.length === 1 ? "" : "s"} for this vehicle.`);
    } catch {
      setSnapMsg("Couldn't save snap points. Check your connection and try again.");
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editingSnap || !bodyStyle) {
      setActivePinId(null);
      return;
    }
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    setSnapMap((m) => ({ ...m, [bodyStyle]: [...(m[bodyStyle] ?? []), { x: f.x, y: f.y }] }));
  };

  const removeSnap = (idx: number) => {
    if (!bodyStyle) return;
    setSnapMap((m) => ({ ...m, [bodyStyle]: (m[bodyStyle] ?? []).filter((_, i) => i !== idx) }));
  };

  const finishEditingSnaps = async () => {
    setEditingSnap(false);
    await saveSnaps(currentSnaps);
  };

  // --- Starter layouts ----------------------------------------------------
  const vehicleStarters = starterList.filter((s) => s.bodyStyle === bodyStyle);

  const applyStarter = (st: Starter) => {
    if (st.pins.length === 0) return;
    if (
      pins.length > 0 &&
      !window.confirm(`Add the ${st.pins.length} lights from "${st.name}" to the ${pins.length} already on the diagram?`)
    ) {
      return;
    }
    const added = st.pins.map((p) => ({ ...p, id: randomId(), view: undefined }));
    setPins((cur) => renumber([...cur, ...added]));
    setActivePinId(null);
    setStarterMsg(`Applied "${st.name}" — ${added.length} light${added.length === 1 ? "" : "s"} added.`);
  };

  const saveAsStarter = async () => {
    const name = starterName.trim();
    if (!bodyStyle || !name || pins.length === 0 || !saveStarterAction) return;
    setStarterBusy(true);
    setStarterMsg(null);
    const fd = new FormData();
    fd.set("bodyStyle", bodyStyle);
    fd.set("name", name);
    fd.set("pins", JSON.stringify(pins));
    try {
      const row = await saveStarterAction(fd);
      if (!row) throw new Error();
      setStarterList((l) => [...l, { id: row.id, bodyStyle, name, pins }].sort((a, b) => a.name.localeCompare(b.name)));
      setStarterName("");
      setStarterMsg(`Saved "${name}" as a starter layout for this vehicle.`);
    } catch {
      setStarterMsg("Couldn't save the starter layout. Try again.");
    } finally {
      setStarterBusy(false);
    }
  };

  const removeStarter = async (st: Starter) => {
    if (!deleteStarterAction || !window.confirm(`Delete the starter layout "${st.name}"? This can't be undone.`)) return;
    const fd = new FormData();
    fd.set("id", st.id);
    try {
      await deleteStarterAction(fd);
      setStarterList((l) => l.filter((x) => x.id !== st.id));
    } catch {
      setStarterMsg("Couldn't delete it. Try again.");
    }
  };

  const onPinPointerDown = (e: React.PointerEvent<HTMLDivElement>, pin: UpfitPin) => {
    e.stopPropagation();
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    dragRef.current = { pinId: pin.id, startX: f.x, startY: f.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPinPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    if (!drag.moved) {
      if (Math.hypot(f.x - drag.startX, f.y - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
    }
    updatePin(drag.pinId, snapFrac(f));
  };
  const onPinPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!drag.moved) setActivePinId(drag.pinId);
    dragRef.current = null;
  };

  // Lower bound stops a light collapsing to nothing; upper bound stops it
  // eating the whole diagram. The pin is centered on (x, y), so the
  // cursor-to-center distance is the half-extent.
  const clampSize = (v: number) => Math.max(0.006, Math.min(0.6, v));
  const resizeTo = (id: string, clientX: number, clientY: number) => {
    const f = toFractional(clientX, clientY);
    if (!f) return;
    setPins((cur) =>
      cur.map((p) => {
        if (p.id !== id) return p;
        const w = clampSize(Math.abs(f.x - p.x) * 2);
        const h = clampSize(Math.abs(f.y - p.y) * 2);
        if (p.shape === "circle") {
          const d = Math.max(w, h);
          return { ...p, widthFracOverride: d, heightFracOverride: d };
        }
        return { ...p, widthFracOverride: w, heightFracOverride: h };
      }),
    );
  };

  // --- Render --------------------------------------------------------------
  const selectedType = getLightType(lightTypeKey);
  const addIsPushbar = isPushbarShape(shape);
  const groups = (Object.keys(LIGHT_TYPE_GROUP_LABELS) as LightTypeGroup[]).map((g) => ({
    group: g,
    label: LIGHT_TYPE_GROUP_LABELS[g],
    types: lightTypes.filter((t) => t.group === g),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-white/10">
        <div className="min-w-0">
          <div className="label-caps">
            <button type="button" onClick={finish} className="text-[var(--color-cta)] hover:underline uppercase">
              {quoteNumber}
            </button>{" "}
            / Configurator
          </div>
          <h1 className="font-ui font-bold text-3xl text-white mt-1">Vehicle Configurator</h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-3xl">
            Draw the lighting layout. Drag lights to position them; changes save on their own.{" "}
            <strong className="text-zinc-200">Nothing on this diagram is priced or ordered</strong> —
            quote the parts as line items on the estimate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <SaveBadge state={autosave.state} hasVehicle={!!bodyStyle} />
          {bodyStyle ? (
            <>
              <button type="button" onClick={downloadSpec} className="btn-outline btn-sm">
                Spec sheet PDF
              </button>
              <button
                type="button"
                onClick={resetBuilder}
                disabled={resetting}
                className="btn-outline btn-sm"
                title="Start over: clears the vehicle, lights and build notes. The estimate is not changed."
              >
                {resetting ? "Resetting…" : "Reset builder"}
              </button>
            </>
          ) : null}
          <button type="button" onClick={finish} className="btn-outline">
            ← Back to estimate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_360px] gap-4 items-start">
        {/* ── Left: vehicle ── */}
        <Panel title="Vehicle">
          <div className="label-caps mb-2">Select vehicle</div>
          <div className="space-y-2 lg:max-h-[440px] lg:overflow-y-auto lg:pr-1">
            {BODY_STYLES.map((b) => {
              const selected = b.slug === bodyStyle;
              return (
                <button
                  key={b.slug}
                  type="button"
                  onClick={() => pickVehicle(b.slug)}
                  aria-pressed={selected}
                  className={`w-full text-left rounded-xl border px-4 py-3 ${
                    selected
                      ? "border-[var(--color-cta)] bg-[color-mix(in_srgb,var(--color-cta)_10%,transparent)]"
                      : "border-white/10 hover:border-white/25 bg-white/[0.02]"
                  }`}
                >
                  <div className={`font-ui font-bold text-base ${selected ? "text-[var(--color-cta)]" : "text-white"}`}>
                    {b.model}
                  </div>
                  <div className="text-xs text-zinc-400">{b.make}</div>
                </button>
              );
            })}
          </div>

          {bodyStyle ? (
            <div className="mt-5 space-y-4 border-t border-white/10 pt-4">
              <label className="block">
                <span className="label-caps">Name on the diagram</span>
                <input
                  value={vehicleLabel}
                  onChange={(e) => setVehicleLabel(e.target.value)}
                  placeholder={template?.label ?? "e.g. 2024 Chevrolet Tahoe PPV"}
                  className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="label-caps">Build notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Wiring, mounting preferences, customer requests… (prints on the spec sheet)"
                  className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
          ) : null}
        </Panel>

        {/* ── Middle: diagram ── */}
        <section className="bg-surface border border-white/10 rounded-2xl overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
            <div className="min-w-0">
              {template ? (
                <>
                  <span className="font-ui font-bold text-lg text-white">{template.label}</span>
                  <span className="text-sm text-zinc-400">
                    {" "}
                    · {pins.length} {pins.length === 1 ? "light" : "lights"}
                  </span>
                </>
              ) : (
                <span className="text-zinc-400">No vehicle selected</span>
              )}
            </div>
            {template ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 label-caps cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={snapOn}
                    onChange={(e) => toggleSnap(e.target.checked)}
                    className="w-4 h-4 accent-[var(--color-cta)]"
                  />
                  Snap points
                </label>
                <button
                  type="button"
                  onClick={() => (editingSnap ? void finishEditingSnaps() : (setEditingSnap(true), setSnapMsg(null)))}
                  disabled={!extrasReady}
                  title={extrasReady ? undefined : "Needs the one-time database update (docs/sql/upfit_snap_starters.sql)"}
                  className={editingSnap ? "btn-cta btn-sm" : "btn-outline btn-sm"}
                >
                  {editingSnap ? "Done editing" : "Edit snap points"}
                </button>
                <button type="button" onClick={clearAll} disabled={pins.length === 0} className="btn-outline btn-sm">
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          {template ? (
            <div className="p-4 space-y-3">
              {views.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {views.map((v) => {
                    const count = pins.filter((p) => pinViewKey(p) === v.key).length;
                    return (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => setActiveView(v.key)}
                        aria-pressed={v.key === activeViewKey}
                        className="seg-btn !tracking-wider !px-3 !py-1.5"
                      >
                        {v.label}
                        {count > 0 ? <span className="ml-1 opacity-70">({count})</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div
                ref={boxRef}
                onClick={onCanvasClick}
                className={`upfit-canvas relative w-full rounded-xl border overflow-hidden select-none bg-white ${
                  editingSnap ? "border-[var(--color-cta)] cursor-crosshair" : "border-white/10"
                }`}
                style={{ touchAction: "none" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={activeViewKey}
                  src={activeViewDef?.imageUrl ?? template.imageUrl}
                  alt={`${template.label} — ${activeViewDef?.label ?? ""}`}
                  className="w-full h-auto block pointer-events-none"
                  draggable={false}
                />
                {/* Snap points: shown while snapping or editing; click one to
                    remove it while editing. */}
                {snapOn || editingSnap
                  ? currentSnaps.map((p, i) => (
                      <button
                        key={`snap-${i}`}
                        type="button"
                        tabIndex={editingSnap ? 0 : -1}
                        aria-label={editingSnap ? `Remove snap point ${i + 1}` : undefined}
                        title={editingSnap ? "Click to remove this snap point" : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (editingSnap) removeSnap(i);
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                          editingSnap
                            ? "w-4 h-4 bg-[var(--color-cta)] border-black cursor-pointer z-10"
                            : "w-3 h-3 bg-[var(--color-cta)] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
                        }`}
                        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                      />
                    ))
                  : null}
                {visiblePins.map((pin) => (
                  <PinOnDiagram
                    key={pin.id}
                    pin={pin}
                    interactive
                    active={pin.id === activePinId}
                    handlers={{
                      onPointerDown: (e) => onPinPointerDown(e, pin),
                      onPointerMove: onPinPointerMove,
                      onPointerUp: onPinPointerUp,
                      onClick: (e) => e.stopPropagation(),
                    }}
                  >
                    {pin.id === activePinId ? (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          resizeRef.current = pin.id;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          resizeTo(pin.id, e.clientX, e.clientY);
                        }}
                        onPointerMove={(e) => {
                          if (resizeRef.current !== pin.id) return;
                          e.stopPropagation();
                          resizeTo(pin.id, e.clientX, e.clientY);
                        }}
                        onPointerUp={(e) => {
                          if (resizeRef.current !== pin.id) return;
                          e.stopPropagation();
                          resizeRef.current = null;
                          e.currentTarget.releasePointerCapture?.(e.pointerId);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute"
                        style={{
                          right: -7,
                          bottom: -7,
                          width: 14,
                          height: 14,
                          backgroundColor: "var(--color-cta)",
                          border: "1.5px solid #000",
                          borderRadius: 3,
                          cursor: "nwse-resize",
                          touchAction: "none",
                          zIndex: 2,
                        }}
                        title="Drag to resize"
                      />
                    ) : null}
                  </PinOnDiagram>
                ))}
              </div>
              {editingSnap ? (
                <p className="text-xs text-[var(--color-cta)]">
                  Editing snap points for this vehicle: click the picture to add a point, click an orange point to
                  remove it, then press Done editing to save. Points are shared by every estimate for this vehicle.
                </p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Drag a light to move it{snapOn && currentSnaps.length ? " (it jumps onto the nearest snap point)" : ""}.
                  Click a light to select it, then drag the orange corner to resize. Press Delete to remove the selected
                  light.
                </p>
              )}
              {snapMsg ? <p className="text-xs text-zinc-300">{snapMsg}</p> : null}
              {snapOn && !editingSnap && currentSnaps.length === 0 ? (
                <p className="text-xs text-zinc-400">No snap points for this vehicle yet — press Edit snap points to add some.</p>
              ) : null}
            </div>
          ) : (
            <div className="bg-white/[0.03] min-h-[360px] flex flex-col items-center justify-center text-center px-6">
              <div className="font-ui font-bold text-2xl text-zinc-400">Pick a vehicle to begin</div>
              <p className="text-sm text-zinc-500 mt-2">
                Select a vehicle from the left panel to start configuring lights.
              </p>
            </div>
          )}
        </section>

        {/* ── Right: lights ── */}
        <Panel
          title={`Lights · ${pins.length}`}
          footer={
            <button type="button" onClick={finish} className="btn-cta w-full">
              Done →
            </button>
          }
        >
          {!template ? (
            <p className="text-sm text-zinc-400">Select a vehicle first.</p>
          ) : (
            <div className="space-y-5">
              {/* Add card */}
              <div className="rounded-xl border border-white/10 p-4 space-y-4">
                <div className="label-caps">Add to the diagram</div>
                <select
                  value={lightTypeKey}
                  onChange={(e) => pickLightType(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white"
                >
                  <option value="">-- Choose a light type --</option>
                  {groups.map((g) => (
                    <optgroup key={g.group} label={g.label}>
                      {g.types.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                          {t.dims ? ` — ${t.dims}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                {!addIsPushbar ? (
                  <LensPicker
                    lenses={lenses}
                    repeat={repeat}
                    showRepeat={shape === "rect"}
                    onLenses={setLenses}
                    onRepeat={setRepeat}
                  />
                ) : null}

                <details className="group rounded-lg border border-white/10 px-3 py-2">
                  <summary className="cursor-pointer label-caps list-none flex items-center justify-between">
                    Shape &amp; size
                    <span className="text-zinc-500 normal-case tracking-normal font-body font-normal text-xs">
                      {SHAPES.find((s) => s.key === shape)?.label}
                      {!addIsPushbar ? ` · ${PIN_SIZES[size].label}` : ""}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <ShapePicker value={shape} onChange={setShape} />
                    {!addIsPushbar ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        {SIZE_CHOICES.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            aria-pressed={size === s.key}
                            onClick={() => setSize(s.key)}
                            className="seg-btn !tracking-wider"
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {shape === "rect" ? (
                      <OrientationPicker value={orientation} onChange={setOrientation} />
                    ) : null}
                  </div>
                </details>

                <label className="block">
                  <span className="label-caps">Label (optional)</span>
                  <input
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="e.g. LEGACY LIGHTBAR"
                    className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </label>

                <div className="flex items-center gap-3">
                  <span className="label-caps whitespace-nowrap">How many</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={howMany}
                    onChange={(e) => setHowMany(Number(e.target.value) || 1)}
                    className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={addToDiagram}
                  disabled={!selectedType}
                  className="btn-cta w-full"
                  title={selectedType ? undefined : "Choose a light type first"}
                >
                  + Add to Diagram
                </button>
                {justAdded ? (
                  <p className="text-xs text-zinc-400">
                    Added {justAdded} — drag {justAdded === 1 ? "it" : "them"} into place on the diagram.
                  </p>
                ) : null}
              </div>

              {/* Starter layouts for this vehicle */}
              <div className="rounded-xl border border-white/10 p-4 space-y-3">
                <div className="label-caps">Starter layouts</div>
                {!extrasReady ? (
                  <p className="text-xs text-zinc-400">
                    Needs a one-time database update (docs/sql/upfit_snap_starters.sql) before layouts can be saved.
                  </p>
                ) : (
                  <>
                    {vehicleStarters.length === 0 ? (
                      <p className="text-xs text-zinc-400">None saved for this vehicle yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {vehicleStarters.map((st) => (
                          <li key={st.id} className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 text-sm text-white truncate">
                              {st.name}
                              <span className="text-xs text-zinc-500"> · {st.pins.length} lights</span>
                            </span>
                            <button type="button" onClick={() => applyStarter(st)} className="btn-outline btn-sm !py-1">
                              Apply
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeStarter(st)}
                              className="text-zinc-500 hover:text-red-400 text-lg leading-none px-1"
                              aria-label={`Delete starter ${st.name}`}
                              title="Delete"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={starterName}
                        onChange={(e) => setStarterName(e.target.value)}
                        placeholder="Name, e.g. Standard patrol"
                        aria-label="Starter layout name"
                        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={() => void saveAsStarter()}
                        disabled={starterBusy || !starterName.trim() || pins.length === 0}
                        title={pins.length === 0 ? "Add some lights first" : "Save the lights on the diagram as a starter"}
                        className="btn-outline btn-sm"
                      >
                        {starterBusy ? "Saving…" : "Save current"}
                      </button>
                    </div>
                  </>
                )}
                {starterMsg ? <p className="text-xs text-zinc-300">{starterMsg}</p> : null}
              </div>

              {/* Placed lights */}
              {pins.length === 0 ? (
                <p className="text-sm text-zinc-400">No lights yet. Use the picker above to add one, or apply a starter layout.</p>
              ) : (
                <ul className="space-y-2">
                  {pins.map((pin) => {
                    const isActive = pin.id === activePinId;
                    return (
                      <li
                        key={pin.id}
                        className={`rounded-xl border ${
                          isActive ? "border-[var(--color-cta)]" : "border-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-3 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActivePinId(isActive ? null : pin.id);
                              setActiveView(pinViewKey(pin));
                            }}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          >
                            <LightSwatch pin={pin} />
                            <span className="min-w-0">
                              <span className="block text-sm text-white truncate">{pin.label}</span>
                              {pin.caption || views.length > 1 || !isPushbarShape(pin.shape) ? (
                                <span className="block text-xs text-zinc-500 truncate">
                                  {[
                                    // Colors in words, for color-blind reps.
                                    isPushbarShape(pin.shape) ? null : pinColorWords(pin),
                                    pin.caption,
                                    views.length > 1 ? views.find((v) => v.key === pinViewKey(pin))?.label : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removePin(pin.id)}
                            className="text-zinc-500 hover:text-red-400 text-lg leading-none px-1"
                            aria-label={`Remove ${pin.label}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                        {isActive && activePin ? (
                          <PinEditor
                            pin={activePin}
                            onChange={(patch) => updatePin(pin.id, patch)}
                            onDuplicate={() => duplicatePin(pin)}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="text-xs text-zinc-500">
                This diagram is visual only. It quotes nothing, reserves no stock and changes no total — add
                the parts as line items on the estimate.
              </p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-white/10 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 bg-black/20">
        <h2 className="label-caps !text-white !text-sm">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
      {footer ? <div className="px-5 py-4 border-t border-white/10 bg-black/20">{footer}</div> : null}
    </section>
  );
}

function SaveBadge({ state, hasVehicle }: { state: AutosaveState; hasVehicle: boolean }) {
  if (!hasVehicle) return null;
  const tone = state === "error" ? "text-red-400" : state === "saved" ? "text-green-400" : "text-zinc-400";
  return (
    <span className={`text-xs mr-1 ${tone}`} aria-live="polite">
      {autosaveLabel(state)}
    </span>
  );
}

// Solo / Duo / Trio + a color row per lens (+ optional pattern repeat).
function LensPicker({
  lenses,
  repeat,
  showRepeat,
  onLenses,
  onRepeat,
}: {
  lenses: LensColorKey[];
  repeat: number;
  showRepeat: boolean;
  onLenses: (l: LensColorKey[]) => void;
  onRepeat: (n: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="label-caps">Light layout</div>
      <div className="grid grid-cols-3 gap-1.5">
        {LAYOUTS.map((l) => (
          <button
            key={l.n}
            type="button"
            aria-pressed={lenses.length === l.n}
            onClick={() => onLenses(resizeLenses(lenses, l.n))}
            className="seg-btn"
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-white/10">
        {lenses.map((lens, i) => (
          <div key={i} className="flex items-center gap-2 py-2">
            <span className="label-caps w-16 shrink-0 whitespace-nowrap">Lens {i + 1}</span>
            <div className="flex gap-1.5">
              {LENS_COLORS.map((c) => (
                // Named on hover / keyboard focus, for color-blind reps.
                <span key={c.key} className="relative group">
                  <button
                    type="button"
                    aria-pressed={lens === c.key}
                    aria-label={`Lens ${i + 1}: ${c.label}`}
                    onClick={() => onLenses(lenses.map((l, j) => (j === i ? c.key : l)))}
                    className="lens-dot block"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-8 z-10 whitespace-nowrap rounded-md bg-black text-white text-xs font-semibold px-2 py-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                  >
                    {c.label}
                  </span>
                </span>
              ))}
            </div>
            {/* The chosen color, in words. */}
            <span className="text-xs text-zinc-300 font-semibold w-12 shrink-0">{lensLabel(lens)}</span>
          </div>
        ))}
      </div>
      {showRepeat ? (
        <label className="flex items-center gap-3">
          <span className="label-caps whitespace-nowrap">Repeat</span>
          <input
            type="number"
            min={1}
            max={12}
            value={repeat}
            onChange={(e) => onRepeat(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
            className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
          />
          <span className="text-xs text-zinc-500">times across the light</span>
        </label>
      ) : null}
    </div>
  );
}

function ShapePicker({ value, onChange }: { value: Shape; onChange: (s: Shape) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {SHAPES.map((s) => (
        <button
          key={s.key}
          type="button"
          aria-pressed={value === s.key}
          onClick={() => onChange(s.key)}
          className="seg-btn !tracking-wider !px-1"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function OrientationPicker({ value, onChange }: { value: Orientation; onChange: (o: Orientation) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(["horizontal", "vertical"] as const).map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className="seg-btn !tracking-wider"
        >
          {o === "horizontal" ? "Horizontal" : "Vertical"}
        </button>
      ))}
    </div>
  );
}

// Inline editor for the selected light.
function PinEditor({
  pin,
  onChange,
  onDuplicate,
}: {
  pin: UpfitPin;
  onChange: (patch: Partial<UpfitPin>) => void;
  onDuplicate: () => void;
}) {
  const shape: Shape = pin.shape ?? "rect";
  const pushbar = isPushbarShape(shape);
  const lensState = pinLensState(pin);
  const hasOverride = pin.widthFracOverride != null || pin.heightFracOverride != null;

  const setShape = (s: Shape) => {
    const patch: Partial<UpfitPin> = { shape: s };
    // Bumpers need a real footprint; the preset sizes are light-sized.
    if (isPushbarShape(s) && !isPushbarShape(shape)) {
      patch.widthFracOverride = PUSHBAR_DEFAULT_FRAC.width;
      patch.heightFracOverride = PUSHBAR_DEFAULT_FRAC.height;
    } else if (!isPushbarShape(s) && isPushbarShape(shape)) {
      patch.widthFracOverride = undefined;
      patch.heightFracOverride = undefined;
    }
    onChange(patch);
  };

  return (
    <div className="border-t border-white/10 px-3 py-3 space-y-4">
      {!pushbar ? (
        <LensPicker
          lenses={lensState.lenses}
          repeat={lensState.repeat}
          showRepeat={shape === "rect"}
          onLenses={(l) => onChange({ lenses: l, lensRepeat: lensState.repeat > 1 ? lensState.repeat : undefined })}
          onRepeat={(n) => onChange({ lenses: lensState.lenses, lensRepeat: n > 1 ? n : undefined })}
        />
      ) : null}

      <div className="space-y-2">
        <div className="label-caps">Shape</div>
        <ShapePicker value={shape} onChange={setShape} />
        {shape === "rect" ? (
          <OrientationPicker
            value={pin.orientation ?? "horizontal"}
            onChange={(o) => onChange({ orientation: o })}
          />
        ) : null}
      </div>

      <label className="flex items-center gap-3">
        <span className="label-caps shrink-0">Rotate</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={pin.rotation ?? 0}
          onChange={(e) => onChange({ rotation: Number(e.target.value) || undefined })}
          className="flex-1 accent-[var(--color-cta)]"
        />
        <span className="text-xs text-zinc-400 w-10 text-right">{pin.rotation ?? 0}°</span>
      </label>

      {hasOverride && !pushbar ? (
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Custom size (dragged)</span>
          <button
            type="button"
            onClick={() => onChange({ widthFracOverride: undefined, heightFracOverride: undefined })}
            className="underline hover:text-white"
          >
            Reset size
          </button>
        </div>
      ) : null}

      <input
        value={pin.caption ?? ""}
        onChange={(e) => onChange({ caption: e.target.value || undefined })}
        placeholder="Label on diagram"
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
      />
      <input
        value={pin.notes ?? ""}
        onChange={(e) => onChange({ notes: e.target.value || undefined })}
        placeholder="Placement note (spec sheet only)"
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
      />

      <button type="button" onClick={onDuplicate} className="btn-outline btn-sm w-full">
        Duplicate light
      </button>
    </div>
  );
}
