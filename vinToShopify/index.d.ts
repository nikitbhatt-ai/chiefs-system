// TypeScript declarations for the plain-JS vin-to-shopify module so the
// Next.js app (which has allowJs: false) can import it with types.

export interface CarListingInput {
  vin: string;
  price: number | string;
  condition?: string;
  mileage?: number;
  photoUrls?: string[];
  notes?: string;
  productType?: string;
  status?: "draft" | "active";
}

export interface CarListingSuccess {
  status: "success";
  productId: string | number;
  adminUrl: string;
  storefrontUrl: string | null;
  title: string;
  decoded: Record<string, unknown>;
}

export interface CarListingError {
  status: "error";
  stage: "input" | "validate" | "decode" | "build" | "shopify";
  error: string;
}

export type CarListingResult = CarListingSuccess | CarListingError;

export function createCarListing(
  input: CarListingInput
): Promise<CarListingResult>;

export function validateVin(
  vin: unknown
): { ok: true; vin: string } | { ok: false; error: string };

export function decodeVin(
  vin: string
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }
>;

export function buildProduct(input: {
  decoded: Record<string, unknown>;
  vin: string;
  listing: CarListingInput;
}): unknown;

export function createProduct(
  payload: unknown
): Promise<
  | {
      ok: true;
      productId: string | number;
      adminUrl: string;
      storefrontUrl: string | null;
    }
  | { ok: false; error: string }
>;
