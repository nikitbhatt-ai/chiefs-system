import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { communications, deals } from "@/db/schema";
import { recordCommunication } from "@/lib/communications";

export const dynamic = "force-dynamic";

// GET /api/communications?status=&channel=&dealId=&customerId=&leadId=&limit=
//
// Timeline read. Filtering by dealId also returns account-level rows (matched
// to the customer but no specific deal) so a rep sees the whole conversation
// with that account on the deal page, not a partial one.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const channel = url.searchParams.get("channel");
  const dealId = url.searchParams.get("dealId");
  const customerId = url.searchParams.get("customerId");
  const leadId = url.searchParams.get("leadId");
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  const filters: SQL[] = [];
  if (status) filters.push(eq(communications.status, status));
  if (channel) filters.push(eq(communications.channel, channel));
  if (leadId) filters.push(eq(communications.leadId, leadId));
  if (customerId) filters.push(eq(communications.customerId, customerId));
  if (dealId) {
    // Rows filed on this deal, plus account-level rows for the same customer
    // (matched to the account but not to a specific deal) — otherwise a
    // customer with two open deals shows half a conversation on each.
    const [deal] = await db
      .select({ customerId: deals.customerId })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    const scope = deal?.customerId
      ? or(
          eq(communications.dealId, dealId),
          and(eq(communications.customerId, deal.customerId), isNull(communications.dealId)),
        )
      : eq(communications.dealId, dealId);
    if (scope) filters.push(scope);
  }

  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select()
    .from(communications)
    .where(where)
    .orderBy(desc(communications.occurredAt))
    .limit(limit);

  return NextResponse.json(rows);
}

// POST /api/communications — log an interaction by hand (a call, a walk-in, a
// meeting). Same write path as automated ingest, so manual and synced rows are
// indistinguishable downstream.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.channel !== "string" || typeof body.direction !== "string") {
    return NextResponse.json({ error: "channel and direction are required" }, { status: 400 });
  }
  if (!body.dealId && !body.customerId && !body.leadId) {
    return NextResponse.json({ error: "one of dealId, customerId or leadId is required" }, { status: 400 });
  }

  const result = await recordCommunication({
    channel: body.channel,
    direction: body.direction,
    source: "manual",
    subject: body.subject ?? null,
    bodyText: body.body ?? body.bodyText ?? null,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : null,
    sentBy: session.user.id,
    participants: Array.isArray(body.participants) ? body.participants : [],
    target: { dealId: body.dealId ?? null, customerId: body.customerId ?? null, leadId: body.leadId ?? null },
  });

  if (!result.ok) return NextResponse.json({ error: result.skipped }, { status: 400 });
  // A blank id means the unique external_id index rejected the insert: we
  // already hold this message. Manual logs carry no external id so this can't
  // normally happen — but selecting on "" would raise a Postgres invalid-uuid
  // error rather than saying anything useful.
  if (!result.id) return NextResponse.json({ error: "already recorded" }, { status: 409 });

  const [row] = await db.select().from(communications).where(eq(communications.id, result.id)).limit(1);
  return NextResponse.json(row, { status: 201 });
}

