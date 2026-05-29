"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  VEHICLE_MODELS,
  LIGHT_PACKAGES,
  INTERIOR_OPTIONS,
  BODY_COLORS,
  AGENCY_TYPES,
  getModel,
  estimateTotal,
  type LightPackageSlug,
  type InteriorOptionSlug,
} from "@/lib/upfit/catalog";

const UpfitScene = dynamic(() => import("./three/UpfitScene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-zinc-500 font-body text-sm">
      Loading 3D builder…
    </div>
  ),
});

type SubmitState = "idle" | "sending" | "done" | "error";

export function UpfitBuilder({ mode = "embed" }: { mode?: "embed" | "internal" }) {
  const [modelSlug, setModelSlug] = useState(VEHICLE_MODELS[0].slug);
  const [bodyColor, setBodyColor] = useState(VEHICLE_MODELS[0].bodyColor);
  const [lightPackage, setLightPackage] = useState<LightPackageSlug>("lightbar");
  const [interior, setInterior] = useState<InteriorOptionSlug[]>(["partition", "console"]);
  const [cutaway, setCutaway] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>("idle");
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const model = useMemo(() => getModel(modelSlug)!, [modelSlug]);
  const selection = useMemo(
    () => ({ modelSlug, lightPackage, interiorOptions: interior, bodyColor }),
    [modelSlug, lightPackage, interior, bodyColor],
  );
  const total = useMemo(() => estimateTotal(selection), [selection]);

  function pickModel(slug: string) {
    setModelSlug(slug);
    const m = getModel(slug);
    if (m) setBodyColor(m.bodyColor);
  }

  function toggleInterior(slug: InteriorOptionSlug) {
    setInterior((cur) =>
      cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug],
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    // Honeypot — bots fill this; humans never see it.
    if (fd.get("company_website")) return;

    setSubmit("sending");
    setSubmitMsg(null);
    try {
      const res = await fetch("/api/upfit/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          phone: fd.get("phone"),
          agency: fd.get("agency"),
          agencyType: fd.get("agencyType"),
          quantity: fd.get("quantity"),
          notes: fd.get("notes"),
          honeypot: fd.get("company_website"),
          selection,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
      setSubmit("done");
    } catch (err) {
      setSubmit("error");
      setSubmitMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const rootClass =
    mode === "embed"
      ? "w-full h-[100dvh] min-h-[560px] flex flex-col bg-[#0b0d16] text-white font-body"
      : "w-full flex flex-col bg-[#0b0d16] text-white font-body rounded-xl overflow-hidden border border-white/10";

  return (
    <div className={rootClass}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/10 shrink-0">
        <div>
          <div className="font-display font-extrabold tracking-tight text-base sm:text-lg">
            Build Your Patrol Unit
          </div>
          <div className="text-[11px] uppercase tracking-widest text-amber-500/90">
            Chiefs Pursuit Surplus · 3D Upfit Builder
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
          <button
            type="button"
            onClick={() => setCutaway(false)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${!cutaway ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"}`}
          >
            Exterior
          </button>
          <button
            type="button"
            onClick={() => setCutaway(true)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${cutaway ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"}`}
          >
            Interior
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* 3D viewport */}
        <div className="relative flex-1 min-h-[320px] lg:min-h-0">
          <UpfitScene
            model={model}
            bodyColor={bodyColor}
            lightPackage={lightPackage}
            interiorOptions={interior}
            cutaway={cutaway}
          />
          {/* Mobile view toggle overlay */}
          <div className="sm:hidden absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-lg border border-white/10 bg-black/60 p-0.5 backdrop-blur">
            <button type="button" onClick={() => setCutaway(false)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${!cutaway ? "bg-amber-500 text-black" : "text-zinc-300"}`}>Exterior</button>
            <button type="button" onClick={() => setCutaway(true)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${cutaway ? "bg-amber-500 text-black" : "text-zinc-300"}`}>Interior</button>
          </div>
          <div className="absolute bottom-3 left-3 text-[10px] text-zinc-500 select-none">
            Drag to orbit · scroll to zoom
          </div>
          <div className="absolute bottom-3 right-3 text-right">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Est. upfit</div>
            <div className="font-display font-extrabold text-xl text-amber-400">
              ${total.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Config sidebar */}
        <div className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 overflow-y-auto max-h-[60vh] lg:max-h-none p-4 space-y-5">
          {/* Model */}
          <Section label="1 · Platform">
            <div className="grid grid-cols-1 gap-1.5">
              {VEHICLE_MODELS.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  onClick={() => pickModel(m.slug)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${modelSlug === m.slug ? "border-amber-500 bg-amber-500/10" : "border-white/10 hover:border-white/30"}`}
                >
                  <div className="text-sm font-semibold">{m.name}</div>
                  <div className="text-[11px] text-zinc-400 leading-snug">{m.blurb}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Color */}
          <Section label="2 · Color">
            <div className="flex flex-wrap gap-2">
              {BODY_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  onClick={() => setBodyColor(c.hex)}
                  className={`w-8 h-8 rounded-full border-2 transition ${bodyColor === c.hex ? "border-amber-500 scale-110" : "border-white/20"}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </Section>

          {/* Lighting */}
          <Section label="3 · Emergency Lighting">
            <div className="space-y-1.5">
              {LIGHT_PACKAGES.map((l) => (
                <button
                  key={l.slug}
                  type="button"
                  onClick={() => setLightPackage(l.slug)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${lightPackage === l.slug ? "border-amber-500 bg-amber-500/10" : "border-white/10 hover:border-white/30"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{l.name}</span>
                    <span className="text-[11px] text-amber-400">+${l.price.toLocaleString()}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 leading-snug">{l.blurb}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Interior */}
          <Section label="4 · Interior (view in Interior mode)">
            <div className="space-y-1.5">
              {INTERIOR_OPTIONS.map((o) => {
                const on = interior.includes(o.slug);
                return (
                  <button
                    key={o.slug}
                    type="button"
                    onClick={() => toggleInterior(o.slug)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${on ? "border-amber-500 bg-amber-500/10" : "border-white/10 hover:border-white/30"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold flex items-center gap-2">
                        <span className={`inline-block w-3.5 h-3.5 rounded border ${on ? "bg-amber-500 border-amber-500" : "border-white/40"}`} />
                        {o.name}
                      </span>
                      <span className="text-[11px] text-amber-400">+${o.price.toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 leading-snug pl-5.5">{o.blurb}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* CTA */}
          <div className="pt-1">
            {!showForm && submit !== "done" && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-display font-bold py-3 rounded-lg transition-colors"
              >
                {mode === "internal" ? "Save / Send to CRM →" : "Request a Quote →"}
              </button>
            )}

            {submit === "done" ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
                <div className="font-display font-bold text-emerald-300">Request received</div>
                <p className="text-xs text-zinc-300 mt-1">
                  Our team will reach out with a formal quote. Thank you.
                </p>
              </div>
            ) : showForm ? (
              <LeadForm
                onSubmit={handleSubmit}
                submit={submit}
                submitMsg={submitMsg}
                onCancel={() => setShowForm(false)}
                mode={mode}
              />
            ) : null}
          </div>

          <p className="text-[10px] text-zinc-600 leading-relaxed">
            3D renderings are representative. Final equipment placement and
            pricing are confirmed on your formal quote.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

function LeadForm({
  onSubmit,
  submit,
  submitMsg,
  onCancel,
  mode,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  submit: SubmitState;
  submitMsg: string | null;
  onCancel: () => void;
  mode: "embed" | "internal";
}) {
  const input =
    "w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none";
  return (
    <form onSubmit={onSubmit} className="space-y-2.5 rounded-lg border border-white/10 p-3 bg-black/20">
      {/* Honeypot */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <input name="name" required placeholder="Name *" className={input} />
      <input name="agency" placeholder="Agency / Department" className={input} />
      <select name="agencyType" defaultValue={AGENCY_TYPES[0].slug} className={input}>
        {AGENCY_TYPES.map((a) => (
          <option key={a.slug} value={a.slug} className="bg-zinc-900">
            {a.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2.5">
        <input name="email" type="email" required placeholder="Email *" className={input} />
        <input name="phone" placeholder="Phone" className={input} />
      </div>
      <input name="quantity" type="number" min={1} placeholder="How many vehicles?" className={input} />
      <textarea name="notes" rows={2} placeholder="Anything else we should know?" className={input} />

      {submit === "error" && submitMsg && (
        <p className="text-xs text-red-400">{submitMsg}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submit === "sending"}
          className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black font-display font-bold py-2.5 rounded-lg transition-colors"
        >
          {submit === "sending" ? "Sending…" : mode === "internal" ? "Save to CRM" : "Send Request"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 text-xs text-zinc-400 hover:text-white border border-white/10 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
