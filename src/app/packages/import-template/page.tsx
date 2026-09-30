import { asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { ImportTemplateClient } from "./ImportTemplateClient";

export const dynamic = "force-dynamic";

export default async function ImportPackageTemplatePage() {
  const vendorRows = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(asc(vendors.name));
  // Default to a vendor named like "Whelen" when present.
  const defaultVendorId = vendorRows.find((v) => /whelen/i.test(v.name))?.id ?? vendorRows[0]?.id ?? "";
  return (
    <AppShell
      title="Import package template"
      subtitle="One sheet → a sellable package + à la carte costs + (if priced) an allocated vendor promo"
    >
      <ImportTemplateClient vendors={vendorRows} defaultVendorId={defaultVendorId} />
    </AppShell>
  );
}
