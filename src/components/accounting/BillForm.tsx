"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type Department = { id: string; name: string };
type ReceivedPo = { id: string; poNumber: string | null; vendorId: string | null; receivedCents: number };

type LineState = { accountId: string; description: string; departmentId: string; amount: string };

function blankLine(): LineState {
  return { accountId: "", description: "", departmentId: "", amount: "" };
}

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

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_60", label: "Net 60" },
];

export function BillForm({
  vendors,
  accounts,
  departments,
  purchaseOrders,
}: {
  vendors: Vendor[];
  accounts: Account[];
  departments: Department[];
  /** POs with goods received — the only ones carrying an accrual to relieve. */
  purchaseOrders: ReceivedPo[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [vendorId, setVendorId] = useState("");
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [terms, setTerms] = useState("net_30");
  const [memo, setMemo] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [lines, setLines] = useState<LineState[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => lines.reduce((s, l) => s + toCents(l.amount), 0), [lines]);
  // Only POs for the chosen vendor can be settled by this bill.
  const posForVendor = useMemo(
    () => purchaseOrders.filter((p) => !vendorId || p.vendorId === vendorId),
    [purchaseOrders, vendorId],
  );
  const againstPo = Boolean(purchaseOrderId);
  const selectedPo = purchaseOrders.find((p) => p.id === purchaseOrderId) ?? null;
  // A PO bill posts to Accrued Purchases (plus variance) regardless of what the
  // line accounts say, so it needs an amount but no account choice.
  const valid = Boolean(
    vendorId && total > 0 && (againstPo || lines.some((l) => l.accountId && toCents(l.amount) > 0)),
  );
  // Billing more than was received is legal but lands in Purchase Price Variance
  // — warn before it is posted rather than after.
  const overBillCents = selectedPo ? Math.max(0, total - selectedPo.receivedCents) : 0;

  function update(i: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit() {
    setError(null);
    if (!valid) {
      setError("Pick a vendor and at least one line with an account and amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          vendorInvoiceNumber: vendorInvoiceNumber || null,
          purchaseOrderId: purchaseOrderId || null,
          billDate,
          terms,
          memo: memo || null,
          lines: lines
            .filter((l) => (againstPo || l.accountId) && toCents(l.amount) > 0)
            .map((l) => ({
              // For a PO bill the server overrides this with Accrued Purchases
              // (2050); a placeholder keeps the shared line validation happy.
              accountId: againstPo ? (accounts[0]?.id ?? "") : l.accountId,
              amountCents: toCents(l.amount),
              description: l.description || null,
              departmentId: againstPo ? null : l.departmentId || null,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push(`/accounting/bills/${data.id}`);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Enter a bill</h3>

      {vendors.length === 0 ? (
        <p className="text-[11px] text-zinc-500 font-body">No vendors yet — add one under Vendors first.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Vendor</label>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputCls}>
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Vendor invoice #</label>
              <input value={vendorInvoiceNumber} onChange={(e) => setVendorInvoiceNumber(e.target.value)} placeholder="optional" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Bill date</label>
              <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Terms</label>
              <select value={terms} onChange={(e) => setTerms(e.target.value)} className={inputCls}>
                {TERMS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">
                Against purchase order
              </label>
              <select
                value={purchaseOrderId}
                onChange={(e) => setPurchaseOrderId(e.target.value)}
                className={inputCls}
              >
                <option value="">Not against a PO (rent, software, sublet…)</option>
                {posForVendor.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber ?? p.id.slice(0, 8)} · {fmtCents(p.receivedCents)} received
                  </option>
                ))}
              </select>
              {vendorId && posForVendor.length === 0 && (
                <p className="mt-1 text-[10px] text-zinc-500 font-body">
                  No received POs for this vendor. Receive the shipment first, then bill it.
                </p>
              )}
            </div>
            {againstPo && (
              <div className="text-[11px] font-body text-zinc-400 md:pt-5">
                Posts <span className="text-zinc-200">Dr Accrued Purchases</span> /{" "}
                <span className="text-zinc-200">Cr Accounts Payable</span> — the goods are already in
                Inventory from receiving, so this settles that accrual instead of expensing it again.
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                  {!againstPo && <th className="px-2 py-1.5 min-w-[180px]">Account</th>}
                  <th className="px-2 py-1.5 min-w-[160px]">Description</th>
                  {!againstPo && <th className="px-2 py-1.5 min-w-[140px]">Department</th>}
                  <th className="px-2 py-1.5 w-28 text-right">Amount</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    {!againstPo && (
                      <td className="px-2 py-1">
                        <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className={inputCls}>
                          <option value="">Select account…</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-2 py-1">
                      <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="optional" className={inputCls} />
                    </td>
                    {!againstPo && (
                      <td className="px-2 py-1">
                        <select value={l.departmentId} onChange={(e) => update(i, { departmentId: e.target.value })} className={inputCls}>
                          <option value="">—</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-2 py-1">
                      <input inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder="0.00" className={`${inputCls} text-right`} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={lines.length <= 1}
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
                  <td className="px-2 py-2 text-xs" colSpan={againstPo ? 1 : 2}>
                    <button type="button" onClick={addLine} className="text-amber-400 hover:text-amber-300">+ Add line</button>
                  </td>
                  <td className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-zinc-500">Total</td>
                  <td className="px-2 py-2 text-right text-white font-semibold">{fmtCents(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Memo (optional)</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Notes for this bill" className={inputCls} />
          </div>

          {overBillCents > 0 && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 font-body">
              <span className="font-semibold">{fmtCents(overBillCents)} over the received value.</span>{" "}
              This vendor is billing more than arrived on{" "}
              {selectedPo?.poNumber ?? "this PO"} ({fmtCents(selectedPo?.receivedCents ?? 0)} received). The
              difference will post to Purchase Price Variance so it stays visible — check the invoice before
              posting.
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !valid}
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Post bill
            </button>
          </div>
        </>
      )}
    </div>
  );
}
