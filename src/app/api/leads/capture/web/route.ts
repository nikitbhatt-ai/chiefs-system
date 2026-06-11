import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { notifyMany } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Storefront-safe lead capture. Called directly from browser JS on the
// Shopify storefront (and other public websites). Auth model:
//   - Origin header must match LEAD_CAPTURE_WEB_ORIGINS allowlist
//     (comma-separated; e.g. "https://shop.example.com,https://example.myshopify.com").
//     If the env var is unset, the endpoint returns 503 — fail closed so
//     a forgotten config can't become an open spam target.
//   - A hidden honeypot field 'company_url' MUST be empty. Bots fill
//     every input on a page; humans don't see this one. If filled, we
//     return 200 OK silently so bots don't learn they were caught.
//
// CORS: handles the preflight OPTIONS request and echoes the validated
// origin back in Access-Control-Allow-Origin on every response.
//
// Body shape (all optional except `name`):
// {
//   "name":   "Jane Doe",
//   "email":  "jane@example.com",
//   "phone":  "555-1212",
//   "message": "Need pricing on 12 patrol upfits.",
//   "customerType": "government" | "commercial" | "walk_in_credentialed",
//   "productHandle": "patrol-suv-base",
//   "productTitle":  "Patrol SUV Base Upfit",
//   "productUrl":    "https://shop.example.com/products/patrol-suv-base",
//   "source":  "shopify_storefront" | "main_website_form" | …,
//   "company_url": ""   // HONEYPOT — must be empty
// }

const ALLOWED_CUSTOMER_TYPES = new Set(["government", "walk_in_credentialed", "commercial", "retail"]);

function allowedOrigins(): string[] {
  return (process.env.LEAD_CAPTURE_WEB_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowedOrigins().includes(origin) ? origin : "";
  return allow
    ? {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  const allowlist = allowedOrigins();
  if (allowlist.length === 0) {
    return NextResponse.json(
      { error: "endpoint not configured" },
      { status: 503, headers: cors },
    );
  }
  if (!origin || !allowlist.includes(origin)) {
    return NextResponse.json(
      { error: "origin not allowed" },
      { status: 403, headers: cors },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: cors });
  }
  const b = body as Record<string, unknown>;

  // Honeypot: if a bot filled the hidden field, silently accept so it
  // doesn't learn to retry with a cleaner payload. No DB write, no
  // notification.
  if (typeof b.company_url === "string" && b.company_url.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 200, headers: cors });
  }

  // Length caps prevent a permitted-origin form from stuffing megabytes
  // of text into our DB. Trim then slice. Reasonable inquiry-form caps:
  // short for contact fields, long for the free-text message.
  const cap = (v: unknown, max: number): string =>
    String(v ?? "").trim().slice(0, max);

  const name = cap(b.name, 200);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400, headers: cors });

  const email = cap(b.email, 200) || null;
  const phone = cap(b.phone, 50) || null;
  const message = cap(b.message, 5000) || null;
  const customerTypeRaw = cap(b.customerType, 50);
  const customerType = ALLOWED_CUSTOMER_TYPES.has(customerTypeRaw) ? customerTypeRaw : null;
  const source = cap(b.source, 100) || "shopify_storefront";

  const subSourceMeta: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    capturedFromIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
    origin,
    productHandle: typeof b.productHandle === "string" ? b.productHandle : null,
    productTitle: typeof b.productTitle === "string" ? b.productTitle : null,
    productUrl: typeof b.productUrl === "string" ? b.productUrl : null,
  };

  const subSource =
    typeof b.productTitle === "string" && b.productTitle
      ? `Product: ${b.productTitle}`
      : null;

  const [row] = await db
    .insert(leads)
    .values({
      name,
      email,
      phone,
      customerType,
      source,
      subSource,
      subSourceMeta,
      status: "new",
      notes: message,
    })
    .returning({ id: leads.id });

  try {
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.active, true), eq(users.role, "sales")));
    if (recipients.length) {
      await notifyMany(
        recipients.map((r) => r.id),
        {
          kind: "task_assigned",
          title: `New lead: ${name}`,
          body: `From ${source}${subSource ? ` · ${subSource}` : ""}${email ? ` · ${email}` : ""}`,
          link: `/leads`,
        },
      );
    }
  } catch (err) {
    console.error("lead-capture/web notify failed:", err);
  }

  return NextResponse.json({ ok: true, id: row?.id ?? null }, { status: 201, headers: cors });
}
