import { AppShell } from "@/components/AppShell";
import { ImportClient } from "./ImportClient";

export default function ImportPackagesPage() {
  return (
    <AppShell title="Import packages" subtitle="CSV / Excel bulk import — parts link by SKU, so load inventory first">
      <ImportClient />
    </AppShell>
  );
}
