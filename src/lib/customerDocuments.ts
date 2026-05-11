// Customer-folder document system. Every file uploaded for a customer lives
// in customer_documents and is grouped by category. Pipeline-bound documents
// from the deal entity page also write here, with `associatedDealId` set and
// the legacy `kind` slug preserved so stage-gate checks keep working.

export const CUSTOMER_DOC_CATEGORIES = [
  { value: "quotes_estimates", label: "Quotes & Estimates" },
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "contracts_agreements", label: "Contracts & Agreements" },
  { value: "credentials_certifications", label: "Credentials & Certifications" },
  { value: "spec_approvals", label: "Spec Approvals (Signed)" },
  { value: "invoices", label: "Invoices" },
  { value: "correspondence", label: "Correspondence" },
  { value: "photos_build", label: "Photos / Build Documentation" },
  { value: "compliance", label: "Compliance Documents" },
  { value: "misc", label: "Miscellaneous" },
] as const;

export type CustomerDocCategory = (typeof CUSTOMER_DOC_CATEGORIES)[number]["value"];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CUSTOMER_DOC_CATEGORIES.map((c) => [c.value, c.label]),
);

// Mapping from the pipeline document `kind` slug (from
// src/lib/documentTemplates.ts) to the customer-folder category the file
// lands in.
export const PIPELINE_DOC_CATEGORY: Record<string, CustomerDocCategory> = {
  "pipeline_doc:government_po_intake": "purchase_orders",
  "pipeline_doc:walk_in_credential_intake": "credentials_certifications",
  "pipeline_doc:commercial_deposit_receipt": "contracts_agreements",
  deal_attachment: "misc",
};

export function categoryForKind(kind: string | null | undefined): CustomerDocCategory {
  if (kind && PIPELINE_DOC_CATEGORY[kind]) return PIPELINE_DOC_CATEGORY[kind];
  return "misc";
}

export function isValidCategory(v: string | null | undefined): v is CustomerDocCategory {
  return !!v && CUSTOMER_DOC_CATEGORIES.some((c) => c.value === v);
}
