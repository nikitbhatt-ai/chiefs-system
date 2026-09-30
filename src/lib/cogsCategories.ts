// Part category → COGS account mapping, and the split of a job's material cost
// across those accounts.
//
// The accountant's chart splits Cost of Goods Sold into the components actually
// installed on a vehicle (wire, lights, sirens, consoles, …). Twelve accounts are
// easy to create; the work is making them populate. Material reaches COGS in one
// place only — the WIP→COGS settlement in src/lib/jobCosting.ts — and that used
// to post the whole job as a single line to 5100. This module is what turns that
// lump into per-component lines.
//
// How the split is derived:
//   • `inventory_issue` holds one row per layer drained per part per work order,
//     and is the live picture of what is issued: a walk-back DELETEs the rows
//     (src/lib/costing.ts :: reverseIssuesTx), it does not offset them.
//   • Each part carries a free-text `category`; a row in `part_category_accounts`
//     maps that category to a GL account. Unmapped → 5100 Uncategorized.
//   • The issue rows are WEIGHTS, not the amounts posted. Their unit_cost is the
//     FIFO layer cost, while WIP may have been charged at weighted average
//     (src/lib/costing.ts :: chargeCents), so the two totals can differ by a few
//     cents or more. The settlement must relieve the WIP balance EXACTLY, so the
//     balance is apportioned by weight and the rounding remainder is handed out
//     largest-fraction-first. Sum of the split always equals the WIP balance.

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts, inventoryIssue, partCategoryAccounts, parts } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/** Where material with no category mapping lands. */
export const UNCATEGORIZED_COGS_CODE = "5100";

/**
 * The COGS accounts that exist to receive a category, in chart order. Used to
 * populate the mapping picker; the account list itself is read from the ledger,
 * this is only the suggestion metadata.
 *
 * `keywords` drive `suggestAccountCodeForCategory`, which PRE-SELECTS a mapping
 * in the UI for review. Nothing keyword-matched is ever posted on its own — an
 * unconfirmed category posts to Uncategorized. Guessing at setup time where a
 * human can see and change it is fine; guessing silently at posting time is not.
 */
export const COGS_CATEGORY_SUGGESTIONS: readonly { code: string; keywords: readonly string[] }[] = [
  { code: "5110", keywords: ["wire", "cable", "wiring", "harness", "connector"] },
  { code: "5120", keywords: ["light", "lightbar", "led", "beacon", "strobe"] },
  { code: "5130", keywords: ["siren", "speaker", "horn", "amplifier"] },
  { code: "5140", keywords: ["console", "armrest", "cup holder"] },
  { code: "5150", keywords: ["partition", "cage", "prisoner", "transport seat"] },
  { code: "5160", keywords: ["gun lock", "gunlock", "weapon", "rifle", "shotgun"] },
  { code: "5170", keywords: ["bracket", "mount", "mounting", "pedestal", "pole"] },
  { code: "5180", keywords: ["radio", "antenna", "microphone"] },
  { code: "5190", keywords: ["camera", "dash cam", "dashcam", "video"] },
  { code: "5200", keywords: ["graphic", "decal", "wrap", "lettering", "reflective"] },
  { code: "5210", keywords: ["freight", "shipping"] },
  { code: "5220", keywords: ["shop supply", "shop supplies", "consumable", "hardware", "fastener"] },
];

/** Normalised form used for matching. Category is free text typed by hand. */
export function categoryKey(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Best guess at a COGS account code for a free-text category, or null when
 * nothing matches. Suggestion only — see the note on COGS_CATEGORY_SUGGESTIONS.
 */
export function suggestAccountCodeForCategory(category: string | null | undefined): string | null {
  const key = categoryKey(category);
  if (!key) return null;
  for (const { code, keywords } of COGS_CATEGORY_SUGGESTIONS) {
    if (keywords.some((k) => key.includes(k))) return code;
  }
  return null;
}

/** Saved mappings, keyed by normalised category. */
export async function loadCategoryAccountMap(tx: Tx = db): Promise<Map<string, string>> {
  const rows = await tx
    .select({ category: partCategoryAccounts.category, accountId: partCategoryAccounts.accountId })
    .from(partCategoryAccounts);
  const map = new Map<string, string>();
  for (const r of rows) map.set(categoryKey(r.category), r.accountId);
  return map;
}

/** Material cost issued to a job, grouped by the part's category. Weights only. */
export async function issuedWeightsByCategory(
  tx: Tx,
  workOrderId: string,
): Promise<{ category: string | null; weightCents: number }[]> {
  const rows = await tx
    .select({
      category: parts.category,
      weightCents:
        sql<number>`COALESCE(SUM(${inventoryIssue.qty} * ROUND(${inventoryIssue.unitCost} * 100)), 0)`.mapWith(Number),
    })
    .from(inventoryIssue)
    .innerJoin(parts, eq(parts.id, inventoryIssue.partId))
    .where(eq(inventoryIssue.workOrderId, workOrderId))
    .groupBy(parts.category);
  return rows.map((r) => ({ category: r.category, weightCents: Number(r.weightCents) || 0 }));
}

export type CogsSplitLine = {
  accountId: string;
  code: string;
  name: string;
  cents: number;
  /** Categories folded into this line, for the journal memo and the UI preview. */
  categories: string[];
};

/**
 * Apportion `totalCents` across COGS accounts by weight, largest remainder first.
 * Exported for its own sake because "does the split add up" is the one property
 * that must hold no matter what the weights look like.
 */
export function apportion<T>(
  buckets: readonly { key: T; weightCents: number }[],
  totalCents: number,
): { key: T; cents: number }[] {
  const positive = buckets.filter((b) => b.weightCents > 0);
  if (positive.length === 0 || totalCents === 0) return [];
  const weightTotal = positive.reduce((s, b) => s + b.weightCents, 0);

  const exact = positive.map((b) => (totalCents * b.weightCents) / weightTotal);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = totalCents - floors.reduce((s, v) => s + v, 0);

  // Hand the leftover cents to the biggest fractional parts, so the split sums
  // to totalCents exactly rather than leaving a stray cent to unbalance the entry.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = positive.map((b, i) => ({ key: b.key, cents: floors[i] }));
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i].cents += 1;
    remainder -= 1;
  }
  return out.filter((o) => o.cents !== 0);
}

