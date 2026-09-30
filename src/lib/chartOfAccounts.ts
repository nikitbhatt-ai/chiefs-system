// Chart-of-accounts rules that must hold everywhere an account is created.
//
// Normal balance is DERIVED from the account type, never chosen by a user. An
// expense account with a credit normal balance, or a liability with a debit one,
// is always a mistake — and one that quietly inverts every report built on it.
// The same rule is enforced in the database by the CHECK constraint in
// docs/sql/accounting_phase11.sql, so a direct SQL insert cannot bypass it.

import type { glAccountType, glNormalBalance, glReportGroup } from "@/db/schema";

export type AccountType = (typeof glAccountType.enumValues)[number];
export type NormalBalance = (typeof glNormalBalance.enumValues)[number];
export type ReportGroup = (typeof glReportGroup.enumValues)[number];

/** The account types offered when creating an account, in report order. */
export const ACCOUNT_TYPES: readonly AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expense",
};

/** Which side an account type is normally increased on. Not user-editable. */
export const NORMAL_BALANCE_BY_TYPE: Record<AccountType, NormalBalance> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
  cogs: "debit",
  expense: "debit",
};

export function normalBalanceFor(type: AccountType): NormalBalance {
  return NORMAL_BALANCE_BY_TYPE[type];
}

export function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);
}

/**
 * P&L report groups selectable for a given account type. Keeps someone from
 * filing a COGS account under operating expenses, which would put it below
 * gross profit and defeat the point of separating the two.
 *
 * `cogs_other` exists so Purchase Price Variance sits in COGS without landing in
 * `cogs_parts`: job costing treats `cogs_parts` as "material settled out of WIP"
 * and splits it by part category (src/lib/cogsCategories.ts), and a variance is
 * neither of those things.
 *
 * The legacy `labor` / `other_expense` values are deliberately absent: they
 * still exist in the enum for historical rows but should never be assigned
 * again.
 */
export const REPORT_GROUPS_BY_TYPE: Record<AccountType, readonly ReportGroup[]> = {
  asset: ["none"],
  liability: ["none"],
  equity: ["none"],
  revenue: ["revenue"],
  cogs: ["cogs_parts", "cogs_labor", "cogs_other"],
  expense: ["operating_expense", "admin_labor"],
};

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  revenue: "Revenue",
  cogs_parts: "COGS — parts & materials",
  cogs_labor: "COGS — direct labor",
  cogs_other: "COGS — other (variances, adjustments)",
  admin_labor: "Operating — payroll & benefits",
  operating_expense: "Operating — other",
  none: "Balance sheet (no P&L group)",
  labor: "Labor (legacy)",
  other_expense: "Other expense (legacy)",
};

/** Default group for a type — the first valid choice. */
export function defaultReportGroupFor(type: AccountType): ReportGroup {
  return REPORT_GROUPS_BY_TYPE[type][0];
}

export function isReportGroupValidFor(type: AccountType, group: unknown): group is ReportGroup {
  return (REPORT_GROUPS_BY_TYPE[type] as readonly string[]).includes(group as string);
}
