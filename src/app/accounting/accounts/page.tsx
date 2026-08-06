import { revalidatePath } from "next/cache";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { AccountTypeFields } from "@/components/accounting/AccountTypeFields";
import {
  ACCOUNT_TYPES,
  REPORT_GROUP_LABELS,
  defaultReportGroupFor,
  isAccountType,
  isReportGroupValidFor,
  normalBalanceFor,
  type AccountType,
} from "@/lib/chartOfAccounts";

export const dynamic = "force-dynamic";

// Section order follows the chart: balance sheet, then the P&L top-down. Driven by
// ACCOUNT_TYPES so a new type (Phase 11 added `cogs`) can't render as a missing
// section header with its accounts invisible.
const TYPE_ORDER = ACCOUNT_TYPES;
const SECTION_LABELS: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
};

async function createAccount(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const rawType = String(formData.get("type") ?? "");
  if (!code || !name || !isAccountType(rawType)) return;
  const rawGroup = String(formData.get("reportGroup") ?? "");
  await db.insert(glAccounts).values({
    code,
    name,
    type: rawType,
    // Derived from the type, never submitted — an expense with a credit balance
    // (or a liability with a debit one) inverts every report built on it.
    normalBalance: normalBalanceFor(rawType),
    reportGroup: isReportGroupValidFor(rawType, rawGroup) ? rawGroup : defaultReportGroupFor(rawType),
  });
  revalidatePath("/accounting/accounts");
}

const inputCls =
  "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500";

export default async function ChartOfAccountsPage() {
  const rows = await db.select().from(glAccounts).orderBy(asc(glAccounts.code));
  const byType = TYPE_ORDER.map((t) => ({
    type: t,
    label: SECTION_LABELS[t],
    accounts: rows.filter((r) => r.type === t),
  })).filter((g) => g.accounts.length > 0);

  return (
    <AppShell title="Chart of Accounts" subtitle="The ledger's account list — debits and credits post against these">
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          Add account
        </h3>
        <form action={createAccount} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input name="code" required placeholder="Code * (e.g. 6060)" className={inputCls} />
          <input name="name" required placeholder="Name * (e.g. Marketing)" className={`${inputCls} md:col-span-2`} />
          <AccountTypeFields />
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Save account
            </button>
          </div>
        </form>
      </div>

      {byType.map((group) => (
        <div key={group.type} className="bg-surface border border-white/5 rounded-lg overflow-hidden">
          <div className="bg-white/5 px-4 py-2 text-[11px] font-body font-semibold text-white uppercase tracking-wider">
            {group.label}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Normal balance</th>
                <th className="px-4 py-2">P&amp;L group</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="font-body text-zinc-200">
              {group.accounts.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-400">{a.code}</td>
                  <td className="px-4 py-2 text-white">{a.name}</td>
                  <td className="px-4 py-2 text-xs capitalize">{a.normalBalance}</td>
                  <td className="px-4 py-2 text-xs">{REPORT_GROUP_LABELS[a.reportGroup]}</td>
                  <td className="px-4 py-2 text-xs">
                    {a.isActive ? (
                      <span className="text-emerald-400">Active</span>
                    ) : (
                      <span className="text-zinc-500">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {rows.length === 0 && (
        <p className="text-xs text-zinc-500 font-body">
          No accounts yet. Run <code className="text-amber-400">docs/sql/accounting_phase1.sql</code> in Neon to seed the starter chart.
        </p>
      )}
    </AppShell>
  );
}
