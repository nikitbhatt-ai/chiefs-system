import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { journalEntries, journalLines, glAccounts, departments } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents, postDraft, reverseJournalEntry } from "@/lib/accounting";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  draft: "text-zinc-300 bg-white/5",
  posted: "text-emerald-400 bg-emerald-500/10",
  void: "text-zinc-500 bg-white/5",
};

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const entry = await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, id) });
  if (!entry) notFound();

  const lines = await db
    .select({
      id: journalLines.id,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      memo: journalLines.memo,
      accountCode: glAccounts.code,
      accountName: glAccounts.name,
      departmentName: departments.name,
    })
    .from(journalLines)
    .leftJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .leftJoin(departments, eq(departments.id, journalLines.departmentId))
    .where(eq(journalLines.journalEntryId, id))
    .orderBy(asc(journalLines.createdAt));

  const totalDebit = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = lines.reduce((s, l) => s + l.creditCents, 0);

  async function postEntry() {
    "use server";
    await postDraft(id);
    revalidatePath(`/accounting/journal/${id}`);
    revalidatePath("/accounting/journal");
  }

  async function deleteDraft() {
    "use server";
    // Trigger blocks deleting posted entries; drafts delete cleanly (lines cascade).
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
    revalidatePath("/accounting/journal");
    redirect("/accounting/journal");
  }

  async function reverse() {
    "use server";
    const session = await auth();
    const created = await reverseJournalEntry(id, session?.user?.id ?? null);
    revalidatePath("/accounting/journal");
    redirect(`/accounting/journal/${created.id}`);
  }

  return (
    <AppShell title="Journal entry" subtitle={entry.memo ?? "(no memo)"}>
      <div className="flex items-center gap-3">
        <Link href="/accounting/journal" className="text-xs text-amber-400 hover:text-amber-300 font-body">
          ← Back to journal
        </Link>
        <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[entry.status]}`}>
          {entry.status}
        </span>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-body">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Entry date</div>
          <div className="text-white">{fmtDateTime(entry.entryDate)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Source</div>
          <div className="text-white capitalize">{entry.source}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Posted at</div>
          <div className="text-white">{entry.postedAt ? fmtDateTime(entry.postedAt) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Reverses</div>
          <div className="text-white">
            {entry.reversesEntryId ? (
              <Link href={`/accounting/journal/${entry.reversesEntryId}`} className="text-amber-400 hover:text-amber-300">
                original entry
              </Link>
            ) : "—"}
          </div>
        </div>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5">Memo</th>
              <th className="px-4 py-2.5 text-right">Debit</th>
              <th className="px-4 py-2.5 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/5">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-zinc-400">{l.accountCode}</span>{" "}
                  <span className="text-white">{l.accountName}</span>
                </td>
                <td className="px-4 py-2.5 text-xs">{l.departmentName ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-400">{l.memo ?? "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{l.debitCents ? fmtCents(l.debitCents) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{l.creditCents ? fmtCents(l.creditCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-body font-semibold text-white">
              <td className="px-4 py-2.5" colSpan={3}>Totals</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(totalDebit)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        {entry.status === "draft" && (
          <>
            <form action={deleteDraft}>
              <button type="submit" className="text-xs font-body text-zinc-400 hover:text-red-400 bg-white/5 border border-white/10 rounded-md px-4 py-2 transition-colors">
                Delete draft
              </button>
            </form>
            <form action={postEntry}>
              <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">
                Post entry
              </button>
            </form>
          </>
        )}
        {entry.status === "posted" && (
          <form action={reverse}>
            <button type="submit" className="text-xs font-body font-semibold text-zinc-200 bg-white/5 border border-white/10 rounded-md px-4 py-2 hover:bg-white/10 transition-colors">
              Reverse entry
            </button>
          </form>
        )}
      </div>

      {entry.status === "posted" && (
        <p className="text-[11px] text-zinc-500 font-body">
          Posted entries are locked. To correct a mistake, reverse this entry — that creates an offsetting entry and keeps the history intact.
        </p>
      )}
    </AppShell>
  );
}
