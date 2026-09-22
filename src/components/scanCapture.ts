// Lets a page claim hardware-scanner input. The header ScanButton listens
// for keyboard-wedge scans on every page and normally opens its lookup
// dialog; while a page has registered a capture (the PO scan-receive panel),
// scans go to that page instead so receiving never navigates away mid-count.

type Capture = (code: string) => void;

let current: Capture | null = null;

export function setScanCapture(fn: Capture | null) {
  current = fn;
}

export function getScanCapture(): Capture | null {
  return current;
}

// Audible + haptic feedback so the warehouse knows a scan landed without
// looking at the screen: short high beep = good, low buzz = check the screen.
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1400 : 300;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => ctx.close();
  } catch {
    // no audio — fine
  }
  navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
}
