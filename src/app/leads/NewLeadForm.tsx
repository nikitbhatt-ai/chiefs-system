"use client";

import { useMemo, useState } from "react";
import { createLeadAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Lookup = { id: string; value: string; parentId: string | null };
type PartnerContact = { id: string; name: string; location: string | null };
type Partner = { id: string; name: string };

const PIPELINES = [
  { slug: "government", label: "Government" },
  { slug: "walk_in_credentialed", label: "Walk-In Credentialed" },
  { slug: "commercial", label: "Commercial" },
];

export function NewLeadForm({
  sources,
  subSources,
  samesPartner,
  samesContacts,
}: {
  sources: Lookup[];
  subSources: Lookup[];
  samesPartner: Partner | null;
  samesContacts: PartnerContact[];
}) {
  const [source, setSource] = useState<string>("");
  const sourceRow = useMemo(() => sources.find((s) => s.value === source) ?? null, [sources, source]);
  const childSubSources = useMemo(
    () => (sourceRow ? subSources.filter((s) => s.parentId === sourceRow.id) : []),
    [subSources, sourceRow],
  );
  const isSames = source === "Sames Reference";
  const inputCls = "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500";

  return (
    <form action={createLeadAction} className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input name="name" required placeholder="Lead name *" className={inputCls} />
      <select name="customerType" defaultValue="" required className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
        <option value="" disabled>— Customer Type / pipeline * —</option>
        {PIPELINES.map((p) => (<option key={p.slug} value={p.slug}>{p.label}</option>))}
      </select>
      <input name="email" type="email" placeholder="Email" className={inputCls} />
      <input name="phone" placeholder="Phone" className={inputCls} />
      <select name="source" required value={source} onChange={(e) => setSource(e.target.value)} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2">
        <option value="" disabled>— Source * —</option>
        {sources.map((s) => (<option key={s.id} value={s.value}>{s.value}</option>))}
      </select>
      {!isSames && childSubSources.length > 0 && (
        <select name="subSource" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2">
          <option value="">— Sub-source —</option>
          {childSubSources.map((s) => (<option key={s.id} value={s.value}>{s.value}</option>))}
        </select>
      )}
      {!isSames && childSubSources.length === 0 && source !== "" && (
        <input name="subSource" placeholder="Sub-source (optional)" className={`${inputCls} md:col-span-2`} />
      )}
      {isSames && (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 bg-black/30 border border-amber-500/30 rounded-md p-3">
          <div className="md:col-span-2 text-[11px] uppercase tracking-wider font-body text-amber-300">Sames Reference details (required)</div>
          {samesPartner ? (<input type="hidden" name="partnerId" value={samesPartner.id} />) : (
            <div className="md:col-span-2 text-[11px] text-red-400 font-body">⚠ No partner named “Sames” found. Create one in /partners first, then add salespeople as contacts.</div>
          )}
          <select name="samesSalespersonId" required defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="" disabled>— Sames Salesperson * —</option>
            {samesContacts.map((c) => (<option key={c.id} value={c.id}>{c.name}{c.location ? ` · ${c.location}` : ""}</option>))}
          </select>
          <input name="samesLocation" required placeholder="Sames Location *" className={inputCls} />
          <input name="samesReferralDate" type="date" required className={inputCls} />
          <input name="samesReferralNotes" placeholder="Referral notes" className={inputCls} />
        </div>
      )}
      <textarea name="notes" placeholder="General notes" rows={2} className={`${inputCls} md:col-span-2`} />
      <div className="md:col-span-2 flex justify-end">
        <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">Save lead</SubmitButton>
      </div>
    </form>
  );
}
