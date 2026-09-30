// 4-digit job number shared across the whole lifecycle of one job:
// the quote (estimate) that starts it, the work order the techs build
// from, and the invoice that bills the customer all carry the SAME
// number. Backed by a Postgres sequence `document_number_seq` that
// starts at 1000 (min 1000, so the number is always 4 digits).
//
// SQL to create the sequence (run once in Neon SQL Editor before any
// code path hits `nextDocumentNumber`):
//
//   CREATE SEQUENCE IF NOT EXISTS document_number_seq
//     START WITH 1000
//     MINVALUE 1000
//     INCREMENT BY 1
//     NO CYCLE;
//
// The quote owns the number: it's assigned at quote creation and stamped
// into `quotes.document_number`. When a work order is created from that
// quote, and later an invoice from that work order, both reuse the same
// integer, giving the estimate, the shop's build sheet, and the
// customer's bill a single shared identifier.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";

// Any Drizzle executor — the base `db` or a transaction handle `tx`.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export async function nextDocumentNumber(): Promise<number> {
  const rows = (await db.execute(sql`SELECT nextval('document_number_seq') AS n`)) as unknown as Array<{ n: string | number }>;
  const row = Array.isArray(rows) ? rows[0] : ((rows as { rows?: Array<{ n: string | number }> }).rows?.[0]);
  const raw = row?.n ?? 0;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n) || n < 1000) {
    throw new Error(`document_number_seq returned invalid value: ${raw}`);
  }
  return n;
}

// Return the shared job number for a quote, assigning + persisting one if
// the quote doesn't have it yet (new quotes always do; this also backfills
// any quote created before the column existed). This is the single source
// of the number that the work order and invoice inherit.
export async function documentNumberForQuote(
  quoteId: string,
  executor: Executor = db,
): Promise<number> {
  const [q] = await executor
    .select({ documentNumber: quotes.documentNumber })
    .from(quotes)
    .where(eq(quotes.id, quoteId));
  if (q?.documentNumber != null) return q.documentNumber;
  const n = await nextDocumentNumber();
  await executor
    .update(quotes)
    .set({ documentNumber: n, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));
  return n;
}

// Human-readable rendering. Always 4 digits, zero-padded (the sequence
// starts at 1000 so the padding is only defensive).
export function fmtDocumentNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Number(n)).padStart(4, "0");
}
