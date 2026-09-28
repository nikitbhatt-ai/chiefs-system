import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { inboundLeads } from "@/db/schema";

/**
 * Hosts we're willing to redirect a visitor back to after submitting.
 *
 * This matters more than it looks. Without it, someone could post to
 * your endpoint with page_url set to any site they like, and your
 * server would happily bounce the visitor there — an "open redirect",
 * which gets used in phishing. Only ever redirect to hosts you own.
 */
const ALLOWED_REDIRECT_HOSTS = (process.env.ALLOWED_REDIRECT_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Max submissions from one IP within the window, before we start dropping. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 10;

/** A form filled in faster than this is a bot, not a person. */
const MIN_FILL_SECONDS = 3;

function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "chiefs-default-salt";
  return createHash("sha256").update(salt + ip).digest("hex").slice(0, 32);
}

function clientIp(req: NextRequest): string {
  // Vercel puts the real client IP here.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isPlausibleEmail(value: string): boolean {
  // Deliberately loose. Strict email regexes reject valid addresses.
  // Real validation is sending mail to it.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

function trim(value: FormDataEntryValue | null, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, max);
  return cleaned.length ? cleaned : null;
}

/**
 * Where to send the visitor once we're done.
 * Falls back to the site root if the submitted URL isn't one of ours.
 */
function safeRedirect(pageUrl: string | null, flag: string): string {
  const fallback = process.env.PUBLIC_SITE_URL ?? "/";

  if (!pageUrl) return fallback;

  try {
    const url = new URL(pageUrl);
    if (!ALLOWED_REDIRECT_HOSTS.includes(url.hostname.toLowerCase())) {
      return fallback;
    }
    url.searchParams.set("inquiry", flag);
    return url.toString();
  } catch {
    return fallback;
  }
}

export type IntakeOptions = {
  /** Stored on the row so you can report by form later. */
  sourceChannel: string;
};

/**
 * Handles one form submission end to end.
 *
 * Note what it does NOT do: it never returns an error page to the
 * visitor. Spam and junk get silently accepted-looking responses.
 * Telling a bot exactly why it was rejected just helps it try again.
 */
export async function handleLeadIntake(
  req: NextRequest,
  { sourceChannel }: IntakeOptions
): Promise<NextResponse> {
  let form: FormData;

  try {
    // A plain HTML form sends form-encoded data, NOT JSON.
    // req.json() would throw here.
    form = await req.formData();
  } catch {
    return NextResponse.redirect(safeRedirect(null, "error"), 303);
  }

  const pageUrl = trim(form.get("page_url"), 500);
  const redirectOk = safeRedirect(pageUrl, "sent");

  // --- Spam check 1: the honeypot ---------------------------------
  // A field hidden off-screen. People can't see it, so they can't fill
  // it. Bots fill every field they find.
  if (trim(form.get("company_website"))) {
    // Look successful. Save nothing.
    return NextResponse.redirect(redirectOk, 303);
  }

  // --- Spam check 2: submitted impossibly fast --------------------
  const ts = Number(trim(form.get("ts")) ?? "0");
  if (ts > 0) {
    const elapsed = Math.floor(Date.now() / 1000) - ts;
    if (elapsed >= 0 && elapsed < MIN_FILL_SECONDS) {
      return NextResponse.redirect(redirectOk, 303);
    }
  }

  // --- Validation --------------------------------------------------
  const name = trim(form.get("name"), 200);
  const email = trim(form.get("email"), 254);

  if (!name || !email || !isPlausibleEmail(email)) {
    return NextResponse.redirect(safeRedirect(pageUrl, "invalid"), 303);
  }

  // --- Spam check 3: rate limit by IP ------------------------------
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000);

  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboundLeads)
      .where(and(eq(inboundLeads.ipHash, ipHash), gte(inboundLeads.createdAt, since)));

    if (count >= RATE_LIMIT_MAX) {
      return NextResponse.redirect(redirectOk, 303);
    }
  } catch (err) {
    // A failing rate-limit check should never block a real customer.
    console.error("[lead-intake] rate limit check failed", err);
  }

  // --- Save --------------------------------------------------------
  const rawPayload: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") rawPayload[key] = value.slice(0, 5000);
  }

  const quantityRaw = trim(form.get("qty"), 10);
  const quantity = quantityRaw ? Number.parseInt(quantityRaw, 10) : null;

  try {
    await db.insert(inboundLeads).values({
      sourceChannel,
      name,
      email,
      phone: trim(form.get("phone"), 50),
      agency: trim(form.get("agency"), 200),
      position: trim(form.get("position"), 200),
      subject: trim(form.get("subject"), 300),
      message: trim(form.get("notes") ?? form.get("message"), 5000),
      quantity: Number.isFinite(quantity as number) ? quantity : null,
      topic: trim(form.get("topic"), 100),
      partNumber: trim(form.get("part_number"), 300),
      vehicleFitment: trim(form.get("vehicle_fitment"), 200),
      installNeeded: trim(form.get("install_needed"), 50),
      vehicleType: trim(form.get("vehicle_type"), 100),
      upfitNeeded: trim(form.get("upfit_needed"), 50),
      timeline: trim(form.get("timeline"), 50),
      purchaseMethod: trim(form.get("purchase_method"), 100),
      productTitle: trim(form.get("product_title"), 300),
      productId: trim(form.get("product_id"), 50),
      productHandle: trim(form.get("product_handle"), 300),
      variantId: trim(form.get("variant_id"), 50),
      pageUrl,
      ipHash,
      userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      rawPayload,
      status: "new",
    });
  } catch (err) {
    console.error("[lead-intake] insert failed", err);
    // Don't lose the lead silently — shout about it.
    await notifyFailure(sourceChannel, email, err);
    return NextResponse.redirect(safeRedirect(pageUrl, "error"), 303);
  }

  await notifyNewLead({
    sourceChannel,
    name,
    email,
    agency: trim(form.get("agency"), 200),
    position: trim(form.get("position"), 200),
    pageUrl,
  });

  return NextResponse.redirect(redirectOk, 303);
}

/**
 * Email safety net. Keep this running even after the database side is
 * solid — it's how you find out a bad deploy ate someone's inquiry.
 * Set RESEND_API_KEY and LEAD_NOTIFY_EMAIL to turn it on.
 */
async function notifyNewLead(args: {
  sourceChannel: string;
  name: string;
  email: string;
  agency: string | null;
  position: string | null;
  pageUrl: string | null;
}) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL;
  if (!key || !to) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.LEAD_NOTIFY_FROM ?? "leads@chiefspursuitsurplus.com",
        to,
        subject: `New lead: ${args.name}${args.position ? ` (${args.position})` : ""}${args.agency ? ` — ${args.agency}` : ""}`,
        text: [
          `Name:     ${args.name}`,
          `Position: ${args.position ?? "-"}`,
          `Agency:   ${args.agency ?? "-"}`,
          `Email:    ${args.email}`,
          `Source:   ${args.sourceChannel}`,
          `Page:     ${args.pageUrl ?? "-"}`,
          ``,
          `Full details are in chiefs-system under Leads.`,
        ].join("\n"),
      }),
    });
  } catch (err) {
    console.error("[lead-intake] notify failed", err);
  }
}

async function notifyFailure(sourceChannel: string, email: string, err: unknown) {
  console.error(`[lead-intake] LOST LEAD from ${email} on ${sourceChannel}`, err);
  // Wire this to your alerting once you have it.
}
