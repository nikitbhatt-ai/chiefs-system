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

export type PinSizeKey =
  | "small"
  | "medium"
  | "large"
  | "strip_small"
  | "strip_medium"
  | "strip_large"
  // Legacy alias — older saved pins use plain "strip" before strip got
  // its own three sizes. Resolved to "strip_medium" by getPinSize().
  | "strip";

export type PinSize = {
  key: PinSizeKey;
  label: string;
  // Long-axis width as a fraction of the diagram's rendered width.
  // 0.020 ≈ 20px on a 1000px-wide diagram.
  widthFrac: number;
  // Short-axis height as a fraction of the diagram's rendered height.
  heightFrac: number;
};

// Tuned smaller than the original catalog — the prior values printed
// as bulky blobs over the smaller details on the vehicle blueprints.
// Strip now has its own three variants for short rocker rails, full
// rocker rails, and full hidden-tracer arrays.
export const PIN_SIZES: Record<PinSizeKey, PinSize> = {
  small: { key: "small", label: "Small", widthFrac: 0.014, heightFrac: 0.012 },
  medium: { key: "medium", label: "Medium", widthFrac: 0.022, heightFrac: 0.016 },
  large: { key: "large", label: "Large", widthFrac: 0.034, heightFrac: 0.022 },
  // Strip = lightbar / tracer array. Three lengths so sales can mark
  // anything from a short rocker module to a full tracer rail.
  strip_small: { key: "strip_small", label: "Strip — Small", widthFrac: 0.120, heightFrac: 0.014 },
  strip_medium: { key: "strip_medium", label: "Strip — Medium", widthFrac: 0.200, heightFrac: 0.016 },
  strip_large: { key: "strip_large", label: "Strip — Large", widthFrac: 0.300, heightFrac: 0.018 },
  // Backward-compat alias — same proportions as strip_medium so saved
  // pins keep rendering at the size they were drawn at.
  strip: { key: "strip", label: "Strip — Medium", widthFrac: 0.200, heightFrac: 0.016 },
};

export const PIN_SIZE_ORDER: PinSizeKey[] = [
  "small",
  "medium",
  "large",
  "strip_small",
  "strip_medium",
  "strip_large",
];

// --- Color schemes --------------------------------------------------------
//
// A color scheme is one or more segments rendered side-by-side across the
// rectangle's long axis (or top → bottom when oriented vertically).
// Solid colors are a single segment; splits are two; trios are three;
// and the multi-segment counts (3 / 6 / 9 / 10 / 12) mimic the
// alternating pattern of a tracer / lightbar / hideaway array.

export type ColorSchemeGroup = "solid" | "split" | "trio" | "count";

export type ColorScheme = {
  key: string;
  label: string;
  group: ColorSchemeGroup;
  // Ordered segments rendered left → right (or top → bottom when vertical).
  segments: string[];
};

// Canonical color tokens reused across schemes. Centralized so future
// branding tweaks (slightly darker red, etc.) propagate everywhere.
const RED = "#dc2626";
const WHITE = "#ffffff";
const BLUE = "#1d4ed8";
const AMBER = "#f59e0b";
const GREEN = "#16a34a";

// Build a length-N segment list by cycling through `pattern`. Used for
// the multi-segment count schemes (R/W ×N, R/W/B ×N, …) so we don't
// hand-write the longer arrays.
function cycle(pattern: string[], count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pattern[i % pattern.length]);
  return out;
}

// Per the user spec: counts of 3, 6, 9, 10, 12. 10 is included for two-
// color patterns where it makes sense; trio counts only use multiples
// of 3 (3, 6, 9, 12) since an off-by-one trio looks wrong on a build
// sheet.
const TWO_COLOR_COUNTS = [3, 4, 6, 9, 10, 12] as const; // 4 kept for backward-compat with existing pins
const TRIO_COUNTS = [3, 6, 9, 12] as const;

