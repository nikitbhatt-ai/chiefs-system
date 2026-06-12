// Vehicle template definitions for the Upfit Builder. Each body style is
// ONE composite image (the multi-view blueprint sales uploads — top /
// front / rear / sides all in a single picture). Pins are placed freely
// anywhere on that image and stored as fractional (x, y) coordinates
// 0..1 of the image box, so they render identically on screen, in print,
// and in the PDF regardless of display size.
//
// Adding a new body style: append to VEHICLE_TEMPLATES and drop the
// matching image at `public/upfit-templates/<slug>.png`. No other code
// needs to change.

export type VehicleTemplate = {
  slug: string;
  label: string;
  // Composite blueprint image. Lives at `public/upfit-templates/<slug>.png`
  // (PNG / JPG). The editor renders it as an <img>; the PDF reads the file
  // as a Buffer and embeds it. A missing file degrades gracefully to a
  // labeled empty box — nothing crashes.
  imageUrl: string;
};

export const VEHICLE_TEMPLATES: Record<string, VehicleTemplate> = {
  suv: {
    slug: "suv",
    label: "SUV (Tahoe / Suburban / Explorer)",
    imageUrl: "/upfit-templates/suv.png",
  },
  pickup: {
    slug: "pickup",
    label: "Pickup (Silverado / F-Series)",
    imageUrl: "/upfit-templates/pickup.png",
  },
  sedan: {
    slug: "sedan",
    label: "Sedan (Charger / Patrol cruiser)",
    imageUrl: "/upfit-templates/sedan.png",
  },
};

export const BODY_STYLES = Object.values(VEHICLE_TEMPLATES).map((t) => ({
  slug: t.slug,
  label: t.label,
}));

export function getTemplate(bodyStyle: string): VehicleTemplate {
  return VEHICLE_TEMPLATES[bodyStyle] ?? VEHICLE_TEMPLATES.suv;
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
