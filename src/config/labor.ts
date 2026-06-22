// Shop labor rate used to translate clocked hours into labor cost per build.
// Hardcoded for now (one shop, one blended rate). When per-technician rates
// are needed, add an hourly_rate column to users and prefer it over this.
export const DEFAULT_LABOR_RATE_USD_PER_HOUR = 95;
