// Vehicle template definitions for the Upfit Builder. Each template is
// ONE composite blueprint image (the multi-view picture sales already
// works from — top / front / rear / sides all in a single image).
// Pins are placed freely anywhere on that image and stored as fractional
// (x, y) coordinates 0..1 of the image box, so they render identically
// on screen, in print, and in the PDF regardless of display size.
//
// Templates are per-vehicle (Tahoe, Silverado, F-150, …) rather than per
// body style — sales picks the actual model so the diagram on the spec
// matches the truck. Adding a new vehicle: drop the JPG at
// `public/upfit-templates/<slug>.jpg` and append an entry below.

export type VehicleTemplate = {
  slug: string;
  label: string;
  // Composite blueprint image. Lives at
  // `public/upfit-templates/<slug>.{jpg|png}`. The editor renders it as
  // an <img>; the PDF reads the file as a Buffer and embeds it. A
  // missing file degrades gracefully to a labeled empty box — nothing
  // crashes.
  imageUrl: string;
};

export const VEHICLE_TEMPLATES: Record<string, VehicleTemplate> = {
  tahoe: {
    slug: "tahoe",
    label: "Chevrolet Tahoe",
    imageUrl: "/upfit-templates/tahoe.jpg",
  },
  suburban: {
    slug: "suburban",
    label: "Chevrolet Suburban",
    imageUrl: "/upfit-templates/suburban.jpg",
  },
  blazer: {
    slug: "blazer",
    label: "Chevrolet Blazer",
    imageUrl: "/upfit-templates/blazer.jpg",
  },
  silverado: {
    slug: "silverado",
    label: "Chevrolet Silverado",
    imageUrl: "/upfit-templates/silverado.jpg",
  },
  durango: {
    slug: "durango",
    label: "Dodge Durango",
    imageUrl: "/upfit-templates/durango.jpg",
  },
  piu: {
    slug: "piu",
    label: "Ford Police Interceptor Utility (Explorer)",
    imageUrl: "/upfit-templates/piu.jpg",
  },
  f150: {
    slug: "f150",
    label: "Ford F-150",
    imageUrl: "/upfit-templates/f150.jpg",
  },
  f350: {
    slug: "f350",
    label: "Ford F-350",
    imageUrl: "/upfit-templates/f350.jpg",
  },
};

export const BODY_STYLES = Object.values(VEHICLE_TEMPLATES).map((t) => ({
  slug: t.slug,
  label: t.label,
}));

export function getTemplate(bodyStyle: string): VehicleTemplate {
  return VEHICLE_TEMPLATES[bodyStyle] ?? VEHICLE_TEMPLATES.tahoe;
}

// Translate a template image URL into a server-side public/ filesystem
// path. Used by the PDF renderer which has to embed the image as bytes
// rather than fetch over HTTP. Returns null when the URL isn't one of
// our managed `/upfit-templates/...` paths.
export function localImagePath(imageUrl: string): string | null {
  if (!imageUrl.startsWith("/upfit-templates/")) return null;
  return `public${imageUrl}`;
}

// 12 high-contrast pin colors. The builder cycles through these so each
// pin is visually distinct without forcing the user to pick. User can
// still override per-pin.
export const PIN_PALETTE = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#10b981", // green
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#14b8a6", // teal
  "#eab308", // yellow
  "#8b5cf6", // violet
];

export function nextPinColor(existing: number): string {
  return PIN_PALETTE[existing % PIN_PALETTE.length];
}

// --- Pin shapes -----------------------------------------------------------
//
// Equipment pins are drawn as colored rectangles sized to match the kind of
// light/equipment they represent. Dimensions are in *image-fraction* units
// (multiplied by the rendered diagram width/height at draw time) so the
// pin scales with whatever size the diagram is shown at — small in the
// editor sidebar, full in the printed PDF. Width is the long axis for
// horizontal pins; the renderer swaps width/height for `orientation =
// "vertical"`.

export type PinSizeKey = "small" | "medium" | "large" | "strip";

