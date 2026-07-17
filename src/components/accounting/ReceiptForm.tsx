"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Customer = { id: string; name: string };
type OpenInvoice = { id: string; customerId: string | null; label: string };

const inputCls =
  "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 w-full";

const METHODS: { value: string; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "other", label: "Other" },
];

export function ReceiptForm({
  customers,
  openInvoices,
  fixedCustomerId,
  fixedInvoiceId,
}: {
  customers: Customer[];
  openInvoices: OpenInvoice[];
  fixedCustomerId?: string;
  fixedInvoiceId?: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState(fixedCustomerId ?? "");
  const [invoiceId, setInvoiceId] = useState(fixedInvoiceId ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [receiptDate, setReceiptDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = Boolean(fixedInvoiceId);

  // Invoices selectable for the chosen customer (open ones only).
  const invoicesForCustomer = useMemo(
    () => openInvoices.filter((i) => !customerId || i.customerId === customerId),
    [openInvoices, customerId],
  );

  async function submit() {
    setError(null);
    if (!customerId) {
      setError("Pick a customer.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          invoiceId: invoiceId || null,
          amount,
          method,
          reference: reference || null,
          receiptDate,
          memo: memo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push("/accounting/receipts");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Record a receipt</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Customer</label>
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setInvoiceId(""); // reset invoice when customer changes
            }}
            disabled={locked}
            className={`${inputCls} disabled:opacity-60`}
          >
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Apply to invoice</label>
          <select
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            disabled={locked}
            className={`${inputCls} disabled:opacity-60`}
          >
            <option value="">On account (no invoice)</option>
            {invoicesForCustomer.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Amount</label>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`${inputCls} text-right`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Date</label>
          <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className={inputCls} />
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
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Notes for this receipt" className={inputCls} />
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !customerId}
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Record receipt
        </button>
      </div>
    </div>
  );
}
