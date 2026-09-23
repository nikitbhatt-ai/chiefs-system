// Reasons stock can leave WITHOUT a work order, and the GL account each one
// charges (Dr <account> / Cr 1200 Inventory). Client-safe (no DB) so the pull
// screen can list them. Pulls tied to a work order always go to WIP instead.
export const PULL_REASONS = [
  { key: "shop_use", label: "Shop use / consumables", account: "6170", hint: "Charged to Shop Supplies (non-job)" },
  { key: "damaged", label: "Damaged / scrapped", account: "5910", hint: "Charged to Inventory Shrinkage & Write-offs" },
  {
    key: "counter_sale",
    label: "Counter sale",
    account: "5100",
    hint: "Charged to cost of goods sold — still invoice the customer for the sale",
  },
] as const;

export type PullReason = (typeof PULL_REASONS)[number]["key"];

export function pullReason(key: string | null | undefined) {
  return PULL_REASONS.find((r) => r.key === key) ?? null;
}
