import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { postJournalEntry, LedgerError, type JournalLineInput } from "@/lib/accounting";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(journalEntries).orderBy(desc(journalEntries.entryDate)).limit(200);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.lines))
    return NextResponse.json({ error: "lines are required" }, { status: 400 });

  const lines: JournalLineInput[] = body.lines.map((l: Record<string, unknown>) => ({
    accountId: String(l.accountId ?? ""),
    debitCents: Number(l.debitCents ?? 0),
    creditCents: Number(l.creditCents ?? 0),
    departmentId: l.departmentId ? String(l.departmentId) : null,
    workOrderId: l.workOrderId ? String(l.workOrderId) : null,
    memo: l.memo ? String(l.memo) : null,
  }));

  try {
    const entry = await postJournalEntry({
      entryDate: body.entryDate ? new Date(body.entryDate) : undefined,
      memo: body.memo ? String(body.memo) : null,
      source: "manual",
      createdBy: session.user.id,
      lines,
      asDraft: Boolean(body.asDraft),
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    // LedgerError = app-side validation; a DB error here is the balance/immutability
    // trigger firing. Either way it's a 400 the user can fix.
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
