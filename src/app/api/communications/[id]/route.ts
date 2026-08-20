import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { communications, communicationParticipants, communicationAttachments } from "@/db/schema";
import { assignCommunication } from "@/lib/communications";
import { canDelete } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Full message, with participants and attachment metadata.
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [row] = await db.select().from(communications).where(eq(communications.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [participants, attachments] = await Promise.all([
    db
      .select()
      .from(communicationParticipants)
      .where(eq(communicationParticipants.communicationId, id))
      .orderBy(asc(communicationParticipants.role)),
    db
      .select()
      .from(communicationAttachments)
      .where(eq(communicationAttachments.communicationId, id)),
  ]);

  return NextResponse.json({ ...row, participants, attachments });
}

// PATCH — triage. File an unassigned message onto a deal/customer/lead, re-file
// a mis-matched one, or mark it as not sales activity.
//
// Body: { dealId?, customerId?, leadId?, status?: "matched" | "ignored" }
//
// Filing to a customer also learns the external senders as customer contacts,
// so the matcher gets this address right by itself next time.
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const status = body.status === "ignored" ? "ignored" : "matched";
  if (status === "matched" && !body.dealId && !body.customerId && !body.leadId) {
    return NextResponse.json(
      { error: "one of dealId, customerId or leadId is required to file a message" },
      { status: 400 },
    );
  }

  const ok = await assignCommunication(
    id,
    {
      dealId: body.dealId ?? null,
      customerId: body.customerId ?? null,
      leadId: body.leadId ?? null,
      status,
    },
    session.user.id,
  );
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [row] = await db.select().from(communications).where(eq(communications.id, id)).limit(1);
  return NextResponse.json(row);
}

// Deleting destroys a record of a customer interaction, so it's manager+.
// Triage should normally mark a message 'ignored' instead — that keeps the row
// and stops it resurfacing.
export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  await db.delete(communications).where(eq(communications.id, id));
  return NextResponse.json({ ok: true });
}
