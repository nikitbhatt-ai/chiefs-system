"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  BODY_STYLES,
  VEHICLE_TEMPLATES,
  VIEW_LABELS,
  VIEW_ORDER,
  VIEW_VIEWBOX,
  getTemplate,
  nextPinColor,
  type ViewKey,
} from "@/lib/upfit/templates";
import type { UpfitPin } from "@/db/schema";

export type UpfitBuilderProps = {
  quoteId: string;
  initialBodyStyle: string;
  initialPins: UpfitPin[];
  initialNotes: string;
  parts: { id: string; sku: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
};

type Selection = { partId: string | null; label: string; partSku: string | null };

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function UpfitBuilder({
  quoteId,
  initialBodyStyle,
  initialPins,
  initialNotes,
  parts,
  action,
}: UpfitBuilderProps) {
  const [bodyStyle, setBodyStyle] = useState(initialBodyStyle);
  const [pins, setPins] = useState<UpfitPin[]>(initialPins);
  const [notes, setNotes] = useState(initialNotes);
  const [selectedPartId, setSelectedPartId] = useState<string>("");
  const [customLabel, setCustomLabel] = useState("");
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const template = useMemo(() => getTemplate(bodyStyle), [bodyStyle]);

  // The next pin to be added when the user clicks on the diagram.
  const pendingSelection: Selection | null = useMemo(() => {
    if (selectedPartId) {
      const p = parts.find((pp) => pp.id === selectedPartId);
      if (p) return { partId: p.id, label: `${p.sku} — ${p.name}`, partSku: p.sku };
    }
    const trimmed = customLabel.trim();
    if (trimmed) return { partId: null, label: trimmed, partSku: null };
    return null;
  }, [selectedPartId, customLabel, parts]);

  const renumber = (arr: UpfitPin[]): UpfitPin[] =>
    arr.map((p, idx) => ({ ...p, number: idx + 1 }));

  const placePin = useCallback(
    (view: ViewKey, x: number, y: number) => {
      if (!pendingSelection) return;
      const id = randomId();
      const next: UpfitPin = {
        id,
        number: pins.length + 1,
        view,
        x,
        y,
        label: pendingSelection.label,
        partId: pendingSelection.partId,
        partSku: pendingSelection.partSku,
        color: nextPinColor(pins.length),
      };
      setPins([...pins, next]);
      setActivePinId(id);
      // Clear the staging fields so the next click doesn't double-place
      // the same part by accident.
      setSelectedPartId("");
      setCustomLabel("");
    },
    [pendingSelection, pins],
  );

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
      {/* Toolbar */}
      <div className="bg-[#161624] border border-white/5 rounded-lg p-3 grid grid-cols-1 md:grid-cols-[200px_1fr_1fr_auto] gap-3 items-end">
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
        className={`text-[11px] font-body rounded-md px-3 py-2 border ${
          pendingSelection
            ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
            : "bg-white/5 border-white/10 text-zinc-400"
        }`}
      >
        {pendingSelection
          ? `Click anywhere on a vehicle view to place: ${pendingSelection.label}`
          : "Pick a part or type a custom label, then click on a vehicle view to place a pin."}
        {saveMsg ? <span className="ml-3 text-zinc-300">{saveMsg}</span> : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Diagram grid */}
        <div className="space-y-3">
          {VIEW_ORDER.map((view) => (
            <UpfitView
              key={view}
              view={view}
              paths={template.views[view].paths}
              pins={pins.filter((p) => p.view === view)}
              activePinId={activePinId}
              canPlace={!!pendingSelection}
              onPlace={(x, y) => placePin(view, x, y)}
              onSelect={(id) => setActivePinId(id)}
            />
          ))}
        </div>

        {/* Pin list / sidebar */}
        <div className="space-y-3">
          <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-2">
              Placed pins ({pins.length})
            </div>
            {pins.length === 0 ? (
              <p className="text-xs text-zinc-500 font-body italic">
                No pins yet. Pick a part above and click on a view.
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
                    <div className="mt-1 text-[10px] text-zinc-500 font-body">
                      {VIEW_LABELS[pin.view]}
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

function UpfitView({
  view,
  paths,
  pins,
  activePinId,
  canPlace,
  onPlace,
  onSelect,
}: {
  view: ViewKey;
  paths: string[];
  pins: UpfitPin[];
  activePinId: string | null;
  canPlace: boolean;
  onPlace: (x: number, y: number) => void;
  onSelect: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!canPlace) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    onPlace(local.x / VIEW_VIEWBOX.width, local.y / VIEW_VIEWBOX.height);
  };

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-2">
        {VIEW_LABELS[view]}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_VIEWBOX.width} ${VIEW_VIEWBOX.height}`}
        onClick={handleClick}
        style={{ cursor: canPlace ? "crosshair" : "default" }}
        className="w-full h-auto bg-white rounded border border-white/10"
      >
        <g stroke="#1f2937" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round">
          {paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {pins.map((pin) => {
          const cx = pin.x * VIEW_VIEWBOX.width;
          const cy = pin.y * VIEW_VIEWBOX.height;
          const isActive = activePinId === pin.id;
          return (
            <g
              key={pin.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(pin.id);
              }}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? 22 : 18}
                fill={pin.color ?? "#f59e0b"}
                stroke="#000"
                strokeWidth={2}
              />
              <text
                x={cx}
                y={cy + 6}
                textAnchor="middle"
                fontSize={18}
                fontWeight={700}
                fill="#000"
              >
                {pin.number}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
