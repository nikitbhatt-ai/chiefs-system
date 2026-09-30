// Purchase-order status vocabulary the UI shares. The workflow the user set:
//   pending    → order needs to be placed
//   ordered    → order has been placed with the vendor
//   received   → SOME parts received (stored as `partially_received`; set
//                automatically when a partial receipt is recorded)
//   fulfilled  → ALL parts and quantities received (set automatically when the
//                last line is fully received)
// The received/fulfilled transitions are automatic (see receivePurchaseOrder);
// pending/ordered are the manual choices when creating or editing a PO. Legacy
// values (pending_review, po_received, received) still render for old rows.

export type PoStatus = string;

export const PO_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  ordered: "Ordered",
  partially_received: "Received",
  fulfilled: "Fulfilled",
  // legacy
  pending_review: "Pending review",
  po_received: "PO received",
  received: "Received (all)",
};

export const PO_STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  ordered: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  partially_received: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  fulfilled: "bg-green-500/10 text-green-300 border-green-500/30",
  // legacy
  pending_review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  po_received: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  received: "bg-green-500/10 text-green-300 border-green-500/30",
};

/** The statuses a user picks by hand; received/fulfilled are automatic. */
export const PO_MANUAL_STATUSES: { value: string; label: string }[] = [
  { value: "pending", label: "Pending — needs to be ordered" },
  { value: "ordered", label: "Ordered — placed with vendor" },
];

export function poStatusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return PO_STATUS_LABEL[s] ?? s.replace(/_/g, " ");
}

export function poStatusColor(s: string | null | undefined): string {
  return (s && PO_STATUS_COLORS[s]) || "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}
