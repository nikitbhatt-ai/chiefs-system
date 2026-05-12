"use client";

import { useMemo, useState } from "react";
import { createLeadAction } from "./actions";

type Lookup = { id: string; value: string; parentId: string | null };
type PartnerContact = { id: string; name: string; location: string | null };
type Partner = { id: string; name: string };
type SalesRep = { id: string; name: string | null; email: string | null };
type CustomerRef = { id: string; name: string };

const PIPELINES = [
  { slug: "government", label: "Government" },
  { slug: "walk_in_credentialed", label: "Walk-In Credentialed" },
  { slug: "commercial", label: "Commercial" },
];

// Canonical mapping of source name -> sub-source widget type. Sources not in
// this list fall through to the generic behavior (admin sub-source dropdown
// if any children exist, otherwise an optional text input).
type WidgetKind =
  | "users_sales"
  | "lookup_required"
  | "text_required"
  | "text_optional"
  | "customer_or_text"
  | "sames"
  | "default";
const SOURCE_WIDGETS: Record<string, WidgetKind> = {
  "Sales Call": "users_sales",
  "Trade Show": "lookup_required",
  "Social Media": "lookup_required",
  "Agency/RFP": "text_required",
  "Walk-In": "text_optional",
  "Email Inquiry": "text_optional",
  "Website/Web Form": "text_optional",
  "Repeat Customer": "customer_or_text",
  "Sales Reference": "text_required",
  Referral: "customer_or_text",
  "Sames Reference": "sames",
  Other: "text_required",
};

export function NewLeadForm({
  sources,
  subSources,
  samesPartner,
  samesContacts,
  salesReps,
  customers,
}: {
  sources: Lookup[];
  subSources: Lookup[];
  samesPartner: Partner | null;
  samesContacts: PartnerContact[];
  salesReps: SalesRep[];
  customers: CustomerRef[];
}) {
  const [source, setSource] = useState<string>("");
  const sourceRow = useMemo(() => sources.find((s) => s.value === source) ?? null, [sources, source]);
  const childSubSources = useMemo(
    () => (sourceRow ? subSources.filter((s) => s.parentId === sourceRow.id) : []),
    [subSources, sourceRow],
  );
  const widget: WidgetKind = SOURCE_WIDGETS[source] ?? "default";
  const inputCls =
    "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500";

  return (
    <form action={createLeadAction} className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input name="name" required placeholder="Lead name *" className={inputCls} />
      <select
        name="customerType"
        defaultValue=""
        required
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
      >
        <option value="" disabled>— Customer Type / pipeline * —</option>
        {PIPELINES.map((p) => (
          <option key={p.slug} value={p.slug}>{p.label}</option>
        ))}
      </select>
      <input name="email" type="email" placeholder="Email" className={inputCls} />
      <input name="phone" placeholder="Phone" className={inputCls} />
      <select
        name="source"
        required
        value={source}
        onChange={(e) => setSource(e.target.value)}
        className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
      >
        <option value="" disabled>— Source * —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.value}>{s.value}</option>
        ))}
      </select>

      {widget === "users_sales" && (
        <select
          name="subSource"
          required
          defaultValue=""
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
        >
          <option value="" disabled>— Sales rep who called *  —</option>
          {salesReps.map((r) => (
            <option key={r.id} value={r.name ?? r.email ?? r.id}>{r.name ?? r.email ?? r.id}</option>
          ))}
        </select>
      )}

      {widget === "lookup_required" && (
        childSubSources.length > 0 ? (
          <select
            name="subSource"
            required
            defaultValue=""
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
          >
            <option value="" disabled>— {source} detail * —</option>
            {childSubSources.map((s) => (
              <option key={s.id} value={s.value}>{s.value}</option>
            ))}
          </select>
        ) : (
          <div className="md:col-span-2 text-[11px] text-amber-300 font-body bg-amber-500/10 border border-amber-500/30 rounded p-2">
            No {source} options configured. Admin needs to add them under <a className="underline" href="/settings/lookups?category=sub_source">Settings → Lookups → Sub-sources</a> with parent set to <strong>{source}</strong>.
          </div>
        )
      )}

      {widget === "text_required" && (
        <input
          name="subSource"
          required
          placeholder={`${source} detail *`}
          className={`${inputCls} md:col-span-2`}
        />
      )}

      {widget === "text_optional" && (
        <input
          name="subSource"
          placeholder={`${source} detail (optional)`}
          className={`${inputCls} md:col-span-2`}
        />
      )}

      {widget === "customer_or_text" && (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            name="referralCustomerId"
            defaultValue=""
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Link to existing customer (optional) —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            name="subSource"
            placeholder={`${source} detail (free text)`}
            className={inputCls}
          />
        </div>
      )}

      {widget === "default" && childSubSources.length > 0 && (
        <select
          name="subSource"
          defaultValue=""
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
        >
          <option value="">— Sub-source —</option>
          {childSubSources.map((s) => (
            <option key={s.id} value={s.value}>{s.value}</option>
          ))}
        </select>
      )}
      {widget === "default" && childSubSources.length === 0 && source !== "" && (
        <input name="subSource" placeholder="Sub-source (optional)" className={`${inputCls} md:col-span-2`} />
      )}

      {widget === "sames" && (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 bg-black/30 border border-amber-500/30 rounded-md p-3">
          <div className="md:col-span-2 text-[11px] uppercase tracking-wider font-body text-amber-300">Sames Reference details (required)</div>
          {samesPartner ? (
            <input type="hidden" name="partnerId" value={samesPartner.id} />
          ) : (
            <div className="md:col-span-2 text-[11px] text-red-400 font-body">
              ⚠ No partner named &quot;Sames&quot; found. Create one in /partners first, then add salespeople as contacts.
            </div>
          )}
          <select
            name="samesSalespersonId"
            required
            defaultValue=""
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="" disabled>— Sames Salesperson * —</option>
            {samesContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.location ? ` · ${c.location}` : ""}
              </option>
            ))}
          </select>
          <input name="samesLocation" required placeholder="Sames Location *" className={inputCls} />
          <input name="samesReferralDate" type="date" required className={inputCls} />
          <input name="samesReferralNotes" placeholder="Referral notes" className={inputCls} />
        </div>
      )}

      <textarea name="notes" placeholder="General notes" rows={2} className={`${inputCls} md:col-span-2`} />
      <div className="md:col-span-2 flex justify-end">
        <button
          type="submit"
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
        >
          Save lead
        </button>
      </div>
    </form>
  );
}
