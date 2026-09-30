"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraScanner } from "@/components/CameraScanner";
import { beep, getScanCapture } from "@/components/scanCapture";
import { PartSearchCombobox, type PartHit } from "@/components/PartSearchCombobox";
import type { ScanHit } from "@/lib/scan";

// Header "Scan" button + dialog. Three ways in:
//   1. A USB/Bluetooth scanner in keyboard-wedge mode typing into the dialog's
//      box (the scanner "types" the code and presses Enter).
//   2. The same scanner fired on any page with no text box focused — detected
//      below as a burst of very fast keystrokes ending in Enter.
//   3. The phone/tablet camera (zxing, loaded only when the camera opens).
// While a page has claimed scans (see scanCapture — the PO receive panel),
// case 2 goes to that page instead of opening this dialog.
// One match → go straight to it. Several → pick. None → link the code to an
// existing part, or start a new part with the barcode prefilled.

type Phase =
  | { kind: "idle" }
  | { kind: "looking"; code: string }
  | { kind: "pick"; code: string; hits: ScanHit[] }
  | { kind: "notfound"; code: string }
  | { kind: "error"; message: string };

// Wedge scanners send each character a few ms apart; people type 80ms+ apart.
const WEDGE_MAX_GAP_MS = 50;
const WEDGE_MIN_LEN = 4;

const MATCH_LABEL: Record<ScanHit["matchedOn"], string> = {
  barcode: "barcode",
  sku: "SKU",
  mfg_part_number: "mfg part #",
  vin: "VIN",
  po_number: "PO #",
};