function makeCountSchemes(
  prefix: string,
  patternLabel: string,
  pattern: string[],
  counts: readonly number[],
  group: ColorSchemeGroup,
): Record<string, ColorScheme> {
  const out: Record<string, ColorScheme> = {};
  for (const n of counts) {
    const key = `${prefix}_${n}`;
    out[key] = {
      key,
      label: `${patternLabel} × ${n}`,
      group,
      segments: cycle(pattern, n),
    };
  }
  return out;
}

export const COLOR_SCHEMES: Record<string, ColorScheme> = {
  // --- Solids ---
  red: { key: "red", label: "Red", group: "solid", segments: [RED] },
  white: { key: "white", label: "White", group: "solid", segments: [WHITE] },
  blue: { key: "blue", label: "Blue", group: "solid", segments: [BLUE] },
  amber: { key: "amber", label: "Amber", group: "solid", segments: [AMBER] },
  green: { key: "green", label: "Green", group: "solid", segments: [GREEN] },
  // --- 50/50 splits ---
  red_white: { key: "red_white", label: "Red / White", group: "split", segments: [RED, WHITE] },
  blue_white: { key: "blue_white", label: "Blue / White", group: "split", segments: [BLUE, WHITE] },
  amber_white: { key: "amber_white", label: "Amber / White", group: "split", segments: [AMBER, WHITE] },
  red_blue: { key: "red_blue", label: "Red / Blue", group: "split", segments: [RED, BLUE] },
  green_white: { key: "green_white", label: "Green / White", group: "split", segments: [GREEN, WHITE] },
  // --- Trios (3-color combos) ---
  rwb: { key: "rwb", label: "Red / White / Blue", group: "trio", segments: [RED, WHITE, BLUE] },
  rwa: { key: "rwa", label: "Red / White / Amber", group: "trio", segments: [RED, WHITE, AMBER] },
  bwa: { key: "bwa", label: "Blue / White / Amber", group: "trio", segments: [BLUE, WHITE, AMBER] },
  // --- Multi-segment counts ---
  ...makeCountSchemes("rwrw", "Red / White", [RED, WHITE], TWO_COLOR_COUNTS, "count"),
  ...makeCountSchemes("bwbw", "Blue / White", [BLUE, WHITE], TWO_COLOR_COUNTS, "count"),
  ...makeCountSchemes("rbrb", "Red / Blue", [RED, BLUE], TWO_COLOR_COUNTS, "count"),
  ...makeCountSchemes("rwb", "Red / White / Blue", [RED, WHITE, BLUE], TRIO_COUNTS, "count"),
};

// Ordered list used to render the dropdown. Generated from the catalog
// so adding a scheme above automatically picks up here.
export const COLOR_SCHEME_ORDER: string[] = Object.keys(COLOR_SCHEMES);

export const COLOR_GROUP_LABELS: Record<ColorSchemeGroup, string> = {
  solid: "Solid",
  split: "Split (50/50)",
  trio: "Trio",
  count: "Multi-segment count",
};

export const COLOR_GROUP_ORDER: ColorSchemeGroup[] = ["solid", "split", "trio", "count"];

// Return scheme keys grouped, in dropdown order. Used by both the
// editor (for HTML <optgroup>s) and any consumer that wants a
// category-aware listing.
export function colorSchemesByGroup(): { group: ColorSchemeGroup; label: string; keys: string[] }[] {
  return COLOR_GROUP_ORDER.map((group) => ({
    group,
    label: COLOR_GROUP_LABELS[group],
    keys: COLOR_SCHEME_ORDER.filter((k) => COLOR_SCHEMES[k].group === group),
  }));
}

export function getColorScheme(key: string | undefined | null): ColorScheme {
  if (key && COLOR_SCHEMES[key]) return COLOR_SCHEMES[key];
  return COLOR_SCHEMES.red_white;
}

export function getPinSize(key: string | undefined | null): PinSize {
  if (key && (key in PIN_SIZES)) return PIN_SIZES[key as PinSizeKey];
  return PIN_SIZES.medium;
}
