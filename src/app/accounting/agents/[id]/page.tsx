import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { agentDrafts, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import { approveDraft, rejectDraft, saveDraftEdit } from "@/lib/agents";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  approved: "text-emerald-400 bg-emerald-500/10",
  rejected: "text-zinc-500 bg-white/5",
};
const KIND_LABEL: Record<string, string> = { ar_reminder: "AR reminder email", ap_schedule: "AP payment plan" };

export default async function AgentDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await db.query.agentDrafts.findFirst({ where: eq(agentDrafts.id, id) });
  if (!draft) notFound();

  const reviewer = draft.reviewedBy
    ? await db.query.users.findFirst({ where: eq(users.id, draft.reviewedBy) })
    : null;

  const current = draft.editedContent ?? draft.content;

  async function saveEdits(formData: FormData) {
    "use server";
    await saveDraftEdit(id, String(formData.get("content") ?? ""));
    revalidatePath(`/accounting/agents/${id}`);
  }
  async function approve(formData: FormData) {
    "use server";
    const session = await auth();
    // Persist any edits in the textarea alongside the approval.
    const edited = String(formData.get("content") ?? "");
    if (edited && edited !== draft!.content) await saveDraftEdit(id, edited);
    await approveDraft(id, session?.user?.id ?? null, String(formData.get("note") ?? "") || null);
    revalidatePath(`/accounting/agents/${id}`);
    redirect("/accounting/agents");
  }
  async function reject(formData: FormData) {
    "use server";
    const session = await auth();
    await rejectDraft(id, session?.user?.id ?? null, String(formData.get("note") ?? "") || null);
    revalidatePath(`/accounting/agents/${id}`);
    redirect("/accounting/agents");
  }

  const decided = draft.status !== "pending";

  return (
    <AppShell title={draft.title} subtitle={KIND_LABEL[draft.kind] ?? draft.kind}>
      <div className="flex items-center gap-3">
        <Link href="/accounting/agents" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Agents</Link>
        <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[draft.status]}`}>{draft.status}</span>
        {draft.invoiceId && (
          <Link href={`/accounting/invoices/${draft.invoiceId}`} className="text-xs text-amber-400 hover:text-amber-300 font-body">View invoice →</Link>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Draft generated {fmtDateTime(draft.createdAt)}{draft.model ? ` · ${draft.model}` : ""}. This is a draft for your
        review — approving records your sign-off; it does not send anything.
      </p>

      <form action={approve} className="space-y-3">
        <textarea
          name="content"
          defaultValue={current}
          readOnly={decided}
          rows={draft.kind === "ap_schedule" ? 24 : 14}
          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono leading-relaxed focus:outline-none focus:border-amber-500/40 read-only:opacity-80"
        />

        {!decided && (
          <>
            <input
              name="note"
              placeholder="Optional note for the log (why approved/rejected)…"
              className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
            <div className="flex justify-end gap-2">
              <button type="submit" formAction={saveEdits} className="text-xs font-body text-zinc-300 bg-white/5 border border-white/10 rounded-md px-4 py-2 hover:bg-white/10">Save edits</button>
              <button type="submit" formAction={reject} className="text-xs font-body text-zinc-400 hover:text-red-400 bg-white/5 border border-white/10 rounded-md px-4 py-2">Reject</button>
              <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Approve</button>
            </div>
          </>
        )}
      </form>

      {decided && (
        <div className="text-[11px] text-zinc-500 font-body">
          {draft.status === "approved" ? "Approved" : "Rejected"}
          {reviewer ? ` by ${reviewer.displayName || reviewer.name || reviewer.email}` : ""}
          {draft.reviewedAt ? ` on ${fmtDateTime(draft.reviewedAt)}` : ""}
          {draft.reviewNote ? ` — “${draft.reviewNote}”` : ""}.
          {draft.editedContent ? " (edited before decision)" : ""}
        </div>
      )}
    </AppShell>
  );
}
