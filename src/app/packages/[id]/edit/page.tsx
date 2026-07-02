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
  await db
    .update(packages)
    .set({
      name,
      category: String(formData.get("category") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      components,
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
        initialComponents={initial}
        action={savePackage}
      />
    </AppShell>
  );
}
