"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

// Phone/tablet camera barcode reader (zxing — reads UPC/EAN, Code 128/39,
// QR, Data Matrix). The camera starts when this mounts and stops when it
// unmounts, so the parent just renders it while the camera should be on.
//   - single (default): reports the first code, then calls onStop.
//   - continuous: keeps reading (receiving a shipment box after box); the same
//     code is ignored for REPEAT_MS so one held-up label isn't counted 20×.
const REPEAT_MS = 1500;

export function CameraScanner({
  onCode,
  onStop,
  continuous = false,
}: {
  onCode: (code: string) => void;
  onStop: () => void;
  continuous?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Latest callbacks without restarting the camera when the parent re-renders.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    // `alive` guards a start still in flight (permission prompt, zxing
    // loading) when the user stops or navigates away before it resolves.
    let alive = true;
    let controls: IScannerControls | null = null;
    let lastCode = "";
    let lastAt = 0;

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setErr("Camera needs a secure (https) page and a browser with camera access.");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!alive || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const c = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (result) => {
            if (!result || !alive) return;
            const code = result.getText();
            const now = Date.now();
            if (code === lastCode && now - lastAt < REPEAT_MS) return;
            lastCode = code;
            lastAt = now;
            if (continuous) {
              setFlash(code);
              onCodeRef.current(code);
            } else {
              alive = false;
              controls?.stop();
              onCodeRef.current(code);
              onStopRef.current();
            }
          },
        );
        if (alive) controls = c;
        else c.stop();
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setErr(
          name === "NotAllowedError"
            ? "Camera permission was blocked. Allow camera access for this site in your browser settings, then try again."
            : name === "NotFoundError"
              ? "No camera found on this device."
              : "Couldn't start the camera.",
        );
      }
    })();

    return () => {
      alive = false;
      controls?.stop();
    };
  }, [continuous]);

  return (
    <div className="space-y-2">
      {err ? (
        <p className="text-[11px] text-red-400 font-body">{err}</p>
      ) : (
        <video ref={videoRef} className="w-full rounded-md bg-black aspect-video object-cover" playsInline muted autoPlay />
      )}
      <div className="flex items-center justify-between gap-2 text-[11px] font-body text-zinc-400">
        <span>
          {flash ? (
            <>
              Last read: <span className="font-mono text-white">{flash}</span>
            </>
          ) : (
            "Point the camera at the barcode and hold steady."
          )}
        </span>
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 text-zinc-300 hover:text-white border border-white/10 rounded px-2 py-0.5"
        >
          Stop camera
        </button>
      </div>
    </div>
  );
}
