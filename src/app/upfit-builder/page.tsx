import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { upfitConfigs } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { UpfitBuilder } from "@/components/upfit/UpfitBuilder";
import { EmbedSnippet } from "@/components/upfit/EmbedSnippet";
import { getLightPackage, getInteriorOption } from "@/lib/upfit/catalog";

export const dynamic = "force-dynamic";

function embedBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "https://your-app.vercel.app";
}

export default async function UpfitBuilderPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const recent = await db
    .select()
    .from(upfitConfigs)
    .orderBy(desc(upfitConfigs.createdAt))
    .limit(25)
    .catch(() => []);

  const embedSrc = `${embedBaseUrl()}/embed/upfit-builder`;

  return (
    <AppShell
      title="Upfit Builder"
      subtitle="3D police-vehicle configurator · Shopify lead generator"
    >
      <div className="space-y-6">
        {/* The builder itself */}
        <div className="h-[640px]">
          <UpfitBuilder mode="internal" />
        </div>

        {/* Embed instructions */}
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <div>
            <h3 className="text-sm font-body font-semibold text-white">
              Embed on your Shopify homepage
            </h3>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              In Shopify admin → <strong>Online Store → Themes → Customize</strong>,
              add a <strong>Custom Liquid</strong> (or Custom HTML) section to your
              homepage and paste the snippet below. Submissions land in{" "}
              <strong>Leads</strong> (source <code>upfit_builder</code>) and notify
              the sales team. For framing to work, add your storefront domain to the{" "}
              <code>UPFIT_EMBED_ALLOWED_ORIGINS</code> env var on Vercel.
            </p>
          </div>
          <EmbedSnippet src={embedSrc} />
        </div>

        {/* Recent submissions */}
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
          <h3 className="text-sm font-body font-semibold text-white mb-3">
            Recent configurations ({recent.length})
          </h3>
          {recent.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              No builder submissions yet. They&apos;ll appear here as customers
              configure vehicles.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Contact</th>
                    <th className="py-2 pr-3 font-medium">Agency</th>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium">Lighting</th>
                    <th className="py-2 pr-3 font-medium">Interior</th>
                    <th className="py-2 pr-3 font-medium text-right">Est.</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => {
                    const interior = Array.isArray(c.interiorOptions)
                      ? (c.interiorOptions as string[])
                          .map((o) => getInteriorOption(o)?.name ?? o)
                          .join(", ")
                      : "—";
                    return (
                      <tr key={c.id} className="border-b border-white/5 text-zinc-300">
                        <td className="py-2 pr-3 whitespace-nowrap text-zinc-400">
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="text-white">{c.contactName ?? "—"}</div>
                          <div className="text-[10px] text-zinc-500">{c.contactEmail}</div>
                        </td>
                        <td className="py-2 pr-3">{c.agency ?? "—"}</td>
                        <td className="py-2 pr-3">{c.modelName}</td>
                        <td className="py-2 pr-3">
                          {c.lightPackage ? getLightPackage(c.lightPackage)?.name ?? c.lightPackage : "—"}
                        </td>
                        <td className="py-2 pr-3">{interior || "none"}</td>
                        <td className="py-2 pr-3 text-right text-amber-400">
                          {typeof c.estimateTotal === "number"
                            ? `$${c.estimateTotal.toLocaleString()}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
