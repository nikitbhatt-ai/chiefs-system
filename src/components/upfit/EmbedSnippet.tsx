"use client";

import { useState } from "react";

// Copyable iframe snippet for embedding the builder into the Shopify
// storefront (homepage hero via a Custom Liquid / HTML section).
export function EmbedSnippet({ src }: { src: string }) {
  const snippet = `<iframe
  src="${src}"
  title="Chiefs Pursuit Surplus — 3D Upfit Builder"
  style="width:100%;height:760px;border:0;display:block"
  loading="lazy"
  allow="fullscreen"
></iframe>`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; user can select manually */
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 text-[11px] bg-amber-500 hover:bg-amber-400 text-black font-semibold px-2.5 py-1 rounded"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre className="bg-black/60 border border-white/10 rounded-lg p-3 pr-16 text-[11px] text-zinc-300 overflow-x-auto whitespace-pre">
        {snippet}
      </pre>
    </div>
  );
}
