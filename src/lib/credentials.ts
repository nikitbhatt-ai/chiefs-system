// Restricted-equipment categories. A credential can authorize one or more
// of these; parts marked restricted carry one of these as their
// restrictionCategory. Keep in sync with the Restricted Category dropdown
// on the part edit form.
export const RESTRICTION_CATEGORIES = [
  { value: "nfa_class_iii", label: "NFA Class III" },
  { value: "suppressor", label: "Suppressor" },
  { value: "sbr", label: "Short-Barreled Rifle (SBR)" },
  { value: "sbs", label: "Short-Barreled Shotgun (SBS)" },
  { value: "machine_gun", label: "Machine Gun" },
  { value: "destructive_device", label: "Destructive Device" },
  { value: "law_enforcement_only", label: "Law Enforcement Only" },
] as const;

export type RestrictionCategory = (typeof RESTRICTION_CATEGORIES)[number]["value"];

// Credential types — what kind of credential record this is. LE covers
// agency-issued law enforcement credentials; Generic covers other valid
// authorizations (FFL transfer, dealer license, military, etc.).
export const CREDENTIAL_TYPES = [
  { value: "LE", label: "Law Enforcement" },
  { value: "Generic", label: "Generic / Other" },
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number]["value"];

export const EXPIRATION_WARNING_DAYS = 30;

export type CredentialStatus =
  | "verified"
  | "pending"
  | "expired"
  | "expiring_soon";

type CredentialLike = {
  verifiedAt: Date | null;
  expiresAt: Date | null;
};

export function credentialStatus(cred: CredentialLike, now: Date = new Date()): CredentialStatus {
  if (cred.expiresAt && cred.expiresAt.getTime() <= now.getTime()) return "expired";
  if (!cred.verifiedAt) return "pending";
  if (cred.expiresAt) {
    const daysLeft = (cred.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= EXPIRATION_WARNING_DAYS) return "expiring_soon";
  }
  return "verified";
}

export function isCredentialActive(cred: CredentialLike, now: Date = new Date()): boolean {
  const status = credentialStatus(cred, now);
  return status === "verified" || status === "expiring_soon";
}

type PartLike = {
  restricted: boolean;
  restrictionCategory: string | null;
};

export function credentialCoversPart(
  cred: { restrictedEquipment: unknown } & CredentialLike,
  part: PartLike,
  now: Date = new Date(),
): boolean {
  if (!part.restricted) return true;
  if (!isCredentialActive(cred, now)) return false;
  const covered = Array.isArray(cred.restrictedEquipment)
    ? (cred.restrictedEquipment as string[])
    : [];
  if (!part.restrictionCategory) return covered.length > 0;
  return covered.includes(part.restrictionCategory);
}

export const STATUS_LABELS: Record<CredentialStatus, string> = {
  verified: "Verified",
  pending: "Pending verification",
  expiring_soon: "Expiring soon",
  expired: "Expired",
};

export const STATUS_COLORS: Record<CredentialStatus, string> = {
  verified: "bg-green-500/10 text-green-300 border-green-500/30",
  pending: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  expiring_soon: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  expired: "bg-red-500/10 text-red-300 border-red-500/30",
};
