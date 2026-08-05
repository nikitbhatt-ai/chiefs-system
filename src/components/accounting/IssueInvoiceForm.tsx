"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Quote = { id: string; label: string };

const inputCls =
  "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white placeholder:text-zinc-500 w-full";

const TERMS: { value: string; label: string }[] = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_60", label: "Net 60" },
];

export function IssueInvoiceForm({ quotes }: { quotes: Quote[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [quoteId, setQuoteId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [terms, setTerms] = useState("net_30");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!quoteId) {
      setError("Pick a quote to invoice.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, invoiceDate, terms, memo: memo || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push(`/accounting/invoices/${data.id}`);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Issue an invoice</h3>

      {quotes.length === 0 ? (
        <p className="text-[11px] text-zinc-500 font-body">
          No quotes are ready to invoice. A quote must be <span className="text-zinc-300">approved</span> or
          {" "}
          <span className="text-zinc-300">converted</span>, have a customer, and a total over $0 — and not already be invoiced.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Quote</label>
              <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className={inputCls}>
                <option value="">Select a quote…</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Invoice date</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputCls} />
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
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Memo (optional)</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Notes for this invoice" className={inputCls} />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !quoteId}
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Issue invoice
            </button>
          </div>
        </>
      )}
    </div>
  );
}
