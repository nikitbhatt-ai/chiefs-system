import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole, MANAGER_ROLES, secretEquals } from "@/lib/rbac";
import { syncAllMailboxes } from "@/lib/mailSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Incremental Graph mail sync across every enabled mailbox in comm_accounts.
//
// GET  — the Vercel cron entry point. Vercel attaches
//        `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected,
//        and an unset CRON_SECRET fails closed (see secretEquals).
// POST — the "Sync now" button on /communications. Session-authenticated,
//        manager+ only.
//
// Both paths run the same code, so a manual run is never a different code path
// than the scheduled one.

export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!secretEquals(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await syncAllMailboxes();
  return NextResponse.json(summary);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasRole(session, MANAGER_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId : undefined;

  const summary = await syncAllMailboxes({ accountId });
  return NextResponse.json(summary);
}
