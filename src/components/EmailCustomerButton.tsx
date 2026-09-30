"use client";

// "Email to Customer" — opens a small form pre-filled with the
// customer's email and a message, then sends the estimate PDF (plus the
// vehicle lighting layout, when there is one) via POST
// /api/quotes/[id]/email.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EmailCustomerButton({
  quoteId,
  quoteNumber,
  customerName,
  defaultTo,
  hasConfiguration,
  companyName,
}: {
  quoteId: string;
  quoteNumber: string;
  customerName: string | null;
  defaultTo: string;
  hasConfiguration: boolean;
  companyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`Estimate ${quoteNumber} from ${companyName}`);
  const [message, setMessage] = useState(
    [
      `Hello${customerName ? ` ${customerName}` : ""},`,
      "",
      `Attached is estimate ${quoteNumber}${hasConfiguration ? " and the vehicle lighting layout" : ""}.`,
      "Please review, then sign and return the estimate to approve the work.",
      "",
      "Thank you,",
      companyName,
    ].join("\n"),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the email.");
        return;
      }
      setSentTo((data.to as string[] | undefined)?.join(", ") ?? to);
      // Picks up the draft → sent status change.
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    setOpen(false);
    setError(null);
    setSentTo(null);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline">
        ✉ Email to Customer
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-customer-title"
          onClick={close}
        >
          <div
            className="w-full max-w-lg bg-surface border border-white/10 rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 id="email-customer-title" className="font-ui font-bold text-xl text-white">
                Email to Customer
              </h2>
              <button type="button" onClick={close} className="text-zinc-400 hover:text-white text-2xl leading-none" aria-label="Close">
                ×
              </button>
            </div>

            {sentTo ? (
              <div className="px-6 py-6 space-y-4">
                <p className="text-sm text-zinc-200">
                  Sent to <strong className="text-white">{sentTo}</strong>.
                </p>
                <button type="button" onClick={close} className="btn-cta w-full">
                  Done
                </button>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <label className="block">
                  <span className="label-caps">To</span>
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="customer@example.com"
                    className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white"
                  />
                  {!defaultTo ? (
                    <span className="block text-xs text-zinc-500 mt-1">
                      This customer has no email on file — type one in.
                    </span>
                  ) : null}
                </label>
                <label className="block">
                  <span className="label-caps">Subject</span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="label-caps">Message</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={7}
                    className="mt-1.5 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white"
                  />
                </label>
                <div className="text-xs text-zinc-400">
                  Attached: estimate PDF{hasConfiguration ? " + vehicle lighting layout PDF" : ""}.
                </div>
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
                <button type="button" onClick={send} disabled={sending || !to.trim()} className="btn-cta w-full">
                  {sending ? "Sending…" : "Send"}
                </button>
                <button type="button" onClick={close} className="btn-outline w-full">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
