"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Account = { id: string; code: string; name: string };
type Department = { id: string; name: string };

type LineState = {
  accountId: string;
  debit: string;
  credit: string;
  departmentId: string;
  memo: string;
};

function blankLine(): LineState {
  return { accountId: "", debit: "", credit: "", departmentId: "", memo: "" };
}

/** Parse a dollar string to integer cents. Mirrors dollarsToCents on the server. */
function toCents(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const v = Number(cleaned);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const inputCls =
  "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 w-full";

export function JournalEntryForm({
  accounts,
  departments,
}: {
  accounts: Account[];
  departments: Department[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [entryDate, setEntryDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineState[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += toCents(l.debit);
      credit += toCents(l.credit);
    }
    return { debit, credit, balanced: debit === credit && debit > 0 };
  }, [lines]);

  function update(i: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit(asDraft: boolean) {
    setError(null);
    const payload = {
      entryDate,
      memo,
      asDraft,
      lines: lines
        .filter((l) => l.accountId && (toCents(l.debit) > 0 || toCents(l.credit) > 0))
        .map((l) => ({
          accountId: l.accountId,
          debitCents: toCents(l.debit),
          creditCents: toCents(l.credit),
          departmentId: l.departmentId || null,
          memo: l.memo || null,
        })),
    };
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push(`/accounting/journal/${data.id}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
        New journal entry
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Entry date</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Memo</label>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this entry for?" className={inputCls} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-2 py-1.5 min-w-[180px]">Account</th>
              <th className="px-2 py-1.5 min-w-[140px]">Department</th>
              <th className="px-2 py-1.5 w-28 text-right">Debit</th>
              <th className="px-2 py-1.5 w-28 text-right">Credit</th>
              <th className="px-2 py-1.5 min-w-[140px]">Line memo</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-1">
                  <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className={inputCls}>
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <select value={l.departmentId} onChange={(e) => update(i, { departmentId: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    placeholder="0.00"
                    className={`${inputCls} text-right`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    placeholder="0.00"
                    className={`${inputCls} text-right`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input value={l.memo} onChange={(e) => update(i, { memo: e.target.value })} placeholder="optional" className={inputCls} />
                </td>
                <td className="px-2 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    disabled={lines.length <= 2}
                    className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-500"
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-body">
              <td className="px-2 py-2 text-xs text-zinc-400" colSpan={2}>
                <button type="button" onClick={addLine} className="text-amber-400 hover:text-amber-300">+ Add line</button>
              </td>
              <td className="px-2 py-2 text-right text-white font-semibold">{fmtCents(totals.debit)}</td>
              <td className="px-2 py-2 text-right text-white font-semibold">{fmtCents(totals.credit)}</td>
              <td className="px-2 py-2" colSpan={2}>
                {totals.balanced ? (
                  <span className="text-[11px] text-emerald-400">Balanced ✓</span>
                ) : (
                  <span className="text-[11px] text-amber-400">
                    Out of balance by {fmtCents(Math.abs(totals.debit - totals.credit))}
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy}
          className="text-xs font-body font-semibold text-zinc-300 bg-white/5 border border-white/10 rounded-md px-4 py-2 hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={busy || !totals.balanced}
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Post entry
        </button>
      </div>
    </div>
  );
}
