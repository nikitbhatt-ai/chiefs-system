// QC checklist service. One checklist per work order (qc_checklists row).
// Seeded from a standard template the first time a build's checklist is
// opened. Build-close is gated on every item passing — see qcComplete, which
// the workflow stage transitions consult before allowing a move into
// "completed" / "delivered".

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { qcChecklists, type QCItem } from "@/db/schema";

// Standard upfit QC template. New checklists start from this list with every
// item failing (passed=false) until a tech signs off.
export const DEFAULT_QC_ITEMS: string[] = [
  "All wiring secured, loomed, and fused to spec",
  "Emergency lighting tested — front, rear, and sides",
  "Siren and PA tested",
  "Equipment mounted per build sheet",
  "Battery and charging system verified under load",
  "No dash warning lights or stored DTCs",
  "Interior reassembled and cleaned",
  "Customer-specific options verified against the build sheet",
  "Road test completed",
];

function seedItems(): QCItem[] {
  return DEFAULT_QC_ITEMS.map((label) => ({ label, passed: false }));
}

// The work order's checklist, creating it from the template on first access.
export async function getOrCreateChecklist(workOrderId: string) {
  const [existing] = await db
    .select()
    .from(qcChecklists)
    .where(eq(qcChecklists.workOrderId, workOrderId))
    .orderBy(desc(qcChecklists.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(qcChecklists)
    .values({ workOrderId, items: seedItems() })
    .returning();
  return created;
}

// True only when a checklist exists and every item has passed. Used as the
// build-close gate; a work order with no checklist yet is NOT complete.
export async function qcComplete(workOrderId: string): Promise<boolean> {
  const [row] = await db
    .select({ items: qcChecklists.items })
    .from(qcChecklists)
    .where(eq(qcChecklists.workOrderId, workOrderId))
    .orderBy(desc(qcChecklists.createdAt))
    .limit(1);
  const items = (row?.items as QCItem[] | null) ?? [];
  return items.length > 0 && items.every((i) => i.passed);
}

// Persist a new set of pass/fail states. Stamps completedAt/completedBy when
// the whole list passes, and clears them if it regresses.
export async function setChecklistItems(
  workOrderId: string,
  items: QCItem[],
  userId: string | null,
) {
  const allPassed = items.length > 0 && items.every((i) => i.passed);
  const [existing] = await db
    .select({ id: qcChecklists.id })
    .from(qcChecklists)
    .where(eq(qcChecklists.workOrderId, workOrderId))
    .orderBy(desc(qcChecklists.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(qcChecklists)
      .set({
        items,
        completedAt: allPassed ? new Date() : null,
        completedBy: allPassed ? userId : null,
        updatedAt: new Date(),
      })
      .where(eq(qcChecklists.id, existing.id));
  } else {
    await db.insert(qcChecklists).values({
      workOrderId,
      items,
      completedAt: allPassed ? new Date() : null,
      completedBy: allPassed ? userId : null,
    });
  }
}
