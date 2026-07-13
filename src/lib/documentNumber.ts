// 6-digit document number shared between a work order and the invoice
// that closes it out. Backed by a Postgres sequence
// `document_number_seq` that starts at 100000 (min 100000, so the
// number is always 6 digits from the very first WO).
//
// SQL to create the sequence (run once in Neon SQL Editor before any
// code path hits `nextDocumentNumber`):
//
//   CREATE SEQUENCE IF NOT EXISTS document_number_seq
//     START WITH 100000
//     MINVALUE 100000
//     INCREMENT BY 1
//     NO CYCLE;
//
// Assigning is idempotent per work order — call it at WO creation and
// stamp the returned integer into `work_orders.document_number`. When an
// invoice is later generated from that WO, the invoice reuses the same
// integer, giving the shop's build sheet and the customer's bill a
// single shared identifier.

import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function nextDocumentNumber(): Promise<number> {
  const rows = (await db.execute(sql`SELECT nextval('document_number_seq') AS n`)) as unknown as Array<{ n: string | number }>;
  const row = Array.isArray(rows) ? rows[0] : ((rows as { rows?: Array<{ n: string | number }> }).rows?.[0]);
  const raw = row?.n ?? 0;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n) || n < 100000) {
    throw new Error(`document_number_seq returned invalid value: ${raw}`);
  }
  return n;
}

// Human-readable rendering. Always 6 digits, zero-padded (though the
// sequence starts at 100000 so the padding is only defensive).
export function fmtDocumentNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Number(n)).padStart(6, "0");
}
