"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  BODY_STYLES,
  COLOR_SCHEMES,
  PIN_SIZES,
  PIN_SIZE_ORDER,
  PUSHBAR_RECTS,
  PUSHBAR_VIEWBOX,
  colorSchemesByGroup,
  getColorScheme,
  getPinSize,
  getTemplate,
  getViews,
} from "@/lib/upfit/templates";
import type { UpfitPin } from "@/db/schema";

export type UpfitBuilderProps = {
  quoteId: string;
  initialBodyStyle: string;
  initialVehicleLabel: string;
  initialPins: UpfitPin[];
  initialNotes: string;
  parts: { id: string; sku: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
  // Builds/refreshes the linked quote's parts from the placed equipment.
  generateQuoteAction: (formData: FormData) => Promise<void>;
};

type Selection = { partId: string | null; label: string; partSku: string | null };

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Below this distance (fraction of the image box) a pointerdown is
// treated as a click-to-select rather than a drag, so tapping a pin to
// select it doesn't nudge its position.
const DRAG_THRESHOLD = 0.01;

export function UpfitBuilder({
  quoteId,
  initialBodyStyle,
  initialVehicleLabel,
  initialPins,
  initialNotes,
  parts,
  action,
  generateQuoteAction,
}: UpfitBuilderProps) {
  const [bodyStyle, setBodyStyle] = useState(initialBodyStyle);
  const [vehicleLabel, setVehicleLabel] = useState(initialVehicleLabel);
  const [pins, setPins] = useState<UpfitPin[]>(initialPins);
  const [notes, setNotes] = useState(initialNotes);
  const [selectedPartId, setSelectedPartId] = useState<string>("");
  const [customLabel, setCustomLabel] = useState("");
  const [pendingCaption, setPendingCaption] = useState("");
  const [pendingShape, setPendingShape] = useState<UpfitPin["shape"]>("rect");
  const [pendingSize, setPendingSize] = useState<UpfitPin["size"]>("medium");
  const [pendingColorScheme, setPendingColorScheme] = useState<string>("red_white");
  const [pendingOrientation, setPendingOrientation] = useState<UpfitPin["orientation"]>("horizontal");
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const template = useMemo(() => getTemplate(bodyStyle), [bodyStyle]);
  const views = useMemo(() => getViews(template), [template]);
  const colorGroups = useMemo(() => colorSchemesByGroup(), []);

  // Active view (one side of the vehicle). Reset to the first view
  // whenever the template changes so we never point at a stale key.
  const [activeView, setActiveView] = useState<string>(views[0]?.key ?? "main");
  const activeViewKey = views.some((v) => v.key === activeView) ? activeView : views[0]?.key ?? "main";
  const activeViewDef = views.find((v) => v.key === activeViewKey) ?? views[0];
  const firstViewKey = views[0]?.key ?? "main";
  // A pin belongs to a view via its `view` field; legacy pins with no
  // view fall onto the first view so nothing is orphaned.
  const pinViewKey = (p: UpfitPin) => p.view ?? firstViewKey;
  const visiblePins = pins.filter((p) => pinViewKey(p) === activeViewKey);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pinId: string; startX: number; startY: number; moved: boolean } | null>(
    null,
  );

  // The next pin to be added when the user clicks on the diagram. We
  // deliberately do NOT clear this after each placement so a single
  // selection can be placed multiple times (e.g. the same SKU on the
  // front and rear of the vehicle).
  const pendingSelection: Selection | null = useMemo(() => {
    if (selectedPartId) {
      const p = parts.find((pp) => pp.id === selectedPartId);
      if (p) return { partId: p.id, label: `${p.sku} — ${p.name}`, partSku: p.sku };
    }
    const trimmed = customLabel.trim();
    if (trimmed) return { partId: null, label: trimmed, partSku: null };
    return null;
  }, [selectedPartId, customLabel, parts]);

  const stopPlacing = () => {
    setSelectedPartId("");
    setCustomLabel("");
    setPendingCaption("");
  };

  const renumber = (arr: UpfitPin[]): UpfitPin[] =>
    arr.map((p, idx) => ({ ...p, number: idx + 1 }));

  const toFractional = (clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleBoxClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingSelection) return;
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    const id = randomId();
    setPins((cur) => [
      ...cur,
      {
        id,
        number: cur.length + 1,
        view: activeViewKey,
        x: f.x,
        y: f.y,
        label: pendingSelection.label,
        partId: pendingSelection.partId,
        partSku: pendingSelection.partSku,
        caption: pendingCaption.trim() || undefined,
        shape: pendingShape,
        size: pendingSize,
        colorScheme: pendingColorScheme,
        orientation: pendingOrientation,
      },
    ]);
    setActivePinId(id);
  };

  const handlePinPointerDown = (e: React.PointerEvent<HTMLDivElement>, pin: UpfitPin) => {
    e.stopPropagation();
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    dragRef.current = { pinId: pin.id, startX: f.x, startY: f.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePinPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    if (!drag.moved) {
      if (Math.hypot(f.x - drag.startX, f.y - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
    }
    setPins((cur) => cur.map((p) => (p.id === drag.pinId ? { ...p, x: f.x, y: f.y } : p)));
  };

  const handlePinPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!drag.moved) setActivePinId(drag.pinId);
    dragRef.current = null;
  };

  const removePin = (id: string) => {
    setPins((cur) => renumber(cur.filter((p) => p.id !== id)));
    if (activePinId === id) setActivePinId(null);
  };

  const updatePin = (id: string, patch: Partial<UpfitPin>) => {
    setPins((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  // Lower bound stops the pin from collapsing to nothing while dragging
  // the handle; upper bound stops it from eating the whole diagram.
  const clampSize = (v: number) => Math.max(0.006, Math.min(0.6, v));

  // Resize handler invoked by PlacedPin as the user drags its handle.
  // The pin is centered on (x, y), so the cursor-to-center distance
  // gives the half-extent — doubled for width/height.
  const resizePin = (id: string, clientX: number, clientY: number) => {
    const f = toFractional(clientX, clientY);
    if (!f) return;
    setPins((cur) =>
      cur.map((p) => {
        if (p.id !== id) return p;
        const w = clampSize(Math.abs(f.x - p.x) * 2);
        const h = clampSize(Math.abs(f.y - p.y) * 2);
        // Circles stay round — use the larger drag axis as diameter so
        // a diagonal drag feels natural.
        if (p.shape === "circle") {
          const d = Math.max(w, h);
          return { ...p, widthFracOverride: d, heightFracOverride: d };
        }
        return { ...p, widthFracOverride: w, heightFracOverride: h };
      }),
    );
  };

  const resetPinSize = (id: string) => {
    setPins((cur) =>
      cur.map((p) =>
        p.id === id
          ? { ...p, widthFracOverride: undefined, heightFracOverride: undefined }
          : p,
      ),
    );
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("bodyStyle", bodyStyle);
    fd.set("vehicleLabel", vehicleLabel);
    fd.set("pins", JSON.stringify(pins));
    fd.set("notes", notes);
    return fd;
  };

  const handleSave = () => {
    setSaveMsg(null);
    const fd = buildFormData();
    startTransition(async () => {
      try {
        await action(fd);
        setSaveMsg("Saved.");
      } catch {
        setSaveMsg("Save failed — try again.");
      }
    });
  };

  // Save the current diagram AND (re)build the linked quote's parts from
  // the placed equipment. The server action redirects to the quote, so
  // there's no success message to show here.
  const handleGenerateQuote = () => {
    setSaveMsg(null);
    const fd = buildFormData();
    startTransition(async () => {
      try {
        await generateQuoteAction(fd);
      } catch {
        setSaveMsg("Couldn't generate the quote — try again.");
      }
    });
  };

  // Render the color dropdown's options grouped by category so the
  // 40-some schemes don't form one giant flat list.
  const renderColorOptions = () =>
    colorGroups.map((g) => (
      <optgroup key={g.group} label={g.label}>
        {g.keys.map((k) => (
          <option key={k} value={k}>
            {COLOR_SCHEMES[k].label}
          </option>
        ))}
      </optgroup>
    ));

  return (
    <div className="space-y-4">
      {/* Vehicle identity */}
      <div className="bg-[#161624] border border-white/5 rounded-lg p-3 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3 items-end">
        <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
          Vehicle template
          <select
            value={bodyStyle}
            onChange={(e) => setBodyStyle(e.target.value)}
            className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
          >
            {BODY_STYLES.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
          Vehicle (make &amp; model — printed on the diagram)
          <input
            value={vehicleLabel}
            onChange={(e) => setVehicleLabel(e.target.value)}
            placeholder="e.g. 2024 Chevrolet Tahoe PPV"
            className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
          />
        </label>
      </div>

      {/* Equipment toolbar */}
      <div className="bg-[#161624] border border-white/5 rounded-lg p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Pick a part from inventory
            <select
              value={selectedPartId}
              onChange={(e) => {
                setSelectedPartId(e.target.value);
                if (e.target.value) setCustomLabel("");
              }}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            >
              <option value="">— select part —</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            …or custom label
            <input
              value={customLabel}
              onChange={(e) => {
                setCustomLabel(e.target.value);
                if (e.target.value) setSelectedPartId("");
              }}
              placeholder="e.g. Whelen Liberty II"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-1.5 font-semibold disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save upfit"}
            </button>
            <button
              type="button"
              onClick={handleGenerateQuote}
              disabled={isPending}
              title="Save the diagram and rebuild the quote's parts from the placed equipment"
              className="text-[11px] font-body bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/15 rounded-md px-4 py-1.5 disabled:opacity-60"
            >
              Generate quote from equipment
            </button>
          </div>
        </div>

        {/* Shape controls — what the next placed pin will look like. */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end pt-2 border-t border-white/5">
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Shape
            <select
              value={pendingShape}
              onChange={(e) => setPendingShape(e.target.value as UpfitPin["shape"])}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            >
              <option value="rect">Rectangle</option>
              <option value="circle">Circle</option>
              <option value="pushbar">Push bumper</option>
            </select>
          </label>
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Color
            <select
              value={pendingColorScheme}
              onChange={(e) => setPendingColorScheme(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            >
              {renderColorOptions()}
            </select>
          </label>
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Size
            <select
              value={pendingSize}
              onChange={(e) => setPendingSize(e.target.value as UpfitPin["size"])}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            >
              {PIN_SIZE_ORDER.map((k) => (
                <option key={k} value={k}>
                  {PIN_SIZES[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Orientation
            <select
              value={pendingOrientation}
              onChange={(e) =>
                setPendingOrientation(e.target.value as UpfitPin["orientation"])
              }
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
              disabled={pendingShape === "circle"}
              title={pendingShape === "circle" ? "Orientation doesn't apply to circles" : undefined}
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
          <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
            Caption on diagram (optional)
            <input
              value={pendingCaption}
              onChange={(e) => setPendingCaption(e.target.value)}
              placeholder="e.g. VXE SMOKED LENS R/W"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-body"
            />
          </label>
        </div>

        {/* Live preview of what the next pin will look like. */}
        <div className="flex items-center gap-3 text-[10px] font-body text-zinc-400 uppercase tracking-wider">
          <span>Preview:</span>
          <PinPreview
            shape={pendingShape ?? "rect"}
            colorScheme={pendingColorScheme}
            size={pendingSize ?? "medium"}
            orientation={pendingOrientation ?? "horizontal"}
          />
          {pendingCaption.trim() ? (
            <span className="text-[10px] text-zinc-300 normal-case tracking-normal">
              {pendingCaption.trim()}
            </span>
          ) : null}
        </div>
      </div>

      {/* Hint banner */}
      <div
        className={`flex items-center justify-between gap-3 text-[11px] font-body rounded-md px-3 py-2 border ${
          pendingSelection
            ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
            : "bg-white/5 border-white/10 text-zinc-400"
        }`}
      >
        <span>
          {pendingSelection
            ? `Click on the diagram to place: ${pendingSelection.label}. Place it as many times as you need. Drag any placed pin to move it.`
            : "Pick a part or type a custom label, then click on the diagram to place a pin. Drag placed pins to move them."}
          {saveMsg ? <span className="ml-3 text-zinc-300">{saveMsg}</span> : null}
        </span>
        {pendingSelection ? (
          <button
            type="button"
            onClick={stopPlacing}
            className="shrink-0 text-[10px] text-amber-200 hover:text-white border border-amber-500/40 hover:border-amber-300 rounded px-2 py-0.5"
          >
            Stop placing
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Diagram */}
        <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
          <div className="mb-2">
            <div className="text-xs font-body font-semibold text-white">
              {vehicleLabel.trim() || "Vehicle (unset)"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              {template.label}
            </div>
          </div>

          {/* View switcher — one tab per side of the vehicle. Hidden for
              single-view templates. Each tab shows how many pins it holds. */}
          {views.length > 1 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {views.map((v) => {
                const count = pins.filter((p) => pinViewKey(p) === v.key).length;
                const active = v.key === activeViewKey;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setActiveView(v.key)}
                    className={`text-[11px] font-body px-2.5 py-1 rounded border transition-colors ${
                      active
                        ? "bg-amber-500 text-black border-amber-400 font-semibold"
                        : "bg-black/30 text-zinc-300 border-white/10 hover:border-amber-500/50"
                    }`}
                  >
                    {v.label}
                    {count > 0 ? (
                      <span className={`ml-1 ${active ? "text-black/70" : "text-amber-400"}`}>
                        ({count})
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div
            ref={boxRef}
            onClick={handleBoxClick}
            className="relative w-full bg-white rounded border border-white/10 overflow-hidden select-none"
            style={{ cursor: pendingSelection ? "crosshair" : "default", touchAction: "none" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={activeViewKey}
              src={activeViewDef?.imageUrl ?? template.imageUrl}
              alt={`${template.label} — ${activeViewDef?.label ?? ""}`}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
            />
            {visiblePins.map((pin) => (
              <PlacedPin
                key={pin.id}
                pin={pin}
                isActive={activePinId === pin.id}
                onPointerDown={(e) => handlePinPointerDown(e, pin)}
                onPointerMove={handlePinPointerMove}
                onPointerUp={handlePinPointerUp}
                onResize={resizePin}
              />
            ))}
          </div>
        </div>

        {/* Pin list / sidebar */}
        <div className="space-y-3">
          <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-2">
              Placed pins ({pins.length})
            </div>
            {pins.length === 0 ? (
              <p className="text-xs text-zinc-500 font-body italic">
                No pins yet. Pick a part above and click on the diagram.
              </p>
            ) : (
              <ul className="space-y-2">
                {pins.map((pin) => (
                  <li
                    key={pin.id}
                    className={`border rounded p-2 ${
                      activePinId === pin.id
                        ? "border-amber-500/60 bg-amber-500/5"
                        : "border-white/10 bg-black/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PinPreview
                        shape={pin.shape ?? "rect"}
                        colorScheme={pin.colorScheme ?? pin.color ?? "red_white"}
                        size={pin.size ?? "medium"}
                        orientation={pin.orientation ?? "horizontal"}
                      />
                      <span className="text-[11px] text-zinc-300 font-body flex-1 truncate">
                        {pin.caption?.trim() || pin.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePin(pin.id)}
                        className="text-[10px] text-zinc-500 hover:text-red-400 font-body"
                      >
                        remove
                      </button>
                    </div>

                    {views.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView(pinViewKey(pin));
                          setActivePinId(pin.id);
                        }}
                        className={`mt-1 text-[10px] font-body ${
                          pinViewKey(pin) === activeViewKey
                            ? "text-amber-400"
                            : "text-zinc-500 hover:text-amber-300 underline"
                        }`}
                      >
                        {views.find((v) => v.key === pinViewKey(pin))?.label ?? "View"}
                        {pinViewKey(pin) !== activeViewKey ? " → show" : ""}
                      </button>
                    ) : null}

                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <select
                        value={pin.shape ?? "rect"}
                        onChange={(e) =>
                          updatePin(pin.id, { shape: e.target.value as UpfitPin["shape"] })
                        }
                        className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-body"
                      >
                        <option value="rect">Rectangle</option>
                        <option value="circle">Circle</option>
                        <option value="pushbar">Push bumper</option>
                      </select>
                      <select
                        value={pin.colorScheme ?? "red_white"}
                        onChange={(e) => updatePin(pin.id, { colorScheme: e.target.value })}
                        className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-body"
                      >
                        {colorGroups.map((g) => (
                          <optgroup key={g.group} label={g.label}>
                            {g.keys.map((k) => (
                              <option key={k} value={k}>
                                {COLOR_SCHEMES[k].label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <select
                        value={pin.size ?? "medium"}
                        onChange={(e) =>
                          updatePin(pin.id, { size: e.target.value as UpfitPin["size"] })
                        }
                        className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-body"
                      >
                        {PIN_SIZE_ORDER.map((k) => (
                          <option key={k} value={k}>
                            {PIN_SIZES[k].label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={pin.orientation ?? "horizontal"}
                        onChange={(e) =>
                          updatePin(pin.id, {
                            orientation: e.target.value as UpfitPin["orientation"],
                          })
                        }
                        disabled={(pin.shape ?? "rect") === "circle"}
                        className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-body disabled:opacity-50"
                      >
                        <option value="horizontal">Horizontal</option>
                        <option value="vertical">Vertical</option>
                      </select>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body shrink-0">
                        Rotate
                      </span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={pin.rotation ?? 0}
                        onChange={(e) => updatePin(pin.id, { rotation: Number(e.target.value) })}
                        className="flex-1 accent-amber-500"
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        value={pin.rotation ?? 0}
                        onChange={(e) => updatePin(pin.id, { rotation: Number(e.target.value) || 0 })}
                        className="w-14 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white text-right font-body"
                      />
                      <span className="text-[10px] text-zinc-500 font-body">°</span>
                      {pin.rotation ? (
                        <button
                          type="button"
                          onClick={() => updatePin(pin.id, { rotation: 0 })}
                          className="text-[10px] text-zinc-400 hover:text-amber-300 font-body"
                        >
                          reset
                        </button>
                      ) : null}
                    </div>

                    {(pin.widthFracOverride !== undefined ||
                      pin.heightFracOverride !== undefined) && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-body text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                        <span>
                          Custom size · W {((pin.widthFracOverride ?? 0) * 100).toFixed(1)}% · H{" "}
                          {((pin.heightFracOverride ?? 0) * 100).toFixed(1)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => resetPinSize(pin.id)}
                          className="text-[10px] text-amber-200 hover:text-white underline"
                        >
                          reset
                        </button>
                      </div>
                    )}

                    <input
                      value={pin.caption ?? ""}
                      onChange={(e) => updatePin(pin.id, { caption: e.target.value })}
                      placeholder="caption (shown on diagram)"
                      className="mt-1.5 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white font-body"
                    />
                    <input
                      value={pin.notes ?? ""}
                      onChange={(e) => updatePin(pin.id, { notes: e.target.value })}
                      placeholder="internal placement note (PDF table only)"
                      className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white font-body"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              Build notes (printed on the PDF)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Wiring notes, mounting preferences, customer requests…"
              className="mt-1 w-full bg-[#161624] border border-white/10 rounded p-2 text-xs text-white font-body"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

// Small inline preview of a pin — the same shape rendering logic the
// diagram uses, just sized to fit in a sidebar row.
function PinPreview({
  shape,
  colorScheme,
  size,
  orientation,
}: {
  shape: NonNullable<UpfitPin["shape"]>;
  colorScheme: string;
  size: NonNullable<UpfitPin["size"]>;
  orientation: NonNullable<UpfitPin["orientation"]>;
}) {
  const scheme = getColorScheme(colorScheme);
  const sz = getPinSize(size);
  // Tiny sidebar scale — the live diagram uses the fractional values
  // against the rendered image, this preview just shows the shape.
  const sidebarDims: Record<string, { long: number; short: number }> = {
    small: { long: 12, short: 7 },
    medium: { long: 18, short: 10 },
    large: { long: 26, short: 13 },
    strip_small: { long: 36, short: 9 },
    strip_medium: { long: 56, short: 10 },
    strip_large: { long: 76, short: 11 },
    strip: { long: 56, short: 10 },
  };
  const { long, short } = sidebarDims[sz.key] ?? sidebarDims.medium;
  if (shape === "pushbar") {
    return (
      <span className="inline-block shrink-0" style={{ width: 26, height: 14 }}>
        <PushbarGlyph />
      </span>
    );
  }
  // Circles ignore orientation and use the long dimension as diameter.
  const w = shape === "circle" ? long : orientation === "horizontal" ? long : short;
  const h = shape === "circle" ? long : orientation === "horizontal" ? short : long;
  // Subtle rounded corners on rectangles; circles are fully round.
  const radius =
    shape === "circle" ? "50%" : `${Math.max(1, Math.round(Math.min(w, h) * 0.25))}px`;
  return (
    <span
      className="inline-block border border-black/70 shrink-0 overflow-hidden"
      style={{
        width: w,
        height: h,
        borderRadius: radius,
      }}
    >
      <span
        className="flex w-full h-full"
        style={{ flexDirection: orientation === "horizontal" || shape === "circle" ? "row" : "column" }}
      >
        {scheme.segments.map((c, i) => (
          <span key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </span>
    </span>
  );
}

// A single pin placed on the diagram — segmented rectangle or circle +
// caption text rendered below. All sizing is relative so the pin looks
// consistent in the editor and prints identically in the PDF. No
// number rendered on the pin itself; the caption is the identifier.
//
// When the pin is selected (isActive), a resize handle appears in the
// bottom-right corner. Dragging it adjusts widthFracOverride /
// heightFracOverride directly, overriding the preset size for that pin
// only.
function PlacedPin({
  pin,
  isActive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResize,
}: {
  pin: UpfitPin;
  isActive: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResize: (id: string, clientX: number, clientY: number) => void;
}) {
  const scheme = getColorScheme(pin.colorScheme);
  const sz = getPinSize(pin.size);
  const isCircle = pin.shape === "circle";
  const isPushbar = pin.shape === "pushbar";
  // A drag-resize override is stored as LITERAL width/height fractions of
  // the diagram box (screen-x → width, screen-y → height). Used directly
  // so vertical pins resize the same way horizontal ones do. Without an
  // override we fall back to the preset, swapping long/short for vertical.
  const hasOverride =
    pin.widthFracOverride != null && pin.heightFracOverride != null;
  const widthPct = isCircle
    ? (pin.widthFracOverride ?? sz.widthFrac) * 100
    : hasOverride
      ? (pin.widthFracOverride as number) * 100
      : (pin.orientation === "vertical" ? sz.heightFrac : sz.widthFrac) * 100;
  const heightPct = isCircle
    ? (pin.widthFracOverride ?? sz.widthFrac) * 100
    : hasOverride
      ? (pin.heightFracOverride as number) * 100
      : (pin.orientation === "vertical" ? sz.widthFrac : sz.heightFrac) * 100;

  const resizingRef = useRef(false);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    resizingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onResize(pin.id, e.clientX, e.clientY);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    e.stopPropagation();
    onResize(pin.id, e.clientX, e.clientY);
  };

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    e.stopPropagation();
    resizingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
      }}
      title={pin.caption || pin.label}
    >
      {/* The shape itself — captures pin-drag (move) pointer events. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-0 overflow-hidden ${isPushbar ? "" : "border border-black"}`}
        style={{
          cursor: "grab",
          touchAction: "none",
          borderRadius: isCircle ? "50%" : isPushbar ? undefined : `${Math.min(widthPct, heightPct) * 0.25}%`,
          boxShadow: isActive ? "0 0 0 2px #f59e0b" : undefined,
          transform: pin.rotation ? `rotate(${pin.rotation}deg)` : undefined,
        }}
      >
        {isPushbar ? (
          <PushbarGlyph />
        ) : (
          <div
            className="flex w-full h-full"
            style={{
              flexDirection:
                isCircle || pin.orientation !== "vertical" ? "row" : "column",
            }}
          >
            {scheme.segments.map((c, i) => (
              <div key={i} style={{ flex: 1, backgroundColor: c }} />
            ))}
          </div>
        )}
      </div>

      {/* Resize handle — only visible when this pin is selected. Sits
          on the bottom-right outside the shape so it stays grabbable
          even when the shape is tiny. */}
      {isActive ? (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onClick={(e) => e.stopPropagation()}
          className="absolute"
          style={{
            right: -6,
            bottom: -6,
            width: 12,
            height: 12,
            backgroundColor: "#f59e0b",
            border: "1.5px solid #000",
            borderRadius: 2,
            cursor: "nwse-resize",
            touchAction: "none",
            zIndex: 2,
          }}
          title="Drag to resize"
        />
      ) : null}

      {/* Caption rendered below the pin in a small white-background pill
          so it stays legible against any vehicle color. */}
      {pin.caption ? (
        <div
          className="absolute left-1/2 -translate-x-1/2 mt-0.5 px-1 py-px bg-white/95 border border-black/40 text-[8px] font-bold text-black whitespace-nowrap pointer-events-none"
          style={{ top: "100%", letterSpacing: "0.02em" }}
        >
          {pin.caption}
        </div>
      ) : null}
    </div>
  );
}

// Push-bumper / grille-guard glyph. Neutral steel look (push bumpers are
// black powder-coated), rendered as an outer frame with vertical slats so
// it reads as a front-mount bumper regardless of size. Fills its parent.
// Push-bumper (grille guard) outline modeled on the Pro-gard style: two
// rounded uprights with three horizontal cross bars. Drawn as filled
// rounded rects on a shared viewBox with preserveAspectRatio="none" so
// it stretches to whatever size the pin is resized to. Geometry is
// shared with the PDF renderer via templates.ts.
function PushbarGlyph() {
  return (
    <svg
      viewBox={`0 0 ${PUSHBAR_VIEWBOX.w} ${PUSHBAR_VIEWBOX.h}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      {PUSHBAR_RECTS.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} ry={r.r} fill="#18181b" />
      ))}
    </svg>
  );
}
