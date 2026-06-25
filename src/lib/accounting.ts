import { eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";

// ── Money: always integer cents internally, dollars only at the edges ─────────

/** Format integer cents as a USD string, e.g. 123456 → "$1,234.56". */
export function fmtCents(cents: number | null | undefined): string {
  const n = typeof cents === "number" ? cents : 0;
  return (n / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Plain dollar number (no symbol) for inputs/exports, e.g. 123456 → "1234.56". */
export function centsToDollars(cents: number | null | undefined): string {
  const n = typeof cents === "number" ? cents : 0;
  return (n / 100).toFixed(2);
}

/**
 * Parse a user-entered dollar amount into integer cents. Accepts "$1,234.56",
 * "1234.5", "1234", "". Returns 0 for blank/garbage. Rounds to the nearest cent
 * so floating-point dust never reaches the ledger.
 */
export function dollarsToCents(input: string | number | null | undefined): number {
  if (input == null) return 0;
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

// ── Posting ───────────────────────────────────────────────────────────────────

export type JournalLineInput = {
  accountId: string;
  /** Exactly one of debitCents / creditCents must be > 0. */
  debitCents?: number;
  creditCents?: number;
  departmentId?: string | null;
  workOrderId?: string | null;
  memo?: string | null;
};

export type PostJournalEntryInput = {
  entryDate?: Date;
  memo?: string | null;
  source?: "manual" | "ar" | "ap" | "system";
  createdBy?: string | null;
  lines: JournalLineInput[];
  /** When true, leave the entry as a draft instead of posting it. */
  asDraft?: boolean;
};

/** Thrown when an entry fails the balance/validity rules before it ever hits the DB. */
export class LedgerError extends Error {}

function validateLines(lines: JournalLineInput[]): { totalDebit: number; totalCredit: number } {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new LedgerError("A journal entry needs at least two lines.");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const [i, line] of lines.entries()) {
    if (!line.accountId) throw new LedgerError(`Line ${i + 1}: pick an account.`);
    const debit = Math.max(0, Math.round(line.debitCents ?? 0));
    const credit = Math.max(0, Math.round(line.creditCents ?? 0));
    if ((debit === 0) === (credit === 0)) {
      throw new LedgerError(`Line ${i + 1}: enter either a debit or a credit, not both and not zero.`);
    }
    totalDebit += debit;
    totalCredit += credit;
  }
  if (totalDebit !== totalCredit) {
    throw new LedgerError(
      `Entry is unbalanced: debits ${fmtCents(totalDebit)} ≠ credits ${fmtCents(totalCredit)}.`,
    );
  }
  return { totalDebit, totalCredit };
}

/**
 * Insert a journal entry and its lines atomically. App-side validation gives a
 * friendly error; the DB triggers (docs/sql/accounting_phase1.sql) are the real
 * guard and will reject anything that slips through. Posts the entry unless
 * `asDraft` is set.
 */
export async function postJournalEntry(input: PostJournalEntryInput) {
  const { totalDebit } = validateLines(input.lines);

  return db.transaction(async (tx) => {
    // Always insert as draft first so the lines exist before the balance
    // trigger runs on the draft → posted transition.
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        entryDate: input.entryDate ?? new Date(),
        memo: input.memo ?? null,
        source: input.source ?? "manual",
        status: "draft",
        createdBy: input.createdBy ?? null,
      })
      .returning();

    await tx.insert(journalLines).values(
      input.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debitCents: Math.max(0, Math.round(l.debitCents ?? 0)),
        creditCents: Math.max(0, Math.round(l.creditCents ?? 0)),
        departmentId: l.departmentId ?? null,
        workOrderId: l.workOrderId ?? null,
        memo: l.memo ?? null,
      })),
    );

    if (!input.asDraft) {
      const [posted] = await tx
        .update(journalEntries)
        .set({ status: "posted" })
        .where(eq(journalEntries.id, entry.id))
        .returning();
      return { ...posted, totalCents: totalDebit };
    }
    return { ...entry, totalCents: totalDebit };
  });
}

/** Post an existing draft entry (draft → posted). The DB trigger enforces balance. */
export async function postDraft(entryId: string) {
  const [posted] = await db
    .update(journalEntries)
    .set({ status: "posted" })
    .where(eq(journalEntries.id, entryId))
    .returning();
  return posted;
}

/**
 * Reverse a posted entry by creating a new posted entry with debits and credits
 * swapped (rule #3: never edit history — reverse it). Returns the new entry.
 */
export async function reverseJournalEntry(entryId: string, createdBy?: string | null) {
  const original = await db.query.journalEntries.findFirst({
    where: eq(journalEntries.id, entryId),
  });
  if (!original) throw new LedgerError("Entry not found.");
  if (original.status !== "posted") throw new LedgerError("Only posted entries can be reversed.");

  const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entryId));

  return db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        entryDate: new Date(),
        memo: `Reversal of ${original.id}${original.memo ? ` — ${original.memo}` : ""}`,
        source: original.source,
        status: "draft",
        reversesEntryId: original.id,
        createdBy: createdBy ?? null,
      })
      .returning();

    await tx.insert(journalLines).values(
      lines.map((l) => ({
        journalEntryId: reversal.id,
        accountId: l.accountId,
        debitCents: l.creditCents, // swap
        creditCents: l.debitCents, // swap
        departmentId: l.departmentId,
        workOrderId: l.workOrderId,
        memo: l.memo,
      })),
    );

    const [posted] = await tx
      .update(journalEntries)
      .set({ status: "posted" })
      .where(eq(journalEntries.id, reversal.id))
      .returning();
    return posted;
  });
}
