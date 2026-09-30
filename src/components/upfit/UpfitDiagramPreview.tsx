// Read-only picture of a saved vehicle configuration, shown in the
// estimate's "Vehicle & Lights" card. Multi-view templates show every
// side that has lights on it (or the first side when none do).

import type { UpfitPin } from "@/db/schema";
import { getTemplate, getViews } from "@/lib/upfit/templates";
import { PinOnDiagram } from "./PinGraphics";

export function UpfitDiagramPreview({ bodyStyle, pins }: { bodyStyle: string; pins: UpfitPin[] }) {
  const template = getTemplate(bodyStyle);
  const views = getViews(template);
  const firstKey = views[0]?.key ?? "main";
  const viewOf = (p: UpfitPin) => p.view ?? firstKey;
  const withPins = views.filter((v) => pins.some((p) => viewOf(p) === v.key));
  const shown = withPins.length > 0 ? withPins : views.slice(0, 1);

  return (
    <div className={`grid gap-3 ${shown.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {shown.map((v) => (
        <figure key={v.key} className="min-w-0">
          <div className="upfit-canvas relative w-full rounded-xl overflow-hidden border border-white/10 select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={v.imageUrl}
              alt={`${template.label} — ${v.label}`}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
            />
            {pins
              .filter((p) => viewOf(p) === v.key)
              .map((p) => (
                <PinOnDiagram key={p.id} pin={p} />
              ))}
          </div>
          {views.length > 1 ? (
            <figcaption className="label-caps mt-1.5">{v.label}</figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}
