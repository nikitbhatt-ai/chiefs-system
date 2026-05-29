import type { NextConfig } from "next";

// Origins allowed to iframe the /embed/* widgets (the 3D upfit builder hero).
// Comma/space-separated list in UPFIT_EMBED_ALLOWED_ORIGINS, e.g.
// "https://chiefspursuitsurplus.com https://www.chiefspursuitsurplus.com".
// We always allow *.myshopify.com so the storefront preview works out of the box.
function frameAncestors(): string {
  const configured = (process.env.UPFIT_EMBED_ALLOWED_ORIGINS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set(["'self'", "https://*.myshopify.com", ...configured]);
  return Array.from(allowed).join(" ");
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        // Permit the storefront to frame the embeddable builder. Everything
        // else keeps Next's defaults (which don't set X-Frame-Options).
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors()};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
