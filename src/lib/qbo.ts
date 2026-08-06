// QuickBooks Online integration — Phase 9 (LAST).
//
// Connect via Intuit OAuth 2.0, map our chart of accounts to QBO accounts, pull
// payroll labor totals for P&L reconciliation, and one-direction sync into a
// SANDBOX company first (production requires a separate explicit confirmation).
//
// Intuit credentials live in env: QBO_CLIENT_ID / QBO_CLIENT_SECRET /
// QBO_REDIRECT_URI. Until they're set, `qboConfigured()` is false and the UI
// stays inert. The OAuth code here follows Intuit's standard flow; it must be
// exercised against a real Intuit app + sandbox company to be confirmed working.

import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { qboSettings, qboAccountMap, qboSyncLog, glAccounts, departments } from "@/db/schema";
import { postJournalEntry, LedgerError } from "@/lib/accounting";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export function qboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_REDIRECT_URI);
}

// ── Settings (single row) ─────────────────────────────────────────────────────

export async function getSettings() {
  const [row] = await db.select().from(qboSettings).limit(1);
  if (row) return row;
  const [created] = await db.insert(qboSettings).values({ environment: "sandbox" }).returning();
  return created;
}

export function isConnected(s: { accessToken: string | null; realmId: string | null }): boolean {
  return Boolean(s.accessToken && s.realmId);
}

