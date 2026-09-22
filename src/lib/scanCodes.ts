// Pure scan-code helpers (no DB) so client components — the PO scan-receive
// panel matches codes in the browser — can share them with src/lib/scan.ts.

// Scanners can append control characters (GS separators, stray CR/LF, tab
// suffix). Strip them and surrounding whitespace.
export function normalizeScan(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

// The same physical barcode can be read as different strings depending on
// the device: a UPC-A (12 digits) is often reported as EAN-13 with a leading
// 0 by phone cameras, and imported-vehicle VIN labels (Code 39) prefix the
// VIN with "I". Try each spelling.
export function scanCandidates(code: string): string[] {
  const out = new Set<string>([code]);
  if (/^\d{12}$/.test(code)) out.add(`0${code}`);
  if (/^0\d{12}$/.test(code)) out.add(code.slice(1));
  if (/^I[A-HJ-NPR-Z0-9]{17}$/i.test(code)) out.add(code.slice(1));
  return [...out];
}
