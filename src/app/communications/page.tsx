import { and, asc, count, desc, eq, inArray, ne, notInArray, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  commAccounts,
  commSyncState,
  communications,
  communicationParticipants,
  customers,
  deals,
  leads,
} from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";
import { CommunicationTimeline } from "@/components/CommunicationTimeline";
import { assignCommunication } from "@/lib/communications";
import { graphConfigured } from "@/lib/graph";
import { syncAllMailboxes } from "@/lib/mailSync";
import { hasRole, MANAGER_ROLES } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUSES = ["unassigned", "matched", "ignored", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

const CHANNELS = ["email", "call", "sms", "meeting", "in_person", "note"];
const CLOSED_STAGES: (typeof deals.$inferSelect)["stage"][] = ["delivered", "lost"];

// The unified inbox. Two jobs:
//   1. Triage — messages the matcher couldn't attribute get filed here, once,
//      and filing teaches it the sender's address so it won't ask again.
//   2. One place to read the whole company's customer conversation, across
//      every channel, without opening deals one at a time.
export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string }>;
}) {
  const session = await auth();
  const isManager = hasRole(session, MANAGER_ROLES);

  const sp = await searchParams;
  const status: StatusFilter = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as StatusFilter)
    : "unassigned";
  const channel = CHANNELS.includes(sp.channel ?? "") ? sp.channel! : "";

  const filters: SQL[] = [];
  if (status !== "all") filters.push(eq(communications.status, status));
  if (channel) filters.push(eq(communications.channel, channel));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, unassignedCount, accounts, syncStates] = await Promise.all([
    db.select().from(communications).where(where).orderBy(desc(communications.occurredAt)).limit(100),
    db.select({ n: count() }).from(communications).where(eq(communications.status, "unassigned")),
    db.select().from(commAccounts).orderBy(asc(commAccounts.address)),
    db.select().from(commSyncState),
  ]);

  const participants = rows.length
    ? await db
        .select({
          communicationId: communicationParticipants.communicationId,
          role: communicationParticipants.role,
          name: communicationParticipants.name,
          email: communicationParticipants.email,
        })
        .from(communicationParticipants)
        .where(inArray(communicationParticipants.communicationId, rows.map((r) => r.id)))
    : [];

  // Filing targets. Bounded lists — open deals, active customers, open leads —
  // because a full dump of every historical record isn't a usable dropdown.
  const needsTriage = rows.some((r) => r.status === "unassigned");
  const [openDeals, activeCustomers, openLeads] = needsTriage
    ? await Promise.all([
        db
          .select({
            id: deals.id,
            customerId: deals.customerId,
            stage: deals.stage,
            vehicleMake: deals.vehicleMake,
            vehicleModel: deals.vehicleModel,
          })
          .from(deals)
          .where(and(eq(deals.archived, false), notInArray(deals.stage, CLOSED_STAGES)))
          .orderBy(desc(deals.updatedAt))
          .limit(200),
        db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(eq(customers.archived, false))
          .orderBy(asc(customers.name))
          .limit(400),
        db
          .select({ id: leads.id, name: leads.name, email: leads.email })
          .from(leads)
          .where(and(eq(leads.archived, false), ne(leads.status, "converted")))
          .orderBy(desc(leads.createdAt))
          .limit(200),
      ])
    : [[], [], []];

  const customerName = new Map(activeCustomers.map((c) => [c.id, c.name]));

  // ───────────────────────────────────────────────────────────────────────────
  // Server actions
  // ───────────────────────────────────────────────────────────────────────────

  // One select, three kinds of target: values are "deal:<id>", "customer:<id>"
  // or "lead:<id>", so the whole triage decision is a single control.
  async function fileMessage(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const id = String(formData.get("id") ?? "");
    const target = String(formData.get("target") ?? "");
    if (!id || !target) return;

    const [kind, targetId] = target.split(":");
    if (!targetId) return;

    // Filing to a deal also files to its customer, so the account timeline is
    // complete even when a message was pinned to one deal.
    let customerId: string | null = null;
    if (kind === "deal") {
      const [d] = await db.select({ customerId: deals.customerId }).from(deals).where(eq(deals.id, targetId)).limit(1);
      customerId = d?.customerId ?? null;
    }

    await assignCommunication(
      id,
      {
        dealId: kind === "deal" ? targetId : null,
        customerId: kind === "customer" ? targetId : customerId,
        leadId: kind === "lead" ? targetId : null,
        status: "matched",
      },
      s.user.id,
    );
    revalidatePath("/communications");
  }

  // Not sales activity. Keeps the row (so re-ingest can't resurrect it) but
  // takes it out of the queue for good.
  async function ignoreMessage(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await assignCommunication(id, { status: "ignored" }, s.user.id);
    revalidatePath("/communications");
  }

  async function syncNow() {
    "use server";
    const s = await auth();
    if (!s?.user || !hasRole(s, MANAGER_ROLES)) return;
    await syncAllMailboxes();
    revalidatePath("/communications");
  }

  async function addMailbox(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || !hasRole(s, MANAGER_ROLES)) return;
    const address = String(formData.get("address") ?? "").trim().toLowerCase();
    if (!address.includes("@")) return;
    await db
      .insert(commAccounts)
      .values({
        kind: "mailbox",
        address,
        label: String(formData.get("label") ?? "").trim() || null,
        provider: "graph",
      })
      .onConflictDoNothing({ target: commAccounts.address });
    revalidatePath("/communications");
  }

  async function toggleMailbox(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || !hasRole(s, MANAGER_ROLES)) return;
    const id = String(formData.get("id") ?? "");
    const enable = String(formData.get("enable") ?? "") === "1";
    if (!id) return;
    await db
      .update(commAccounts)
      .set({ syncEnabled: enable, updatedAt: new Date() })
      .where(eq(commAccounts.id, id));
    revalidatePath("/communications");
  }

  const pending = Number(unassignedCount[0]?.n ?? 0);

  return (
    <AppShell
      title="Communications"
      subtitle="Every customer conversation — email, calls, and notes — in one place"
    >
      {/* Sync health. A mailbox that stopped syncing is invisible otherwise:
          the inbox just looks quiet. */}
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Mailbox sync</h3>
          {isManager && (
            <form action={syncNow}>
              <SubmitButton
                className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1.5"
                pendingLabel="Syncing…"
              >
                Sync now
              </SubmitButton>
            </form>
          )}
        </div>

        {!graphConfigured() && (
          <div className="text-[11px] text-amber-300 font-body bg-amber-500/10 border border-amber-500/30 rounded p-3">
            Microsoft Graph isn&apos;t configured yet — set <code>GRAPH_TENANT_ID</code>,{" "}
            <code>GRAPH_CLIENT_ID</code> and <code>GRAPH_CLIENT_SECRET</code> on Vercel. Until then
            nothing syncs automatically; manually logged calls and emails still work.
            See <code>docs/REQUIREMENTS.md</code> § Communication ingest for the Entra setup steps.
          </div>
        )}

        {accounts.length === 0 ? (
          <p className="text-xs text-zinc-500 font-body">
            No mailboxes registered. A mailbox is only ever read once it&apos;s listed here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5">
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                  <th className="px-3 py-2">Mailbox</th>
                  <th className="px-3 py-2">Sync</th>
                  <th className="px-3 py-2">Last run</th>
                  <th className="px-3 py-2">Folders</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="font-body text-zinc-300">
                {accounts.map((a) => {
                  const states = syncStates.filter((s) => s.accountId === a.id);
                  const error = a.lastError ?? states.find((s) => s.lastError)?.lastError ?? null;
                  return (
                    <tr key={a.id} className="border-t border-white/5">
                      <td className="px-3 py-2 text-white">
                        {a.address}
                        {a.label && <span className="text-zinc-500 ml-1.5">({a.label})</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={a.syncEnabled ? "text-green-400" : "text-zinc-500"}>
                          {a.syncEnabled ? "on" : "paused"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{fmtDateTime(a.lastSyncedAt)}</td>
                      <td className="px-3 py-2 text-[11px] text-zinc-500">
                        {states.length === 0
                          ? "not started"
                          : states.map((s) => `${s.folder}: ${s.lastIngested ?? 0}`).join(" · ")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isManager && (
                          <form action={toggleMailbox} className="inline">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="enable" value={a.syncEnabled ? "0" : "1"} />
                            <SubmitButton className="text-[11px] text-amber-400 hover:text-amber-300 font-body">
                              {a.syncEnabled ? "Pause" : "Resume"}
                            </SubmitButton>
                          </form>
                        )}
                        {error && (
                          <div className="text-[10px] text-red-400 mt-1 max-w-xs truncate" title={error}>
                            {error}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {isManager && (
          <form action={addMailbox} className="flex flex-wrap items-end gap-2 pt-1">
            <input
              name="address"
              required
              placeholder="sales@chiefspursuitsurplus.com"
              className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500 min-w-[260px]"
            />
            <input
              name="label"
              placeholder="Label (optional)"
              className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500"
            />
            <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">
              Add mailbox
            </SubmitButton>
          </form>
        )}
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={status}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="unassigned">Needs filing{pending > 0 ? ` (${pending})` : ""}</option>
          <option value="matched">Filed</option>
          <option value="ignored">Ignored</option>
          <option value="all">All</option>
        </select>
        <select
          name="channel"
          defaultValue={channel}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-4 py-2"
        >
          Filter
        </button>
      </form>

      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <CommunicationTimeline
          rows={rows}
          participants={participants}
          emptyText={
            status === "unassigned"
              ? "Nothing waiting to be filed."
              : "No communication recorded yet."
          }
          actions={(row) =>
            row.status === "unassigned" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <form action={fileMessage} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={row.id} />
                  <select
                    name="target"
                    required
                    defaultValue=""
                    className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white max-w-[220px]"
                  >
                    <option value="" disabled>
                      — File to… —
                    </option>
                    {openDeals.length > 0 && (
                      <optgroup label="Open deals">
                        {openDeals.map((d) => (
                          <option key={d.id} value={`deal:${d.id}`}>
                            {customerName.get(d.customerId ?? "") ?? "Deal"}
                            {d.vehicleMake ? ` · ${d.vehicleMake} ${d.vehicleModel ?? ""}` : ""} ({d.stage})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {activeCustomers.length > 0 && (
                      <optgroup label="Customers">
                        {activeCustomers.map((c) => (
                          <option key={c.id} value={`customer:${c.id}`}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {openLeads.length > 0 && (
                      <optgroup label="Leads">
                        {openLeads.map((l) => (
                          <option key={l.id} value={`lead:${l.id}`}>
                            {l.name}
                            {l.email ? ` · ${l.email}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <SubmitButton className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-2 py-1">
                    File
                  </SubmitButton>
                </form>
                <form action={ignoreMessage} className="inline">
                  <input type="hidden" name="id" value={row.id} />
                  <SubmitButton className="text-[11px] text-zinc-500 hover:text-red-400 font-body">
                    Ignore
                  </SubmitButton>
                </form>
              </div>
            ) : null
          }
        />
      </div>
    </AppShell>
  );
}
