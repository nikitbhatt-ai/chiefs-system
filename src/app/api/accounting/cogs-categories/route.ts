import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { glAccounts } from "@/db/schema";
import { listCategoryMappings, setCategoryAccount } from "@/lib/cogsCategories";

/** Part categories in use, their COGS account, and the accounts available. */
export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const [categories, accounts] = await Promise.all([
    listCategoryMappings(),
    db
      .select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name })
      .from(glAccounts)
      .where(and(eq(glAccounts.type, "cogs"), eq(glAccounts.reportGroup, "cogs_parts")))
      .orderBy(asc(glAccounts.code)),
  ]);
  return NextResponse.json({ categories, accounts });
}

/** Map a category to a COGS account, or clear it with `accountId: null`. */
export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.category !== "string" || !body.category.trim())
    return NextResponse.json({ error: "category is required" }, { status: 400 });

  const accountId = body.accountId == null ? null : String(body.accountId);
  // setCategoryAccount rejects anything that isn't a COGS parts & materials
  // account — the check lives there so this route and the form can't disagree.
  try {
    await setCategoryAccount(body.category, accountId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid mapping" }, { status: 400 });
  }
  return NextResponse.json({ category: body.category.trim(), accountId });
}
