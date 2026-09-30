// True for a well-formed UUID. Line items store `partId` as free JSON, and an
// imported or hand-edited line can carry something that isn't one (a SKU, an
// empty string). Postgres rejects those in a uuid comparison and the whole
// page fails, so filter ids through this before querying.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
