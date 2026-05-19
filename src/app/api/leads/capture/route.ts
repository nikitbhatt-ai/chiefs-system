import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { notifyMany } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Universal lead capture endpoint. ANY source (Shopify webhook, main site
// contact form, trade-show iPad, chatbot, SMS opt-in service, ...) POSTs
// to this URL with a JSON payload. New record types just need to send
// the same shape; no per-source code path.
//
// Auth: shared secret in LEAD_CAPTURE_SECRET env var, passed as either
// `Authorization: Bearer <secret>` or `X-Webhook-Secret: <secret>`.
// Rotate by changing the env var on Vercel. If LEAD_CAPTURE_SECRET is
// unset, the endpoint refuses to run at all (avoids accidental open
// endpoint in development).
//
// Body shape (all fields except source + name optional):
// {
//   "source": "shopify" | "main_website_form" | "trade_show" | …,
//   "name":   "Jane Doe",
//   "email":  "jane@example.com",
//   "phone":  "555-1212",
//   "customerType": "government" | "walk_in_credentialed" | "commercial",
//   "subSource":    "lightbar inquiry",
//   "notes":  "Wants pricing on 12 patrol upfits.",
//   "metadata": { …arbitrary JSON, lands on leads.sub_source_meta… }
// }

const ALLOWED_CUSTOMER_TYPES = new Set(["government", "walk_in_credentialed", "commercial", "retail"]);

function authorized(req: Request): boolean {
  const expected = process.env.LEAD_CAPTURE_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const xhook = req.headers.get("x-webhook-secret") ?? "";
  if (xhook === expected) return true;
  return false;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const source = String((body as Record<string, unknown>).source ?? "").trim();
  const name = String((body as Record<string, unknown>).name ?? "").trim();
  if (!source) return NextResponse.json({ error: "source is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const email = String((body as Record<string, unknown>).email ?? "").trim() || null;
  const phone = String((body as Record<string, unknown>).phone ?? "").trim() || null;
  const customerTypeRaw = String((body as Record<string, unknown>).customerType ?? "").trim();
  const customerType = ALLOWED_CUSTOMER_TYPES.has(customerTypeRaw) ? customerTypeRaw : null;
  const subSource = String((body as Record<string, unknown>).subSource ?? "").trim() || null;
  const notes = String((body as Record<string, unknown>).notes ?? "").trim() || null;
  const metadata = (body as Record<string, unknown>).metadata ?? null;

  // Combine the request's own metadata with bookkeeping: source IP, the
  // user-agent string, and a capture timestamp. Useful for tracing later.
  const subSourceMeta: Record<string, unknown> = {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    capturedAt: new Date().toISOString(),
    capturedFromIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  };

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
      notes,
    })
    .returning({ id: leads.id });

  // Notify every active sales user so the new lead surfaces immediately
  // in their notifications bell (which they'll see on next page nav).
  // Real-time push to /leads is a follow-up PR.
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
    console.error("lead-capture notify failed:", err);
  }

  return NextResponse.json({ ok: true, id: row?.id ?? null }, { status: 201 });
}
