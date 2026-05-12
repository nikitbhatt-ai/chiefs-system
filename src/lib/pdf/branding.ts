// Branding constants for every PDF. Today these are hard-coded; the spec
// calls for moving them into admin settings so a rebrand doesn't require
// a redeploy. Pulling from env vars first so we can override per
// environment without touching code.

export const BRANDING = {
  companyName: process.env.PDF_COMPANY_NAME ?? "Chiefs Pursuit Surplus",
  tagline: process.env.PDF_COMPANY_TAGLINE ?? "Vehicle Upfit · Public Safety & Commercial",
  address: process.env.PDF_COMPANY_ADDRESS ?? "",
  phone: process.env.PDF_COMPANY_PHONE ?? "",
  email: process.env.PDF_COMPANY_EMAIL ?? "",
  website: process.env.PDF_COMPANY_WEBSITE ?? "",
  // Hex colors. Keep these readable on white paper.
  accentColor: "#d97706", // amber-600
  textColor: "#111111",
  mutedColor: "#555555",
};
