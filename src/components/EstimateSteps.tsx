"use client";

// The estimate's 4-step strip (Estimate → Sales Order → Work Order →
// Invoice) plus a "what's next" banner with the one or two buttons that
// move it forward. Every button saves pending editor changes first.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { flushQuoteEditor } from "@/lib/quoteFlush";
import { EmailCustomerButton } from "@/components/EmailCustomerButton";

export type EstimateStep = "estimate" | "sales_order" | "work_order" | "invoice";

const STEPS: { key: EstimateStep; label: string }[] = [
  { key: "estimate", label: "Estimate" },
  { key: "sales_order", label: "Sales Order" },
  { key: "work_order", label: "Work Order" },
  { key: "invoice", label: "Invoice" },
];

export function EstimateSteps({
  quoteId,
  quoteNumber,
  status,
  step,
  workOrder,
  invoice,
  email,
  setStatusAction,
}: {
  quoteId: string;
  quoteNumber: string;
  status: string;
  step: EstimateStep;
  workOrder: { id: string; number: string | null; status: string } | null;
  invoice: { id: string; number: string | null } | null;
  email: {
    customerName: string | null;
    defaultTo: string;
    hasConfiguration: boolean;
    companyName: string;
  };
  setStatusAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentIdx = STEPS.findIndex((s) => s.key === step);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      if (!(await flushQuoteEditor())) return;
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (next: string) =>
    run(next, async () => {
      const fd = new FormData();
      fd.set("id", quoteId);
      fd.set("status", next);
      await setStatusAction(fd);
    });

  const createWorkOrder = () =>
    run("wo", async () => {
      const res = await fetch(`/api/quotes/${quoteId}/workflow-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "confirmed" }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't create the work order.");
      }
    });

  const createInvoice = () =>
    run("inv", async () => {
      if (!workOrder) return;
      const res = await fetch(`/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: workOrder.id }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !b.id) throw new Error(b.error === "already_invoiced" ? "This job is already invoiced." : "Couldn't create the invoice.");
      window.location.href = `/invoices/${b.id}`;
    });

  const emailButton = (
    <EmailCustomerButton
      quoteId={quoteId}
      quoteNumber={quoteNumber}
      customerName={email.customerName}
      defaultTo={email.defaultTo}
      hasConfiguration={email.hasConfiguration}
      companyName={email.companyName}
    />
  );

  const buildDone = workOrder && ["completed", "delivered"].includes(workOrder.status);
  let banner: { title: string; text: string; actions: React.ReactNode };
  if (step === "estimate") {
    banner =
      status === "sent"
        ? {
            title: "Sent to the customer",
            text: "Waiting on their signed approval. Mark it accepted when the signed estimate comes back.",
            actions: (
              <>
                {emailButton}
                <button type="button" onClick={() => setStatus("approved")} disabled={!!busy} className="btn-cta">
                  {busy === "approved" ? "Saving…" : "Mark Accepted"}
                </button>
              </>
            ),
          }
        : {
            title: "Estimate is a draft",
            text: "Add the parts, lay out the lights, then mark it accepted once the customer returns the signed PDF.",
            actions: (
              <>
                {emailButton}
                <button type="button" onClick={() => setStatus("approved")} disabled={!!busy} className="btn-cta">
                  {busy === "approved" ? "Saving…" : "Mark Accepted"}
                </button>
              </>
            ),
          };
  } else if (step === "sales_order") {
    banner = {
      title: "Accepted — this is now a sales order",
      text: "Order any parts you need, then create the work order when the shop is ready to schedule it.",
      actions: (
        <>
          <button type="button" onClick={() => setStatus("sent")} disabled={!!busy} className="btn-outline">
            {busy === "sent" ? "Saving…" : "Undo accept"}
          </button>
          <button type="button" onClick={createWorkOrder} disabled={!!busy} className="btn-cta">
            {busy === "wo" ? "Creating…" : "Create Work Order"}
          </button>
        </>
      ),
    };
  } else if (step === "work_order") {
    banner = {
      title: `In the shop${workOrder?.number ? ` — ${workOrder.number}` : ""}`,
      text: buildDone
        ? "The build is finished. Create the invoice to bill the customer."
        : `Shop stage: ${workOrder?.status.replace(/_/g, " ") ?? "—"}. Invoice once the build passes QC.`,
      actions: (
        <>
          {workOrder ? (
            <a href={`/work-orders/${workOrder.id}`} className="btn-outline">
              Open Work Order
            </a>
          ) : null}
          {buildDone ? (
            <button type="button" onClick={createInvoice} disabled={!!busy} className="btn-cta">
              {busy === "inv" ? "Creating…" : "Create Invoice"}
            </button>
          ) : null}
        </>
      ),
    };
  } else {
    banner = {
      title: `Invoiced${invoice?.number ? ` — ${invoice.number}` : ""}`,
      text: "This job has been billed. Payments are tracked on the invoice.",
      actions: invoice ? (
        <a href={`/invoices/${invoice.id}`} className="btn-cta">
          Open Invoice
        </a>
      ) : null,
    };
  }

  return (
    <div className="space-y-4">
      <ol className="bg-surface border border-white/10 rounded-2xl px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isDone = i < currentIdx;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={`font-ui font-bold uppercase tracking-[0.12em] text-sm rounded-lg px-3 py-2 ${
                  isCurrent
                    ? "text-[var(--color-cta)] bg-[color-mix(in_srgb,var(--color-cta)_12%,transparent)]"
                    : isDone
                      ? "text-zinc-300"
                      : "text-zinc-500"
                }`}
              >
                {isDone ? "✓" : i + 1} {s.label}
              </span>
              {i < STEPS.length - 1 ? <span className="text-zinc-600" aria-hidden>→</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-cta)_60%,transparent)] bg-surface px-5 sm:px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-ui font-bold text-xl text-[var(--color-cta)]">{banner.title}</div>
          <p className="text-sm text-zinc-300 mt-1">{banner.text}</p>
          {error ? <p className="text-sm text-red-400 mt-2">{error}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">{banner.actions}</div>
      </div>
    </div>
  );
}
