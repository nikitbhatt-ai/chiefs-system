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

// RBAC. Maps each customer-doc category to the set of roles that can see
// AND write to it. admin/manager always have full access. Categories that
// touch money or legally-sensitive paperwork (contracts, credentials,
// invoices, compliance) are manager+ only per the file-system spec.
export type UserRole = "admin" | "manager" | "sales" | "warehouse" | "tech" | "accountant";

const ALL_ROLES: UserRole[] = ["admin", "manager", "sales", "warehouse", "tech", "accountant"];
const MANAGER_PLUS: UserRole[] = ["admin", "manager"];

export const CATEGORY_ROLE_ACCESS: Record<CustomerDocCategory, UserRole[]> = {
  quotes_estimates: ["admin", "manager", "sales", "accountant"],
  purchase_orders: ["admin", "manager", "sales", "accountant"],
  contracts_agreements: MANAGER_PLUS,
  credentials_certifications: MANAGER_PLUS,
  spec_approvals: ["admin", "manager", "warehouse", "tech"],
  invoices: ["admin", "manager", "accountant"],
  correspondence: ["admin", "manager", "sales"],
  photos_build: ["admin", "manager", "warehouse", "tech"],
  compliance: MANAGER_PLUS,
  misc: ALL_ROLES,
};

export function categoryVisibleTo(
  category: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  if (role === "admin" || role === "manager") return true;
  if (!isValidCategory(category)) return false;
  return (CATEGORY_ROLE_ACCESS[category] ?? []).includes(role as UserRole);
}

export function visibleCategoriesFor(role: string | null | undefined): CustomerDocCategory[] {
  if (!role) return [];
  if (role === "admin" || role === "manager") {
    return CUSTOMER_DOC_CATEGORIES.map((c) => c.value);
  }
  return CUSTOMER_DOC_CATEGORIES
    .map((c) => c.value)
    .filter((cat) => (CATEGORY_ROLE_ACCESS[cat] ?? []).includes(role as UserRole));
}