/** Switch sandbox⇄production. Moving to production requires explicit confirmation. */
export async function setEnvironment(environment: "sandbox" | "production", confirmProduction: boolean, createdBy?: string | null) {
  if (environment === "production" && !confirmProduction) {
    throw new LedgerError("Switching to a production QuickBooks company requires explicit confirmation.");
  }
  const s = await getSettings();
  // Changing environment invalidates any existing connection.
  await db
    .update(qboSettings)
    .set({ environment, accessToken: null, refreshToken: null, realmId: null, connectedAt: null, tokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(qboSettings.id, s.id));
  await logSync("set_environment", "info", "ok", `Environment set to ${environment}${environment === "production" ? " (confirmed)" : ""}. Reconnect required.`, createdBy);
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

/** Build the Intuit authorize URL and stash the CSRF state. Throws if unconfigured. */
export async function beginAuth(): Promise<string> {
  if (!qboConfigured()) throw new LedgerError("QuickBooks isn't configured — set QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI in the environment first.");
  const s = await getSettings();
  const state = randomUUID();
  await db.update(qboSettings).set({ authState: state, updatedAt: new Date() }).where(eq(qboSettings.id, s.id));

  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    redirect_uri: process.env.QBO_REDIRECT_URI!,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Handle the OAuth redirect: verify state, exchange the code for tokens, store them. */
export async function handleCallback(code: string, realmId: string, state: string, createdBy?: string | null) {
  if (!qboConfigured()) throw new LedgerError("QuickBooks isn't configured.");
  const s = await getSettings();
  if (!s.authState || s.authState !== state) {
    await logSync("connect", "auth", "error", "OAuth state mismatch — ignoring callback.", createdBy);
    throw new LedgerError("OAuth state mismatch — please start the connection again.");
  }

  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    await logSync("connect", "auth", "error", `Token exchange failed (${res.status}). ${detail.slice(0, 300)}`, createdBy);
    throw new LedgerError(`QuickBooks token exchange failed (${res.status}).`);
  }
  const token = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

  await db
    .update(qboSettings)
    .set({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
      realmId,
      connectedAt: new Date(),
      authState: null,
      updatedAt: new Date(),
    })
    .where(eq(qboSettings.id, s.id));
  await logSync("connect", "auth", "ok", `Connected to QuickBooks (${s.environment}), realm ${realmId}.`, createdBy);
}

export async function disconnect(createdBy?: string | null) {
  const s = await getSettings();
  await db
    .update(qboSettings)
    .set({ accessToken: null, refreshToken: null, realmId: null, connectedAt: null, tokenExpiresAt: null, authState: null, updatedAt: new Date() })
    .where(eq(qboSettings.id, s.id));
  await logSync("disconnect", "auth", "info", "Disconnected from QuickBooks.", createdBy);
}

// ── Chart-of-accounts mapping ─────────────────────────────────────────────────

export async function listAccountMappings() {
  return db
    .select({
      glId: glAccounts.id,
      code: glAccounts.code,
      name: glAccounts.name,
      type: glAccounts.type,
      qboAccountId: qboAccountMap.qboAccountId,
      qboAccountName: qboAccountMap.qboAccountName,
    })
    .from(glAccounts)
    .leftJoin(qboAccountMap, eq(qboAccountMap.glAccountId, glAccounts.id))
    .where(eq(glAccounts.isActive, true))
    .orderBy(asc(glAccounts.code));
}

export async function setAccountMapping(glAccountId: string, qboAccountId: string | null, qboAccountName: string | null, createdBy?: string | null) {
  const existing = await db.select({ id: qboAccountMap.id }).from(qboAccountMap).where(eq(qboAccountMap.glAccountId, glAccountId)).limit(1);
  if (existing.length) {
    await db.update(qboAccountMap).set({ qboAccountId, qboAccountName, updatedAt: new Date() }).where(eq(qboAccountMap.glAccountId, glAccountId));
  } else {
    await db.insert(qboAccountMap).values({ glAccountId, qboAccountId, qboAccountName });
  }
  await logSync("coa_map", "info", "ok", `Mapped GL account to QBO "${qboAccountName ?? qboAccountId ?? "(cleared)"}".`, createdBy);
}

// ── Payroll labor import (for P&L reconciliation) ─────────────────────────────

/** Whether a department's payroll is a cost of the build or overhead. */
export type PayrollKind = "direct" | "admin";

/** Direct labor is a cost of goods sold; administrative payroll is overhead. */
export const PAYROLL_ACCOUNT_BY_KIND: Record<PayrollKind, string> = {
  direct: "5300", // Direct Labor — Installers (COGS, above gross profit)
  admin: "6010", // Payroll — Administrative (operating expense)
};

/**
 * Bring payroll labor totals into the ledger so the P&L labor section
 * reconciles with payroll. Cr Cash (1000) for the total; the debit goes to
 * 5300 Direct Labor or 6010 Payroll — Administrative per line.
 *
 * The split is entered, not inferred: only whoever runs payroll knows which
 * departments turn wrenches on jobs, and putting overhead above gross profit (or
 * direct labor below it) misstates the margin the shop is managed by. This used
 * to post everything to 5000 Wages, which Phase 11 retired for exactly that
 * reason. Lines default to `admin` — the conservative side, since overstating
 * gross profit is the more misleading error.
 */
export async function importPayrollLabor(opts: {
  periodLabel: string;
  lines: { departmentId: string | null; amountCents: number; kind?: PayrollKind }[];
  entryDate?: Date;
  createdBy?: string | null;
}) {
  const lines = opts.lines.filter((l) => Math.round(l.amountCents) > 0);
  if (lines.length === 0) throw new LedgerError("Enter at least one department labor total greater than zero.");
  const total = lines.reduce((s, l) => s + Math.round(l.amountCents), 0);

  // Resolve only the accounts this import actually needs, so a shop that never
  // marks anything direct isn't blocked on 5300 existing.
  const kinds = new Set<PayrollKind>(lines.map((l) => l.kind ?? "admin"));
  const [cashId, ...kindIds] = await Promise.all([
    accountId("1000"),
    ...[...kinds].map((k) => payrollAccountId(k)),
  ]);
  const accountByKind = new Map([...kinds].map((k, i) => [k, kindIds[i]]));

  const entry = await postJournalEntry({
    entryDate: opts.entryDate ?? new Date(),
    memo: `Payroll labor — ${opts.periodLabel}`,
    source: "system",
    createdBy: opts.createdBy ?? null,
    lines: [
      ...lines.map((l) => {
        const kind = l.kind ?? "admin";
        return {
          accountId: accountByKind.get(kind)!,
          debitCents: Math.round(l.amountCents),
          departmentId: l.departmentId ?? null,
          memo: kind === "direct" ? "Direct labor — payroll" : "Administrative payroll",
        };
      }),
      { accountId: cashId, creditCents: total, memo: "Payroll paid" },
    ],
  });
  await logSync("payroll_import", "from_qbo", "ok", `Imported payroll labor for ${opts.periodLabel}: ${lines.length} department line(s).`, opts.createdBy);
  return entry;
}

export async function departmentsForPayroll() {
  return db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name));
}

// ── Sync log ──────────────────────────────────────────────────────────────────

export async function logSync(action: string, direction: string | null, status: "ok" | "error" | "info", message: string, createdBy?: string | null) {
  await db.insert(qboSyncLog).values({ action, direction, status, message, createdBy: createdBy ?? null });
}

export async function listSyncLog() {
  return db.select().from(qboSyncLog).orderBy(desc(qboSyncLog.createdAt)).limit(100);
}

/** Payroll target account, with an error that names the SQL that creates it. */
async function payrollAccountId(kind: PayrollKind): Promise<string> {
  const code = PAYROLL_ACCOUNT_BY_KIND[kind];
  const [row] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row)
    throw new LedgerError(
      `Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase11.sql in Neon to split direct labor from administrative payroll.`,
    );
  return row.id;
}

async function accountId(code: string): Promise<string> {
  const [row] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row) throw new LedgerError(`Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`);
  return row.id;
}
