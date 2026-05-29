// Upfit Builder catalog — the single source of truth shared by the 3D
// renderer, the configurator UI, the lead payload, and the internal CRM
// view. Add a model / option here and every surface picks it up.
//
// Vehicles are rendered procedurally from primitives (no licensed CAD
// assets), so each model carries a `dims` block that drives the 3D body
// silhouette. Prices are rough ballparks used only to qualify the lead —
// the real quote is built in the CRM.

export type VehicleType = "suv" | "truck";

// Rear silhouette: SUVs carry the roof to the tail, trucks have an open bed.
export type RearKind = "roof" | "bed";

export type LightPackageSlug = "lightbar" | "surface" | "slicktop";
export type InteriorOptionSlug = "partition" | "console" | "storage";

export type VehicleDims = {
  /** Total body length (X axis). */
  length: number;
  /** Body width (Z axis). */
  width: number;
  /** Gap between ground and the bottom of the body. */
  rideHeight: number;
  /** Height of the main lower body block. */
  bodyHeight: number;
  /** Length of the front hood section. */
  hoodLength: number;
  /** Length of the greenhouse / cabin. */
  cabinLength: number;
  /** Height of the greenhouse above the body. */
  cabinHeight: number;
  /** Wheel radius. */
  wheelRadius: number;
  rearKind: RearKind;
};

export type VehicleModel = {
  slug: string;
  name: string;
  fullName: string;
  type: VehicleType;
  blurb: string;
  /** Default factory color (hex). */
  bodyColor: string;
  /** Ballpark base upfit price in whole dollars. */
  basePrice: number;
  dims: VehicleDims;
};

export type LightPackage = {
  slug: LightPackageSlug;
  name: string;
  blurb: string;
  price: number;
};

export type InteriorOption = {
  slug: InteriorOptionSlug;
  name: string;
  blurb: string;
  price: number;
};

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    slug: "tahoe",
    name: "Tahoe PPV",
    fullName: "Chevrolet Tahoe Police Pursuit Vehicle",
    type: "suv",
    blurb: "Full-size pursuit SUV. Maximum cargo and prisoner room.",
    bodyColor: "#1b1f2a",
    basePrice: 8500,
    dims: {
      length: 5.3,
      width: 2.04,
      rideHeight: 0.36,
      bodyHeight: 0.96,
      hoodLength: 1.2,
      cabinLength: 2.7,
      cabinHeight: 0.86,
      wheelRadius: 0.43,
      rearKind: "roof",
    },
  },
  {
    slug: "piu",
    name: "PIU (Interceptor)",
    fullName: "Ford Police Interceptor Utility",
    type: "suv",
    blurb: "AWD utility — the most common patrol platform in service.",
    bodyColor: "#222733",
    basePrice: 8200,
    dims: {
      length: 5.05,
      width: 1.96,
      rideHeight: 0.34,
      bodyHeight: 0.9,
      hoodLength: 1.15,
      cabinLength: 2.55,
      cabinHeight: 0.82,
      wheelRadius: 0.4,
      rearKind: "roof",
    },
  },
  {
    slug: "durango",
    name: "Durango Pursuit",
    fullName: "Dodge Durango Pursuit",
    type: "suv",
    blurb: "V8 pursuit-rated SUV with aggressive stance.",
    bodyColor: "#2a2f3a",
    basePrice: 8300,
    dims: {
      length: 5.1,
      width: 1.95,
      rideHeight: 0.33,
      bodyHeight: 0.92,
      hoodLength: 1.25,
      cabinLength: 2.5,
      cabinHeight: 0.8,
      wheelRadius: 0.41,
      rearKind: "roof",
    },
  },
  {
    slug: "silverado",
    name: "Silverado SSV",
    fullName: "Chevrolet Silverado Special Service Vehicle",
    type: "truck",
    blurb: "Crew-cab special-service truck for rural and K-9 units.",
    bodyColor: "#20242e",
    basePrice: 9200,
    dims: {
      length: 5.95,
      width: 2.06,
      rideHeight: 0.46,
      bodyHeight: 0.86,
      hoodLength: 1.5,
      cabinLength: 1.95,
      cabinHeight: 0.84,
      wheelRadius: 0.46,
      rearKind: "bed",
    },
  },
  {
    slug: "f150",
    name: "F-150 SSV",
    fullName: "Ford F-150 Police Responder / SSV",
    type: "truck",
    blurb: "Pursuit-rated crew-cab truck with off-road capability.",
    bodyColor: "#1d2733",
    basePrice: 9400,
    dims: {
      length: 5.9,
      width: 2.03,
      rideHeight: 0.45,
      bodyHeight: 0.85,
      hoodLength: 1.45,
      cabinLength: 2.0,
      cabinHeight: 0.83,
      wheelRadius: 0.45,
      rearKind: "bed",
    },
  },
];

