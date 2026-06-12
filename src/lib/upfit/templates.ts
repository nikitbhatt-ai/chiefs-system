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
