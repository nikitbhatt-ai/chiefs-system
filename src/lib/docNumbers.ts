// Document numbers: quotes/invoices, work orders, and purchase orders.
//
// ── One number per job ──────────────────────────────────────────────────────
// A quote, the invoice it becomes, and the work order that builds it are the
// SAME JOB, so they share one number and differ only by prefix:
//
//     Q-01938   the quote
//     Q-01938   the invoice (a converted quote IS the invoice — same row)
//     WO-01938  the work order for that job
//
// That is how the shop's previous system worked (Estimate #1938 and Work Order
// #1938 were one job), and it is what makes a job traceable across the three
// documents without a lookup. A work order raised with no quote behind it draws
// the next job number of its own.
//
// Purchase orders are NOT part of a job's identity — one PO can supply parts for
// several jobs, and a job can need several POs — so they run on their own
// series, six digits wide.
//
// ── Why sequences ───────────────────────────────────────────────────────────
// Numbers used to be `Q-${Date.now().slice(-7)}`. Two quotes created in the same
// millisecond got the same number, and `quote_number` carries a UNIQUE
// constraint, so the second insert failed. A clock slice is also not a count:
// `Q-6639059` says nothing about whether it came before `Q-1234567`, and it
// rolls over. Postgres sequences are atomic across concurrent serverless
// instances and they count.
//
// Padding is a MINIMUM, never a cap — past 99999 a job number simply becomes six
// digits rather than colliding or erroring. Running out is not a failure mode.

import { sql } from "drizzle-orm";
import { db } from "@/db";

/** A transaction or the base client — either can issue a number. */
type Db = Pick<typeof db, "execute">;

export const DOC_NUMBER_WIDTH = {
  quote: 5,
  /** Matches `quote` so a job's documents read as the same number. */
  workOrder: 5,
  purchaseOrder: 6,
} as const;

/**
 * Quotes and work orders deliberately share `job_number_seq`: taking from two
 * sequences would let quote #01940 and work order #01940 be different jobs,
 * which is exactly the confusion this is meant to end.
 */
const SEQUENCES = {
  quote: "job_number_seq",
  workOrder: "job_number_seq",
  purchaseOrder: "po_number_seq",
} as const;

const PREFIXES = {
  quote: "Q",
  workOrder: "WO",
  purchaseOrder: "PO",
} as const;

export type DocKind = keyof typeof SEQUENCES;

/**
 * Format a counter value the way a document number is displayed. Exported so
 * the renumbering SQL, the importer and the checks share one definition rather
 * than three that drift.
 */
export function formatDocNumber(kind: DocKind, n: number): string {
  return `${PREFIXES[kind]}-${String(n).padStart(DOC_NUMBER_WIDTH[kind], "0")}`;
}

/**
 * The next number for a document that starts its own job.
 *
 * `nextval` is safe under concurrency but is NOT rolled back: an aborted insert
 * burns a number. That is the right trade — a gap in the series is invisible to
 * a customer, whereas two documents sharing a number is a real problem.
 */
export async function nextDocNumber(kind: DocKind, tx: Db = db): Promise<string> {
  const seq = SEQUENCES[kind];
  const res = await tx.execute(sql`SELECT nextval(${seq}::regclass) AS n`);
  const row =
    (res as unknown as { rows?: { n: string | number }[] }).rows?.[0] ??
    (res as unknown as { n: string | number }[])[0];
  const n = Number(row?.n);
  if (!Number.isFinite(n)) {
    throw new Error(`Could not read ${seq}. Has docs/sql/doc_numbers.sql been run in Neon?`);
  }
  return formatDocNumber(kind, n);
}

/**
 * The work-order number for a job that already has a quote: the quote's own
 * number, re-prefixed. `Q-01938` → `WO-01938`.
 *
 * Falls back to a fresh job number when the quote has no number, or has one
 * this app did not issue (an imported record whose original number we keep
 * verbatim and cannot safely re-prefix).
 */
export async function workOrderNumberForQuote(
  quoteNumber: string | null | undefined,
  tx: Db = db,
): Promise<string> {
  const m = quoteNumber?.match(/^Q-(\d+)$/);
  if (m) return `${PREFIXES.workOrder}-${m[1]}`;
  return nextDocNumber("workOrder", tx);
}

/**
 * Strip a document number to its significant digits, for search.
 *
 * Someone holding paperwork from the old system types "1938"; the record may be
 * stored as `Q-01938`, as `WO-01938`, or — for an imported record — as whatever
 * string that system used. Comparing digits lets one search box find any of
 * them without the user knowing which era or document type it came from.
 */
export function docNumberDigits(input: string): string {
  return input.replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
}
