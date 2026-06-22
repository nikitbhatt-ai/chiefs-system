// Shop location for the Time Clock geofence.
//
// Per the owner's decision, the coordinates are hardcoded here rather than
// stored in the database or an env var. To move the geofence (new shop, second
// location, or to loosen/tighten it), edit the values below and redeploy.
//
// Coordinates are decimal degrees (WGS-84, the same system phones report).
// RADIUS_METERS is how far from SHOP_LAT/SHOP_LNG a technician may be and still
// clock in. ENFORCE flips hard blocking on/off — when false, location is still
// recorded but an out-of-range clock-in is allowed (and flagged) instead of
// rejected.

export const SHOP_LAT = 30.12285632819516;
export const SHOP_LNG = -96.10635062783578;
export const RADIUS_METERS = 150;
export const ENFORCE = true;

// Great-circle distance in meters between two lat/lng points (haversine).
export function distanceMeters(lat: number, lng: number, lat2 = SHOP_LAT, lng2 = SHOP_LNG): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat);
  const dLng = toRad(lng2 - lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Whether a reported position is inside the shop geofence.
export function withinGeofence(lat: number, lng: number): boolean {
  return distanceMeters(lat, lng) <= RADIUS_METERS;
}
