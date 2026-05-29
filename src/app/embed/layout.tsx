import type { Metadata } from "next";

// Standalone, chrome-free layout for embeddable widgets (iframed into the
// Shopify storefront). No AppShell, no auth UI — framing is allowed by the
// CSP frame-ancestors header configured in next.config.ts.
export const metadata: Metadata = {
  title: "Build Your Patrol Unit — Chiefs Pursuit Surplus",
  description: "Configure your police vehicle upfit in 3D and request a quote.",
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-[#0b0d16] min-h-screen overflow-hidden">{children}</div>;
}
