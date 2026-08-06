import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { glAccounts } from "@/db/schema";

import {
  defaultReportGroupFor,
  isAccountType,
  isReportGroupValidFor,
  normalBalanceFor,
} from "@/lib/chartOfAccounts";

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
  if (!isAccountType(body.type))
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  // Normal balance is derived, never accepted from the caller: an expense with a
  // credit balance (or a liability with a debit one) inverts every report built
  // on it. Any `normalBalance` in the body is ignored on purpose.
  const normalBalance = normalBalanceFor(body.type);
  // The group must belong to the type, so a COGS account can't be filed under
  // operating expenses and end up below gross profit.
  const reportGroup = isReportGroupValidFor(body.type, body.reportGroup)
    ? body.reportGroup
    : defaultReportGroupFor(body.type);

  const [row] = await db
    .insert(glAccounts)
    .values({
      code: body.code.trim(),
      name: body.name.trim(),
      type: body.type,
      reportGroup,
      normalBalance,
      isActive: body.isActive ?? true,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
