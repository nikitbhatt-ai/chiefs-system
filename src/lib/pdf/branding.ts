// Branding constants for every PDF. Today these are hard-coded; the spec
// calls for moving them into admin settings so a rebrand doesn't require
// a redeploy. Pulling from env vars first so we can override per
// environment without touching code.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const BRANDING = {
  companyName: process.env.PDF_COMPANY_NAME ?? "Chiefs Pursuit Surplus",
  tagline: process.env.PDF_COMPANY_TAGLINE ?? "Vehicle Upfit · Public Safety & Commercial",
  address: process.env.PDF_COMPANY_ADDRESS ?? "52186 U.S. 290, Hempstead, TX 77445",
  phone: process.env.PDF_COMPANY_PHONE ?? "(979) 856-9700",
  email: process.env.PDF_COMPANY_EMAIL ?? "nikit@chiefspursuitsurplus.com",
  website: process.env.PDF_COMPANY_WEBSITE ?? "chiefspursuitsurplus.com",
  // Hex colors. Keep these readable on white paper.
  accentColor: "#d97706", // amber-600
  textColor: "#111111",
  mutedColor: "#555555",
};

/**
 * The logo for the top-left of every customer-facing document.
 *
 * Read from disk at first use and cached for the life of the process, because
 * `@react-pdf/renderer` needs the bytes inline — it cannot fetch a URL from a
 * server component render, and a remote fetch per PDF would be a per-download
 * network round trip for a file that never changes.
 *
 * Drop the artwork at `public/brand/chiefs-logo.png` (or point
 * `PDF_LOGO_PATH` at it). PNG or JPEG; roughly 4:1 landscape renders best in
 * the 150×38pt slot the header reserves. Until a file exists the header falls
 * back to the company name set as a wordmark, so documents never break over a
 * missing asset — they just aren't branded yet.
 */
const LOGO_CANDIDATES = [
  process.env.PDF_LOGO_PATH,
  "public/brand/chiefs-logo.png",
  "public/brand/chiefs-logo.jpg",
  "public/brand/logo.png",
].filter((p): p is string => !!p);

let logoCache: { src: string | null } | null = null;
let webPathCache: { path: string | null } | null = null;

/**
 * The logo as a URL the browser can request, for the HTML print view.
 *
 * Only returns a path for a file that actually exists under `public/`, so the
 * print view falls back to the wordmark instead of rendering a broken-image
 * icon on a page someone is about to hand a customer.
 */
export function brandLogoWebPath(): string | null {
  if (webPathCache) return webPathCache.path;
  for (const rel of LOGO_CANDIDATES) {
    if (!rel.startsWith("public/")) continue;
    const abs = path.join(process.cwd(), rel);
    if (existsSync(abs)) {
      webPathCache = { path: rel.replace(/^public/, "") };
      return webPathCache.path;
    }
  }
  webPathCache = { path: null };
  return null;
}

export function brandLogo(): string | null {
  if (logoCache) return logoCache.src;
  for (const rel of LOGO_CANDIDATES) {
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    try {
      if (!existsSync(abs)) continue;
      const bytes = readFileSync(abs);
      const mime = /\.jpe?g$/i.test(abs) ? "image/jpeg" : "image/png";
      logoCache = { src: `data:${mime};base64,${bytes.toString("base64")}` };
      return logoCache.src;
    } catch {
      // An unreadable logo must not take a customer's invoice down with it.
    }
  }
  logoCache = { src: null };
  return null;
}
