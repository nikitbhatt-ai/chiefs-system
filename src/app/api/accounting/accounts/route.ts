import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { glAccounts } from "@/db/schema";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const GROUPS = ["revenue", "labor", "other_expense", "none"] as const;
const BALANCES = ["debit", "credit"] as const;

export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const rows = await db.select().from(glAccounts).orderBy(asc(glAccounts.code));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== "string" || !body.code.trim())
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (typeof body.name !== "string" || !body.name.trim())
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!TYPES.includes(body.type))
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  if (!BALANCES.includes(body.normalBalance))
    return NextResponse.json({ error: "invalid normal_balance" }, { status: 400 });
  const reportGroup = GROUPS.includes(body.reportGroup) ? body.reportGroup : "none";

  const [row] = await db
    .insert(glAccounts)
    .values({
      code: body.code.trim(),
      name: body.name.trim(),
      type: body.type,
      reportGroup,
      normalBalance: body.normalBalance,
      isActive: body.isActive ?? true,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