const TYPE_LABEL: Record<ScanHit["type"], string> = {
  part: "Part",
  vehicle: "Vehicle",
  purchase_order: "Purchase order",
};

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function ScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cameraOn, setCameraOn] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = useCallback(() => {
    setCameraOn(false);
    setOpen(false);
    setText("");
    setPhase({ kind: "idle" });
    setLinkErr(null);
  }, []);

  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const mine = ++seq.current;
      setText(code);
      setLinkErr(null);
      setPhase({ kind: "looking", code });
      try {
        const res = await fetch(`/api/scan?code=${encodeURIComponent(code)}`);
        if (mine !== seq.current) return;
        if (!res.ok) {
          beep(false);
          setPhase({ kind: "error", message: res.status === 401 ? "Signed out — sign in again." : "Lookup failed. Try again." });
          return;
        }
        const data = (await res.json()) as { code: string; hits: ScanHit[] };
        if (mine !== seq.current) return;
        if (data.hits.length === 1) {
          beep(true);
          close();
          router.push(data.hits[0].href);
        } else if (data.hits.length > 1) {
          beep(true);
          setPhase({ kind: "pick", code: data.code, hits: data.hits });
        } else {
          beep(false);
          setPhase({ kind: "notfound", code: data.code });
        }
      } catch {
        if (mine === seq.current) setPhase({ kind: "error", message: "Network error. Try again." });
      }
    },
    [close, router],
  );

  // Keep the latest lookup for the document-level listener without
  // re-binding it on every render.
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  // Wedge scanner fired with no text box focused (on any page, or in the
  // dialog after focus moved off its box). Scans into a focused box are left
  // alone — that box gets the characters as normal typing.
  useEffect(() => {
    let buf = "";
    let last = 0;
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) {
        buf = "";
        return;
      }
      const now = performance.now();
      if (now - last > WEDGE_MAX_GAP_MS) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= WEDGE_MIN_LEN) {
          e.preventDefault();
          const code = buf;
          buf = "";
          const capture = getScanCapture();
          if (capture) {
            capture(code);
          } else {
            setOpen(true);
            void lookupRef.current(code);
          }
        }
        buf = "";
        return;
      }
      if (e.key.length === 1) buf += e.key;
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  // Select (not just focus) so the next scan replaces the previous code
  // instead of being appended to it.
  useEffect(() => {
    if (open && !cameraOn && phase.kind !== "looking") inputRef.current?.select();
  }, [open, cameraOn, phase.kind]);

  async function linkToPart(p: PartHit, code: string) {
    setLinkBusy(true);
    setLinkErr(null);
    try {
      const res = await fetch(`/api/parts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLinkErr(data.error ?? "Couldn't save the barcode.");
        return;
      }
      beep(true);
      close();
      router.push(`/inventory/${p.id}`);
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors text-xs font-body"
        aria-label="Scan barcode"
        title="Scan a barcode (or just scan — works from any page)"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 5V3a1 1 0 011-1h2M11 2h2a1 1 0 011 1v2M14 11v2a1 1 0 01-1 1h-2M5 14H3a1 1 0 01-1-1v-2" strokeLinecap="round" />
          <path d="M5 5v6M7.5 5v6M10 5v6" strokeLinecap="round" />
        </svg>
        <span className="hidden md:inline">Scan</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 pt-16 sm:pt-24"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-lg shadow-xl p-4 space-y-3" role="dialog" aria-label="Scan barcode">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold text-white">Scan barcode</h3>
              <button type="button" onClick={close} className="text-zinc-500 hover:text-white text-xs font-body">
                Close
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void lookup(text);
              }}
              className="flex gap-2"
            >
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Scan now, or type a barcode / SKU / VIN / PO #"
                autoComplete="off"
                className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="submit"
                className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-2"
              >
                Find
              </button>
            </form>

            {cameraOn ? (
              <CameraScanner onCode={(c) => void lookup(c)} onStop={() => setCameraOn(false)} />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPhase({ kind: "idle" });
                  setCameraOn(true);
                }}
                className="w-full text-xs font-body text-zinc-300 hover:text-white border border-white/10 rounded-md px-3 py-2"
              >
                📷 Use camera
              </button>
            )}

            {phase.kind === "looking" ? (
              <p className="text-xs text-zinc-400 font-body">Looking up {phase.code}…</p>
            ) : null}

            {phase.kind === "error" ? <p className="text-xs text-red-400 font-body">{phase.message}</p> : null}

            {phase.kind === "pick" ? (
              <div className="space-y-1">
                <p className="text-[11px] text-zinc-400 font-body">
                  {phase.hits.length} matches for <span className="font-mono text-white">{phase.code}</span> — pick one:
                </p>
                <ul className="border border-white/10 rounded-md divide-y divide-white/5">
                  {phase.hits.map((h) => (
                    <li key={`${h.type}-${h.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          router.push(h.href);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-white/5"
                      >
                        <div className="text-xs text-white font-body">
                          {h.title}
                          {h.archived ? <span className="ml-1 text-[10px] text-zinc-500">(archived)</span> : null}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-body">
                          {TYPE_LABEL[h.type]} · matched {MATCH_LABEL[h.matchedOn]} · {h.subtitle}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {phase.kind === "notfound" ? (
              <div className="space-y-3 border border-amber-500/30 bg-amber-500/5 rounded-md p-3">
                <p className="text-xs text-white font-body">
                  Nothing matches <span className="font-mono">{phase.code}</span> yet.
                </p>
                <div className="space-y-1">
                  <p className="text-[11px] text-zinc-400 font-body">
                    Is it a part we already stock? Find it and this barcode will be saved to it:
                  </p>
                  <PartSearchCombobox
                    allowCreate={false}
                    placeholder="Search part by SKU or name…"
                    onPick={(p) => void linkToPart(p, phase.code)}
                  />
                  {linkBusy ? <p className="text-[11px] text-zinc-400 font-body">Saving…</p> : null}
                  {linkErr ? <p className="text-[11px] text-red-400 font-body">{linkErr}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-body">
                  <a
                    href={`/inventory?barcode=${encodeURIComponent(phase.code)}#add-part`}
                    className="text-amber-400 hover:text-amber-300 border border-white/10 rounded px-2 py-1"
                  >
                    ＋ Create new part with this barcode
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setText("");
                      setPhase({ kind: "idle" });
                    }}
                    className="text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-1"
                  >
                    Scan again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
