import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { fmtDate, fmtDateTime } from "@/lib/datetime";
import {
  AgentError,
  agentsConfigured,
  draftArReminder,
  draftApSchedule,
  listDrafts,
  overdueInvoicesNeedingReminder,
} from "@/lib/agents";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  approved: "text-emerald-400 bg-emerald-500/10",
  rejected: "text-zinc-500 bg-white/5 line-through",
};
const KIND_LABEL: Record<string, string> = { ar_reminder: "AR reminder", ap_schedule: "AP plan" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const configured = agentsConfigured();
  const [drafts, overdue] = await Promise.all([listDrafts(), overdueInvoicesNeedingReminder()]);

  async function generateReminder(formData: FormData) {
    "use server";
    const session = await auth();
    const invoiceId = String(formData.get("invoiceId") ?? "");
    let draftId: string | undefined;
    try {
      const d = await draftArReminder(invoiceId, session?.user?.id ?? null);
      draftId = d.id;
    } catch (e) {
      redirect(`/accounting/agents?error=${encodeURIComponent(e instanceof AgentError ? e.message : "Something went wrong generating the draft.")}`);
    }
    revalidatePath("/accounting/agents");
    redirect(`/accounting/agents/${draftId}`);
  }

  async function generateApSchedule() {
    "use server";
    const session = await auth();
    let draftId: string | undefined;
    try {
      const d = await draftApSchedule(session?.user?.id ?? null);
      draftId = d.id;
    } catch (e) {
      redirect(`/accounting/agents?error=${encodeURIComponent(e instanceof AgentError ? e.message : "Something went wrong generating the draft.")}`);
    }
    revalidatePath("/accounting/agents");
    redirect(`/accounting/agents/${draftId}`);
  }

  return (
    <AppShell title="AR / AP agents" subtitle="Claude drafts reminders and payment plans — you approve, edit, or reject. Nothing is ever sent automatically.">
      <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>

      {!configured && (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 font-body">
          The agents aren&apos;t configured yet — set <code>ANTHROPIC_API_KEY</code> in the Vercel project environment to enable drafting.
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AR agent */}
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">AR agent · overdue reminders</h3>
          {overdue.length === 0 ? (
            <p className="text-[11px] text-zinc-500 font-body">No overdue invoices need a reminder right now.</p>
          ) : (
            <div className="space-y-2">
              {overdue.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 border-t border-white/5 pt-2 first:border-0 first:pt-0">
                  <div className="text-xs">
                    <span className="font-mono text-white">{inv.invoiceNumber}</span>
                    <span className="text-zinc-500"> · {inv.customerName ?? "—"} · {fmtCents(inv.balanceCents)} · due {fmtDate(inv.dueDate)}</span>
                  </div>
                  <form action={generateReminder}>
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <button type="submit" disabled={!configured} className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      Draft reminder
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AP agent */}
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">AP agent · payment plan</h3>
          <p className="text-[11px] text-zinc-500 font-body">
            Analyze all open bills — flag anomalies and propose a prioritized payment schedule for you to review.
          </p>
          <form action={generateApSchedule}>
            <button type="submit" disabled={!configured} className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed">
              Analyze payables
            </button>
          </form>
        </div>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">Drafts ({drafts.length})</div>
        <table className="w-full text-sm">
          <tbody className="font-body text-zinc-200">
            {drafts.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-xs text-zinc-500">No drafts yet — generate one above.</td></tr>
            ) : (
              drafts.map((d) => (
                <tr key={d.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5">
                    <Link href={`/accounting/agents/${d.id}`} className="text-white hover:text-amber-300">{d.title}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Agents only ever produce drafts. Approving a draft records your sign-off — it does not send the email or schedule
        the payment; those remain manual steps you perform outside the app.
      </p>
    </AppShell>
  );
}
