import { AppShell } from "@/components/AppShell";
import { ImportClient } from "./ImportClient";

export default function ImportInventoryPage() {
  return (
    <AppShell title="Import inventory" subtitle="CSV / Excel bulk import">
      <ImportClient />
    </AppShell>
  );
}
