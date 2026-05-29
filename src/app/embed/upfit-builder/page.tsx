import { UpfitBuilder } from "@/components/upfit/UpfitBuilder";

// Public, iframe-embeddable 3D upfit builder used as the Shopify homepage
// hero. No auth (allowlisted in auth.config.ts). Framing permitted via the
// `/embed/:path*` CSP header in next.config.ts.
export const dynamic = "force-static";

export default function EmbedUpfitBuilderPage() {
  return <UpfitBuilder mode="embed" />;
}
