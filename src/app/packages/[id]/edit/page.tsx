import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { sanitizeComponents } from "@/lib/packages";
import { PackageBuilder, type BuilderComponent } from "./PackageBuilder";

async function savePackage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const components = sanitizeComponents(JSON.parse(String(formData.get("components") ?? "[]")));
  // Optional sell-side bundle/deal price. Blank clears it (back to à la carte).
  const bundleRaw = String(formData.get("packagePrice") ?? "").trim();
  const bundleNum = bundleRaw === "" ? null : Number(bundleRaw);
  const packagePrice = bundleNum != null && Number.isFinite(bundleNum) && bundleNum > 0 ? bundleNum.toFixed(2) : null;
  // Optional default markup (the "vendor margin"). Blank clears it.
  const markupRaw = String(formData.get("markupPct") ?? "").trim();
  const markupNum = markupRaw === "" ? null : Number(markupRaw);
  const markupPct = markupNum != null && Number.isFinite(markupNum) && markupNum >= 0 ? markupNum.toFixed(2) : null;
  const pricingMode = String(formData.get("pricingMode") ?? "") === "margin" ? "margin" : "markup";
  await db
    .update(packages)
    .set({
      name,
      category: String(formData.get("category") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      components,
      packagePrice,
      markupPct,
      pricingMode,
      updatedAt: new Date(),
    })
    .where(eq(packages.id, id));
  revalidatePath("/packages");
  revalidatePath(`/packages/${id}/edit`);
}

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [pkg] = await db.select().from(packages).where(eq(packages.id, id));
  if (!pkg) notFound();

  const initial = (pkg.components ?? []) as BuilderComponent[];

  return (
    <AppShell title={pkg.name} subtitle="Edit package — parts, labor, and fees">
      <PackageBuilder
        id={pkg.id}
        name={pkg.name}
        category={pkg.category ?? ""}
        description={pkg.description ?? ""}
        packagePrice={pkg.packagePrice ?? ""}
        markupPct={pkg.markupPct ?? ""}
        pricingMode={pkg.pricingMode ?? ""}
        initialComponents={initial}
        action={savePackage}
      />
    </AppShell>
  );
}
