import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { handleCallback } from "@/lib/qbo";
import { LedgerError } from "@/lib/accounting";

// Intuit redirects the browser here after the user authorizes (this URL must be
// registered as QBO_REDIRECT_URI). Admin-only; exchanges the code for tokens.
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") return NextResponse.redirect(new URL("/", req.url));

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");

  const back = (qs: string) => NextResponse.redirect(new URL(`/accounting/quickbooks?${qs}`, req.url));

  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code || !realmId || !state) return back(`error=${encodeURIComponent("Missing code, realmId, or state from QuickBooks.")}`);

  try {
    await handleCallback(code, realmId, state, session.user.id ?? null);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Connection failed.")}`);
  }
  return back("connected=1");
}
