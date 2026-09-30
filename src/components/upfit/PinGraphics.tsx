// Shared drawing code for upfit diagram pins. Used by the configurator
// (interactive, with drag handlers passed in) and by the read-only
// diagram preview on the estimate page, so a light looks identical in
// both places. No hooks here — safe to render from a server component.

import type React from "react";
import type { UpfitPin } from "@/db/schema";
import {
  getPinSize,
  getPushbarStyle,
  isPushbarShape,
  pinColorWords,
  pinSegments,
} from "@/lib/upfit/templates";

// Width/height of a pin as a percentage of the diagram box. A drag-resize
// override is stored as literal fractions (screen-x → width, screen-y →
// height); without one, the preset size is used and long/short swap for
// vertical pins.
export function pinBoxPct(pin: UpfitPin): { widthPct: number; heightPct: number } {
  const sz = getPinSize(pin.size);
  if (pin.shape === "circle") {
    const d = (pin.widthFracOverride ?? sz.widthFrac) * 100;
    return { widthPct: d, heightPct: d };
  }
  if (pin.widthFracOverride != null && pin.heightFracOverride != null) {
    return { widthPct: pin.widthFracOverride * 100, heightPct: pin.heightFracOverride * 100 };
  }
  const vertical = pin.orientation === "vertical";
  return {
    widthPct: (vertical ? sz.heightFrac : sz.widthFrac) * 100,
    heightPct: (vertical ? sz.widthFrac : sz.heightFrac) * 100,
  };
}

type ShapeHandlers = {
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
};

// One pin positioned on the diagram: the colored shape plus its caption.
// `children` renders inside the positioned box (the configurator puts its
// resize handle there).
export function PinOnDiagram({
  pin,
  active = false,
  interactive = false,
  handlers,
  children,
}: {
  pin: UpfitPin;
  active?: boolean;
  interactive?: boolean;
  handlers?: ShapeHandlers;
  children?: React.ReactNode;
}) {
  const { widthPct, heightPct } = pinBoxPct(pin);
  const isCircle = pin.shape === "circle";
  const isPushbar = isPushbarShape(pin.shape);
  const segments = pinSegments(pin);

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
      }}
      // Name + colors in words on hover (color-blind friendly).
      title={isPushbar ? pin.caption || pin.label : `${pin.caption || pin.label} — ${pinColorWords(pin)}`}
    >
      <div
        {...handlers}
        className={`absolute inset-0 overflow-hidden ${isPushbar ? "" : "border border-black"}`}
        style={{
          cursor: interactive ? "grab" : undefined,
          touchAction: interactive ? "none" : undefined,
          borderRadius: isCircle
            ? "50%"
            : isPushbar
              ? undefined
              : `${Math.min(widthPct, heightPct) * 0.25}%`,
          boxShadow: active ? "0 0 0 2px var(--color-cta)" : undefined,
          transform: pin.rotation ? `rotate(${pin.rotation}deg)` : undefined,
        }}
      >
        {isPushbar ? (
          <PushbarGlyph shape={pin.shape} />
        ) : (
          <div
            className="flex w-full h-full"
            style={{ flexDirection: isCircle || pin.orientation !== "vertical" ? "row" : "column" }}
          >
            {segments.map((c, i) => (
              <div key={i} style={{ flex: 1, backgroundColor: c }} />
            ))}
          </div>
        )}
      </div>

      {children}

      {/* Caption below the pin on a white pill so it reads on any paint. */}
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

// Push-bumper outline, stretched to fill its parent. Geometry is shared
// with the PDF renderer via templates.ts.
export function PushbarGlyph({ shape }: { shape?: string }) {
  const style = getPushbarStyle(shape);
  return (
    <svg
      viewBox={`0 0 ${style.viewBox.w} ${style.viewBox.h}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      {(style.rects ?? []).map((r, i) => (
        <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} ry={r.r} fill="#18181b" />
      ))}
      {(style.paths ?? []).map((d, i) => (
        <path
          key={`p${i}`}
          d={d}
          fill="none"
          stroke="#18181b"
          strokeWidth={style.strokeWidth ?? 8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

// Small fixed-size swatch of a light for lists (not to diagram scale).
export function LightSwatch({ pin }: { pin: Pick<UpfitPin, "shape" | "lenses" | "lensRepeat" | "colorScheme" | "orientation"> }) {
  if (isPushbarShape(pin.shape)) {
    return (
      <span className="inline-block shrink-0 bg-white rounded p-0.5" style={{ width: 30, height: 20 }}>
        <PushbarGlyph shape={pin.shape} />
      </span>
    );
  }
  const segments = pinSegments(pin);
  const isCircle = pin.shape === "circle";
  const vertical = !isCircle && pin.orientation === "vertical";
  const w = isCircle ? 18 : vertical ? 12 : 34;
  const h = isCircle ? 18 : vertical ? 26 : 12;
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden border border-black/70"
      style={{
        width: w,
        height: h,
        borderRadius: isCircle ? "50%" : 3,
        flexDirection: vertical ? "column" : "row",
      }}
    >
      {segments.map((c, i) => (
        <span key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
    </span>
  );
}
