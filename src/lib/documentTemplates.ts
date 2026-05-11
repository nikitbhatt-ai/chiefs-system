import type { PipelineSlug } from "@/lib/pipelines";

export type DocFieldSpec = {
  name: string;
  label: string;
  required?: boolean;
  textarea?: boolean;
  type?: "text" | "number" | "date";
};

export type PipelineDocSpec = {
  // Unique slug used as `files.kind` (e.g. "pipeline_doc:government_po_intake").
  slug: string;
  label: string;
  description: string;
  // Stage the document must be attached by — i.e. moving past this stage
  // requires a `files` row with this doc's kind.
  requiredBeforeStage: string;
  fields: DocFieldSpec[];
  // Plain-text body shown above the field grid in the print view.
  intro: string;
};

export const PIPELINE_DOCUMENTS: Record<PipelineSlug, PipelineDocSpec | null> = {
  government: {
    slug: "pipeline_doc:government_po_intake",
    label: "Government PO Intake",
    description:
      "Capture purchase-order details and attach the signed PO from the contracting agency.",
    requiredBeforeStage: "in_production",
    intro:
      "Use this form to record the government purchase order. Print, attach the signed PO scan, then re-upload the completed packet via the Documents panel on the deal.",
    fields: [
      { name: "poNumber", label: "PO Number", required: true },
      { name: "agency", label: "Issuing Agency", required: true },
      { name: "contractValue", label: "Contract Value ($)", required: true, type: "number" },
      { name: "fiscalYear", label: "Fiscal Year", type: "text" },
      { name: "requiredDeliveryDate", label: "Required Delivery Date", type: "date" },
      { name: "specialTerms", label: "Special Terms / Notes", textarea: true },
    ],
  },
  walk_in_credentialed: {
    slug: "pipeline_doc:walk_in_credential_intake",
    label: "Walk-In Credential Intake",
    description:
      "Customer-signed attestation that the credential on file is valid and authorizes the listed equipment.",
    requiredBeforeStage: "quote_sent",
    intro:
      "Have the customer review the credential details below and sign the attestation. Upload the signed copy via the Documents panel.",
    fields: [
      { name: "customerName", label: "Customer Name", required: true },
      { name: "credentialNumber", label: "Credential Number", required: true },
      { name: "issuingAuthority", label: "Issuing Authority", required: true },
      { name: "credentialExpires", label: "Credential Expires", type: "date" },
      { name: "attestation", label: "Customer Attestation", textarea: true },
    ],
  },
  commercial: {
    slug: "pipeline_doc:commercial_deposit_receipt",
    label: "Commercial Deposit Receipt",
    description:
      "Receipt confirming deposit amount, payment method, and refund terms.",
    requiredBeforeStage: "in_production",
    intro:
      "Issue this receipt to the customer when the deposit clears. Upload the countersigned copy via the Documents panel.",
    fields: [
      { name: "depositAmount", label: "Deposit Amount ($)", required: true, type: "number" },
      { name: "paymentMethod", label: "Payment Method", required: true },
      { name: "depositDate", label: "Deposit Date", required: true, type: "date" },
      { name: "refundTerms", label: "Refund Terms", textarea: true },
    ],
  },
};

export function docForPipeline(slug: string | null | undefined): PipelineDocSpec | null {
  if (!slug) return null;
  return PIPELINE_DOCUMENTS[slug as PipelineSlug] ?? null;
}

export function docKindForPipeline(slug: string | null | undefined): string | null {
  return docForPipeline(slug)?.slug ?? null;
}
