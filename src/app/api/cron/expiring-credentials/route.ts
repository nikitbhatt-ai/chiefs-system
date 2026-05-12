import { NextResponse } from "next/server";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { deals, dealCredentials, customers } from "@/db/schema";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Daily cron: scan deal_credentials whose expires_at falls within the next
// 30 days. For each, if expiration_notified_at is null or older than 7
// days, fire a notification to the deal's assignee and bump
// expiration_notified_at. The 7-day dedup keeps the alert sticky as the
// deadline approaches without spamming.
//
// Wire this up in vercel.json under "crons" — daily at 13:00 UTC works
// (early morning Central Time). Vercel automatically attaches a
// `Authorization: Bearer ${CRON_SECRET}` header to scheduled requests;
// we reject anything else.
const ALERT_WINDOW_DAYS = 30;
const DEDUP_DAYS = 7;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dedupCutoff = new Date(now.getTime() - DEDUP_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: dealCredentials.id,
      dealId: dealCredentials.dealId,
      credentialType: dealCredentials.credentialType,
      credentialNumber: dealCredentials.credentialNumber,
      expiresAt: dealCredentials.expiresAt,
      expirationNotifiedAt: dealCredentials.expirationNotifiedAt,
    })
    .from(dealCredentials)
    .where(
      and(
        // Has an expiration set and it's within the 30-day window or past
        lte(dealCredentials.expiresAt, horizon),
        // Not already notified recently
        or(
          isNull(dealCredentials.expirationNotifiedAt),
          lte(dealCredentials.expirationNotifiedAt, dedupCutoff),
        ),
      ),
    );

  let notifiedCount = 0;
  for (const cred of rows) {
    if (!cred.expiresAt) continue;
    // Fetch deal + customer to get the assignee and a good notification
    // body. Use a single fetch per row — at the scale we run this (daily,
    // tens of creds), it's not worth a join.
    const [d] = await db
      .select({ id: deals.id, assignedTo: deals.assignedTo, customerId: deals.customerId })
      .from(deals)
      .where(eq(deals.id, cred.dealId));
    if (!d?.assignedTo) {
      // No one to notify — still mark notified so we don't re-scan it
      // every day in vain.
      await db
        .update(dealCredentials)
        .set({ expirationNotifiedAt: now })
        .where(eq(dealCredentials.id, cred.id));
      continue;
    }
    const [cust] = d.customerId
      ? await db.select({ name: customers.name }).from(customers).where(eq(customers.id, d.customerId))
      : [{ name: null }];
    const daysLeft = Math.floor((cred.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const expired = daysLeft < 0;
    const title = expired
      ? `Credential expired: ${cred.credentialType}`
      : `Credential expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}: ${cred.credentialType}`;
    const body = `${cust?.name ? `${cust.name} · ` : ""}${cred.credentialNumber ?? ""}`.trim() || undefined;
    await notify(d.assignedTo, {
      kind: "doc_reminder",
      title,
      body: body ?? null,
      link: `/deals/${d.id}?tab=credentials`,
      dealId: d.id,
    });
    await db
      .update(dealCredentials)
      .set({ expirationNotifiedAt: now })
      .where(eq(dealCredentials.id, cred.id));
    notifiedCount += 1;
  }

  return NextResponse.json({ ok: true, scanned: rows.length, notified: notifiedCount });
}
