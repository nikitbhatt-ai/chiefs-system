import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { listCategoryMappings, setCategoryAccount, UNCATEGORIZED_COGS_CODE } from "@/lib/cogsCategories";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// Prefix on the form field names. Categories are free text and can contain
// anything, so the value is keyed by its own field name rather than positionally.
const FIELD_PREFIX = "cat:";

async function saveMappings(formData: FormData) {
  "use server";
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(FIELD_PREFIX)) continue;
    const category = key.slice(FIELD_PREFIX.length);
    const accountId = String(value ?? "");
    await setCategoryAccount(category, accountId || null);
  }
  revalidatePath("/accounting/cogs-categories");
}

export default async function CogsCategoriesPage() {
  const [rows, accounts] = await Promise.all([
    listCategoryMappings(),
    db
      .select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name })
      .from(glAccounts)
      .where(and(eq(glAccounts.type, "cogs"), eq(glAccounts.reportGroup, "cogs_parts")))
      .orderBy(asc(glAccounts.code)),
  ]);

  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const uncategorized = byCode.get(UNCATEGORIZED_COGS_CODE);
  const unmapped = rows.filter((r) => !r.accountId);
  const selectCls =
    "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white w-full max-w-xs";

  return (
    <AppShell
      title="COGS by part category"
      subtitle="Which COGS account each part category settles into when a job closes"
    >
      <div className="flex items-center gap-3">
        <Link href="/accounting/accounts" className="text-xs text-amber-400 hover:text-amber-300 font-body">
          ← Chart of accounts
        </Link>
        <Link href="/accounting/job-costing" className="text-xs text-amber-400 hover:text-amber-300 font-body">
          Job costing →
        </Link>
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-zinc-500 font-body">
          No COGS accounts yet. Run{" "}
          <code className="text-amber-400">docs/sql/accounting_phase11.sql</code> in Neon to create the
          component accounts (5110 Wire &amp; Cable, 5120 Emergency Lights, …), then come back.
        </p>
      ) : (
        <>
          {unmapped.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-body text-amber-200">
              <span className="font-semibold">
                {unmapped.length} categor{unmapped.length === 1 ? "y is" : "ies are"} unmapped.
              </span>{" "}
              Material in {unmapped.length === 1 ? "it" : "them"} settles to{" "}
              {uncategorized ? `${uncategorized.code} ${uncategorized.name}` : "the uncategorized account"} instead
              of a component account. Anything pre-selected below is a name-match suggestion — save it to make it real.
            </div>
          )}

          <form action={saveMappings} className="bg-surface border border-white/5 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
                  <th className="px-4 py-2">Part category</th>
                  <th className="px-4 py-2 text-right">Parts</th>
                  <th className="px-4 py-2">COGS account</th>
                </tr>
              </thead>
              <tbody className="font-body text-zinc-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-xs text-zinc-500">
                      No part categories in use yet. Set a category on a part and it shows up here.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const suggested = r.suggestedCode ? byCode.get(r.suggestedCode) : undefined;
                    return (
                      <tr key={r.category} className="border-t border-white/5">
                        <td className="px-4 py-2 text-white text-xs">
                          {r.category}
                          {!r.accountId && suggested && (
                            <span className="ml-2 text-[10px] text-amber-400">suggested</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">{r.partCount}</td>
                        <td className="px-4 py-2">
                          <select
                            name={`${FIELD_PREFIX}${r.category}`}
                            defaultValue={r.accountId ?? suggested?.id ?? ""}
                            className={selectCls}
                            aria-label={`COGS account for ${r.category}`}
                          >
                            <option value="">
                              — unmapped ({uncategorized ? `${uncategorized.code} ${uncategorized.name}` : "uncategorized"}) —
                            </option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {rows.length > 0 && (
              <div className="flex justify-end px-4 py-3 border-t border-white/5">
                <SubmitButton
                  className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
                >
                  Save mappings
                </SubmitButton>
              </div>
            )}
          </form>
        </>
      )}

      <p className="text-[11px] text-zinc-500 font-body">
        When a job settles, its material cost is split across these accounts in proportion to the categories
        of the parts issued to it, so the P&amp;L shows what the money went into rather than one Materials
        line. Changing a mapping affects future settlements only — posted entries are never rewritten.
      </p>
    </AppShell>
  );
}
