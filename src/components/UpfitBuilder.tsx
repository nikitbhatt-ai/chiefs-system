"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  BODY_STYLES,
  getTemplate,
  nextPinColor,
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
}: UpfitBuilderProps) {
  const [bodyStyle, setBodyStyle] = useState(initialBodyStyle);
  const [vehicleLabel, setVehicleLabel] = useState(initialVehicleLabel);
  const [pins, setPins] = useState<UpfitPin[]>(initialPins);
  const [notes, setNotes] = useState(initialNotes);
  const [selectedPartId, setSelectedPartId] = useState<string>("");
  const [customLabel, setCustomLabel] = useState("");
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const template = useMemo(() => getTemplate(bodyStyle), [bodyStyle]);

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
  };

  const renumber = (arr: UpfitPin[]): UpfitPin[] =>
    arr.map((p, idx) => ({ ...p, number: idx + 1 }));

  // Convert a client (mouse) coordinate into a fractional 0..1 position
  // inside the image box.
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
        x: f.x,
        y: f.y,
        label: pendingSelection.label,
        partId: pendingSelection.partId,
        partSku: pendingSelection.partSku,
        color: nextPinColor(cur.length),
      },
    ]);
    setActivePinId(id);
  };

  const handlePinPointerDown = (e: React.PointerEvent<HTMLButtonElement>, pin: UpfitPin) => {
    e.stopPropagation();
    const f = toFractional(e.clientX, e.clientY);
    if (!f) return;
    dragRef.current = { pinId: pin.id, startX: f.x, startY: f.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePinPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
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

  const handlePinPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
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

  const handleSave = () => {
    setSaveMsg(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("bodyStyle", bodyStyle);
    fd.set("vehicleLabel", vehicleLabel);
    fd.set("pins", JSON.stringify(pins));
    fd.set("notes", notes);
    startTransition(async () => {
      try {
        await action(fd);
        setSaveMsg("Saved.");
      } catch {
        setSaveMsg("Save failed — try again.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Vehicle identity */}
      <div className="bg-[#161624] border border-white/5 rounded-lg p-3 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 items-end">
        <label className="text-[10px] font-body text-zinc-400 uppercase tracking-wider">
          Body style
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
      <div className="bg-[#161624] border border-white/5 rounded-lg p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
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

        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-1.5 font-semibold disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save upfit"}
        </button>
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
          <div
            ref={boxRef}
            onClick={handleBoxClick}
            className="relative w-full bg-white rounded border border-white/10 overflow-hidden select-none"
            style={{ cursor: pendingSelection ? "crosshair" : "default", touchAction: "none" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={template.imageUrl}
              alt={template.label}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
            />
            {pins.map((pin) => {
              const isActive = activePinId === pin.id;
              return (
                <button
                  key={pin.id}
                  type="button"
                  onPointerDown={(e) => handlePinPointerDown(e, pin)}
                  onPointerMove={handlePinPointerMove}
                  onPointerUp={handlePinPointerUp}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black text-black text-[11px] font-bold flex items-center justify-center"
                  style={{
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    width: isActive ? 26 : 22,
                    height: isActive ? 26 : 22,
                    backgroundColor: pin.color ?? "#f59e0b",
                    cursor: "grab",
                    touchAction: "none",
                    boxShadow: isActive ? "0 0 0 2px #f59e0b" : undefined,
                  }}
                >
                  {pin.number}
                </button>
              );
            })}
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
                      <span
                        className="inline-flex items-center justify-center text-[10px] font-bold text-black rounded-full w-5 h-5"
                        style={{ backgroundColor: pin.color ?? "#f59e0b" }}
                      >
                        {pin.number}
                      </span>
                      <span className="text-[11px] text-zinc-300 font-body flex-1 truncate">
                        {pin.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePin(pin.id)}
                        className="text-[10px] text-zinc-500 hover:text-red-400 font-body"
                      >
                        remove
                      </button>
                    </div>
                    <input
                      value={pin.notes ?? ""}
                      onChange={(e) => updatePin(pin.id, { notes: e.target.value })}
                      placeholder="placement note (optional)"
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
