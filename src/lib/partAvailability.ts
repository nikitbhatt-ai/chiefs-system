// "Committed" stock for the Add Line Item picker: units of a part already
// promised on accepted estimates whose build hasn't used them yet.
//
// Under the current inventory policy nothing is reserved before a build hits
// In Progress (see src/lib/reservations.ts), so reservations alone would read
// 0 for everything a salesperson has sold but the shop hasn't started. This
// counts the demand directly from the estimates instead:
//   - estimate status approved (accepted / sales order) or converted, not archived
//   - its work order (if any) has not consumed parts yet
// Available = on hand − committed (can go negative: oversold).

import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function committedByPart(partIds: string[]): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();
  const rows = await db.execute<{ part_id: string; qty: string | number }>(sql`
    SELECT li->>'partId' AS part_id,
           COALESCE(SUM(NULLIF(li->>'quantity', '')::numeric), 0) AS qty
    FROM quotes q
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q.line_items, '[]'::jsonb)) AS li
    LEFT JOIN work_orders w ON w.quote_id = q.id
    WHERE q.status IN ('approved', 'converted')
      AND q.archived = false
      AND COALESCE(w.parts_consumed, false) = false
      AND li->>'kind' = 'item'
      AND li->>'partId' IN (${sql.join(
        partIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    GROUP BY li->>'partId'
  `);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  return new Map(
    (list as { part_id: string; qty: string | number }[]).map((r) => [r.part_id, Number(r.qty) || 0]),
  );
}
