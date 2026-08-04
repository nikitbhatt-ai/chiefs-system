"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Vendor = { id: string; name: string };
type OpenBill = { id: string; vendorId: string; label: string };

const inputCls =
  "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 w-full";

const METHODS = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export function PaymentForm({
  vendors,
  openBills,
  fixedVendorId,
  fixedBillId,
}: {
  vendors: Vendor[];
  openBills: OpenBill[];
  fixedVendorId?: string;
  fixedBillId?: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [vendorId, setVendorId] = useState(fixedVendorId ?? "");
  const [billId, setBillId] = useState(fixedBillId ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = Boolean(fixedBillId);

  const billsForVendor = useMemo(
    () => openBills.filter((b) => !vendorId || b.vendorId === vendorId),
    [openBills, vendorId],
  );

  async function submit() {
    setError(null);
    if (!vendorId) {
      setError("Pick a vendor.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          billId: billId || null,
          amount,
          method,
          reference: reference || null,
          paymentDate,
          memo: memo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push("/accounting/payments");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Record a payment</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Vendor</label>
          <select
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setBillId("");
            }}
            disabled={locked}
            className={`${inputCls} disabled:opacity-60`}
          >
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Apply to bill</label>
          <select value={billId} onChange={(e) => setBillId(e.target.value)} disabled={locked} className={`${inputCls} disabled:opacity-60`}>
            <option value="">On account (no bill)</option>
            {billsForVendor.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Amount</label>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} text-right`} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Date</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Reference (check #, txn)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Memo (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Notes for this payment" className={inputCls} />
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !vendorId}
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Record payment
        </button>
      </div>
    </div>
  );
}