/**
 * The COGS lines for settling `totalCents` of a job's WIP.
 *
 * Falls back to a single Uncategorized line when there is nothing to split by —
 * no issue rows (a job costed before this existed, or material posted to WIP by
 * hand), or every category unmapped. A settlement never fails because the
 * mapping is incomplete; it lands somewhere visible instead.
 */
export async function cogsSplitForWorkOrder(
  tx: Tx,
  workOrderId: string,
  totalCents: number,
): Promise<CogsSplitLine[]> {
  const [weights, mapping, accounts] = await Promise.all([
    issuedWeightsByCategory(tx, workOrderId),
    loadCategoryAccountMap(tx),
    tx
      .select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name })
      .from(glAccounts)
      .where(eq(glAccounts.type, "cogs")),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const uncategorized = accounts.find((a) => a.code === UNCATEGORIZED_COGS_CODE);

  // Fold categories into their target account. Anything unmapped, or mapped to an
  // account that has since been deleted, collects on Uncategorized.
  const byAccount = new Map<string, { weightCents: number; categories: Set<string> }>();
  for (const w of weights) {
    if (w.weightCents <= 0) continue;
    const mapped = mapping.get(categoryKey(w.category));
    const targetId = mapped && accountById.has(mapped) ? mapped : uncategorized?.id;
    if (!targetId) continue; // no 5100 either — handled by the fallback below
    const cur = byAccount.get(targetId) ?? { weightCents: 0, categories: new Set<string>() };
    cur.weightCents += w.weightCents;
    if (w.category?.trim()) cur.categories.add(w.category.trim());
    byAccount.set(targetId, cur);
  }

  const split = apportion(
    [...byAccount].map(([accountId, v]) => ({ key: accountId, weightCents: v.weightCents })),
    totalCents,
  );

  if (split.length === 0) {
    if (!uncategorized) return [];
    return [
      {
        accountId: uncategorized.id,
        code: uncategorized.code,
        name: uncategorized.name,
        cents: totalCents,
        categories: [],
      },
    ];
  }

  return split
    .map((s) => {
      const acct = accountById.get(s.key)!;
      return {
        accountId: acct.id,
        code: acct.code,
        name: acct.name,
        cents: s.cents,
        categories: [...(byAccount.get(s.key)?.categories ?? [])].sort(),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Every part category in use, with its mapping (if any). Powers the admin page. */
export async function listCategoryMappings(): Promise<
  { category: string; accountId: string | null; suggestedCode: string | null; partCount: number }[]
> {
  const [used, mappings] = await Promise.all([
    db
      .select({
        category: parts.category,
        partCount: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(parts)
      .where(and(isNotNull(parts.category), eq(parts.archived, false), sql`btrim(${parts.category}) <> ''`))
      .groupBy(parts.category),
    loadCategoryAccountMap(),
  ]);

  return used
    .map((u) => {
      const category = (u.category ?? "").trim();
      const accountId = mappings.get(categoryKey(category)) ?? null;
      return {
        category,
        accountId,
        suggestedCode: accountId ? null : suggestAccountCodeForCategory(category),
        partCount: Number(u.partCount) || 0,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Upsert (or clear, when accountId is null) the account for a category.
 *
 * Refuses an account that isn't in `cogs_parts`: pointing a part category at
 * direct labor or at purchase price variance would file material cost under a
 * section that isn't material cost. The guard lives here rather than in the form
 * so the server action and the API route can't disagree.
 */
export async function setCategoryAccount(category: string, accountId: string | null): Promise<void> {
  const trimmed = category.trim();
  if (!trimmed) return;
  if (accountId) {
    const [ok] = await db
      .select({ id: glAccounts.id })
      .from(glAccounts)
      .where(and(eq(glAccounts.id, accountId), eq(glAccounts.reportGroup, "cogs_parts")))
      .limit(1);
    if (!ok) throw new Error("A part category can only map to a COGS parts & materials account.");
  }
  if (!accountId) {
    await db.delete(partCategoryAccounts).where(sql`lower(${partCategoryAccounts.category}) = ${categoryKey(trimmed)}`);
    return;
  }
  // Raw SQL because the conflict target is the FUNCTIONAL unique index on
  // lower(category) — Drizzle's `onConflictDoUpdate` only accepts plain columns.
  // Matching case-insensitively is the point: "Sirens" and "sirens" must update
  // one row instead of creating a second, conflicting mapping.
  await db.execute(sql`
    INSERT INTO part_category_accounts (category, account_id)
    VALUES (${trimmed}, ${accountId})
    ON CONFLICT (lower(category))
    DO UPDATE SET account_id = ${accountId}, category = ${trimmed}, updated_at = now()
  `);
}