export const LIGHT_PACKAGES: LightPackage[] = [
  {
    slug: "lightbar",
    name: "Full Lightbar",
    blurb: "Roof-mounted full-length LED lightbar — maximum visibility.",
    price: 2400,
  },
  {
    slug: "surface",
    name: "Surface-Mount Package",
    blurb: "Perimeter surface LEDs: grille, mirrors, and rear deck — no roof bar.",
    price: 1800,
  },
  {
    slug: "slicktop",
    name: "Slick-Top (Covert)",
    blurb: "No roof bar. Low-profile visor and grille lighting for unmarked units.",
    price: 1500,
  },
];

export const INTERIOR_OPTIONS: InteriorOption[] = [
  {
    slug: "partition",
    name: "Prisoner Partition",
    blurb: "Steel + polycarbonate cage separating the front cabin from the rear.",
    price: 950,
  },
  {
    slug: "console",
    name: "Center Console",
    blurb: "Mounting console for radio, siren controller, and equipment.",
    price: 700,
  },
  {
    slug: "storage",
    name: "Rear Storage Box",
    blurb: "Secure cargo / weapon storage box in the rear compartment.",
    price: 1100,
  },
];

export const AGENCY_TYPES = [
  { slug: "law_enforcement", label: "Police / Law Enforcement", customerType: "government" },
  { slug: "fire_ems", label: "Fire / EMS", customerType: "government" },
  { slug: "federal_state", label: "Federal / State Agency", customerType: "government" },
  { slug: "security", label: "Commercial / Security", customerType: "commercial" },
  { slug: "other", label: "Other", customerType: "retail" },
] as const;

export type AgencyTypeSlug = (typeof AGENCY_TYPES)[number]["slug"];

// ---- Lookups + helpers ---------------------------------------------------

export function getModel(slug: string): VehicleModel | undefined {
  return VEHICLE_MODELS.find((m) => m.slug === slug);
}

export function getLightPackage(slug: string): LightPackage | undefined {
  return LIGHT_PACKAGES.find((l) => l.slug === slug);
}

export function getInteriorOption(slug: string): InteriorOption | undefined {
  return INTERIOR_OPTIONS.find((o) => o.slug === slug);
}

export function agencyTypeToCustomerType(slug: string): string {
  return AGENCY_TYPES.find((a) => a.slug === slug)?.customerType ?? "government";
}

export type UpfitSelection = {
  modelSlug: string;
  lightPackage: LightPackageSlug;
  interiorOptions: InteriorOptionSlug[];
  bodyColor: string;
};

/** Sum the ballpark estimate for a selection. Returns 0 for unknown models. */
export function estimateTotal(sel: UpfitSelection): number {
  const model = getModel(sel.modelSlug);
  if (!model) return 0;
  let total = model.basePrice;
  total += getLightPackage(sel.lightPackage)?.price ?? 0;
  for (const opt of sel.interiorOptions) {
    total += getInteriorOption(opt)?.price ?? 0;
  }
  return total;
}

/** Human-readable one-line summary of a selection (used in lead notes). */
export function summarizeSelection(sel: UpfitSelection): string {
  const model = getModel(sel.modelSlug);
  const light = getLightPackage(sel.lightPackage);
  const interior = sel.interiorOptions
    .map((o) => getInteriorOption(o)?.name)
    .filter(Boolean)
    .join(", ");
  return [
    model?.fullName ?? sel.modelSlug,
    light ? `Lighting: ${light.name}` : null,
    interior ? `Interior: ${interior}` : "Interior: none",
    `Est. $${estimateTotal(sel).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const BODY_COLORS = [
  { hex: "#0b0d12", name: "Black" },
  { hex: "#e9edf2", name: "White" },
  { hex: "#1b2a4a", name: "Patrol Blue" },
  { hex: "#3a3f47", name: "Graphite" },
  { hex: "#5a1f24", name: "Maroon" },
  { hex: "#14361f", name: "Sheriff Green" },
];
