"use client";

import { useState } from "react";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  REPORT_GROUPS_BY_TYPE,
  REPORT_GROUP_LABELS,
  normalBalanceFor,
  type AccountType,
} from "@/lib/chartOfAccounts";

/**
 * Account type + P&L group pickers for the new-account form.
 *
 * There is deliberately NO normal-balance input. It is derived from the type
 * (asset/expense/COGS → debit, liability/equity/revenue → credit) and shown
 * read-only, because choosing it by hand is how an expense account ends up with
 * a credit balance and silently inverts every report built on it. The server
 * derives it again rather than trusting anything posted, and a CHECK constraint
 * enforces the same rule for direct SQL.
 *
 * The group list is filtered to the ones valid for the chosen type, so a COGS
 * account can't be filed under operating expenses and land below gross profit.
 */
export function AccountTypeFields() {
  const [type, setType] = useState<AccountType>("expense");
  const groups = REPORT_GROUPS_BY_TYPE[type];
  const balance = normalBalanceFor(type);

  const inputCls =
    "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500";

  return (
    <>
      <select
        name="type"
        required
        value={type}
        onChange={(e) => setType(e.target.value as AccountType)}
        className={inputCls}
        aria-label="Account type"
      >
        {ACCOUNT_TYPES.map((t) => (
          <option key={t} value={t}>
            {ACCOUNT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <div
        className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
        aria-label="Normal balance (set automatically)"
      >
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Normal balance</span>
        <span className="text-white font-body capitalize">{balance}</span>
        <span className="text-[10px] text-zinc-500 font-body">· set by type</span>
      </div>

      {/* `key` remounts the select when the type changes so it resets to a group
          that is actually valid for the new type rather than keeping a stale one. */}
      <select
        key={type}
        name="reportGroup"
        className={inputCls}
        defaultValue={groups[0]}
        aria-label="P&L group"
      >
        {groups.map((g) => (
          <option key={g} value={g}>
            P&amp;L group: {REPORT_GROUP_LABELS[g]}
          </option>
        ))}
      </select>
    </>
  );
}
