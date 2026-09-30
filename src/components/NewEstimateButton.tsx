"use client";

// "+ New Estimate" — a short pop-up (customer, their PO #, title) that
// creates the estimate and opens it. Everything else is filled in on the
// estimate page itself.

import { useState } from "react";
import { CustomerPicker, type PickerCustomer } from "@/components/CustomerPicker";

export function NewEstimateButton({
  customers,
  action,
}: {
  customers: PickerCustomer[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-cta">
        + New Estimate
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-estimate-title"
          onClick={() => !creating && setOpen(false)}
        >
          <form
            action={async (fd) => {
              setCreating(true);
              try {
                await action(fd);
              } finally {
                setCreating(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-surface border border-white/10 rounded-2xl overflow-visible"
          >
            <input type="hidden" name="customerId" value={customerId ?? ""} />
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <h2 id="new-estimate-title" className="font-ui font-bold text-2xl text-white">
                New Estimate
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-white text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <div className="label-caps mb-2">Customer</div>
                <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} autoFocus />
              </div>
              <label className="block">
                <span className="label-caps">Customer PO # (optional — can be added later)</span>
                <input
                  name="customerPo"
                  placeholder="Their purchase order number, printed on the estimate and the invoice"
                  className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500"
                />
              </label>
              <label className="block">
                <span className="label-caps">Title (optional)</span>
                <input
                  name="title"
                  placeholder="e.g. 2024 Tahoe PPV Upfit"
                  className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500"
                />
              </label>
              <button type="submit" disabled={creating} className="btn-cta w-full">
                {creating ? "Creating…" : "Create Estimate"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn-outline w-full">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
