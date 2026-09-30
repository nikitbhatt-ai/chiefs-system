"use client";

// Lets buttons elsewhere on the estimate page (Email to Customer, PDF
// links, Configure Vehicle, the workflow strip) make sure the estimate
// editor's latest changes are saved before they act on the record.
// The editor registers its flush while mounted; with no editor on the
// page, flushing is a no-op.

let flusher: (() => Promise<boolean>) | null = null;

export function registerQuoteFlusher(fn: () => Promise<boolean>): () => void {
  flusher = fn;
  return () => {
    if (flusher === fn) flusher = null;
  };
}

// Resolves true when everything is saved. On failure, asks the user
// whether to continue anyway.
export async function flushQuoteEditor(): Promise<boolean> {
  if (!flusher) return true;
  const ok = await flusher();
  if (ok) return true;
  return window.confirm(
    "Your latest estimate changes haven't saved yet (connection problem?). Continue anyway?",
  );
}
