"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type WOOption = { id: string; label: string };
type OpenEntry = { id: string; clockInAt: string; woLabel: string | null } | null;

function getCoords(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

export function TimeClockPanel({ open, workOrders }: { open: OpenEntry; workOrders: WOOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState("");

  async function punch(path: "clock-in" | "clock-out") {
    setBusy(true);
    setError(null);
    try {
      const coords = await getCoords();
      const body: Record<string, unknown> = coords ? { ...coords } : {};
      if (path === "clock-in") body.workOrderId = workOrderId || null;
      const res = await fetch(`/api/timeclock/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = data?.error ?? "Something went wrong.";
        if (typeof data?.distanceMeters === "number" && typeof data?.radiusMeters === "number") {
          msg += ` (You're ~${Math.round(data.distanceMeters)} m away; must be within ${data.radiusMeters} m.)`;
        }
        setError(msg);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-5 max-w-md">
      {open ? (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Clocked in</div>
            <div className="text-2xl font-mono text-green-400">
              since {new Date(open.clockInAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              {open.woLabel ? `Build: ${open.woLabel}` : "No build attached"}
            </div>
          </div>
          <button
            onClick={() => punch("clock-out")}
            disabled={busy}
            className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-50 text-black font-semibold rounded-md py-2.5 text-sm"
          >
            {busy ? "…" : "Clock out"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Build (optional)</label>
            <select
              value={workOrderId}
              onChange={(e) => setWorkOrderId(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="">— No specific build —</option>
              {workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => punch("clock-in")}
            disabled={busy}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-md py-2.5 text-sm"
          >
            {busy ? "Getting location…" : "Clock in"}
          </button>
          <p className="text-[11px] text-zinc-500">
            Clock-in requires location and must be on-site at the shop.
          </p>
        </div>
      )}
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