export type PinSize = {
  key: PinSizeKey;
  label: string;
  // Long-axis width as a fraction of the diagram's rendered width.
  // 0.025 ≈ 25px on a 1000px-wide diagram.
  widthFrac: number;
  // Short-axis height as a fraction of the diagram's rendered height.
  heightFrac: number;
};

export const PIN_SIZES: Record<PinSizeKey, PinSize> = {
  small: { key: "small", label: "Small", widthFrac: 0.024, heightFrac: 0.018 },
  medium: { key: "medium", label: "Medium", widthFrac: 0.038, heightFrac: 0.024 },
  large: { key: "large", label: "Large", widthFrac: 0.060, heightFrac: 0.032 },
  // Strip = lightbar / tracer array — the long thin one in the rocker
  // panel on the OnPoint reference.
  strip: { key: "strip", label: "Strip / Tracer", widthFrac: 0.260, heightFrac: 0.022 },
};

export const PIN_SIZE_ORDER: PinSizeKey[] = ["small", "medium", "large", "strip"];

// --- Color schemes --------------------------------------------------------
//
// A color scheme is one or more segments rendered side-by-side across the
// rectangle's long axis. Solid colors are a single segment; split colors
// are two; the multi-segment schemes mimic the alternating red/white
// pattern of a tracer/lightbar.

export type ColorScheme = {
  key: string;
  label: string;
  // Ordered segments rendered left → right (or top → bottom when vertical).
  segments: string[];
};

export const COLOR_SCHEMES: Record<string, ColorScheme> = {
  // --- Solids ---
  red: { key: "red", label: "Red", segments: ["#dc2626"] },
  white: { key: "white", label: "White", segments: ["#ffffff"] },
  blue: { key: "blue", label: "Blue", segments: ["#1d4ed8"] },
  amber: { key: "amber", label: "Amber", segments: ["#f59e0b"] },
  green: { key: "green", label: "Green", segments: ["#16a34a"] },
  // --- 50/50 splits (the most common law-enforcement combos) ---
  red_white: { key: "red_white", label: "Red / White", segments: ["#dc2626", "#ffffff"] },
  blue_white: { key: "blue_white", label: "Blue / White", segments: ["#1d4ed8", "#ffffff"] },
  amber_white: { key: "amber_white", label: "Amber / White", segments: ["#f59e0b", "#ffffff"] },
  red_blue: { key: "red_blue", label: "Red / Blue", segments: ["#dc2626", "#1d4ed8"] },
  green_white: { key: "green_white", label: "Green / White", segments: ["#16a34a", "#ffffff"] },
  // --- Multi-segment tracer / lightbar patterns ---
  rwrw_4: {
    key: "rwrw_4",
    label: "Red / White × 4",
    segments: ["#dc2626", "#ffffff", "#dc2626", "#ffffff"],
  },
  rwrw_6: {
    key: "rwrw_6",
    label: "Red / White × 6",
    segments: ["#dc2626", "#ffffff", "#dc2626", "#ffffff", "#dc2626", "#ffffff"],
  },
  bwbw_4: {
    key: "bwbw_4",
    label: "Blue / White × 4",
    segments: ["#1d4ed8", "#ffffff", "#1d4ed8", "#ffffff"],
  },
  rbrb_4: {
    key: "rbrb_4",
    label: "Red / Blue × 4",
    segments: ["#dc2626", "#1d4ed8", "#dc2626", "#1d4ed8"],
  },
};

export const COLOR_SCHEME_ORDER = [
  "red",
  "white",
  "blue",
  "amber",
  "green",
  "red_white",
  "blue_white",
  "amber_white",
  "red_blue",
  "green_white",
  "rwrw_4",
  "rwrw_6",
  "bwbw_4",
  "rbrb_4",
];

export function getColorScheme(key: string | undefined | null): ColorScheme {
  if (key && COLOR_SCHEMES[key]) return COLOR_SCHEMES[key];
  return COLOR_SCHEMES.red_white;
}

export function getPinSize(key: string | undefined | null): PinSize {
  if (key && (key in PIN_SIZES)) return PIN_SIZES[key as PinSizeKey];
  return PIN_SIZES.medium;
}
