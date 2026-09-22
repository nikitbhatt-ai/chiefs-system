import { AppShell } from "@/components/AppShell";
import { ScanPullPanel } from "@/components/ScanPullPanel";

// Scan stock out WITHOUT a work order — shop use, damaged/scrapped, counter
// sale. Parts for a job are pulled from that work order's page instead, so
// they're charged to the job.
export default function PullFromStockPage() {
  return (
    <AppShell
      title="Pull from stock"
      subtitle="For parts leaving without a work order. Pulling parts for a job? Do it from that work order so it's charged to the job."
    >
      <ScanPullPanel />
    </AppShell>
  );
}
