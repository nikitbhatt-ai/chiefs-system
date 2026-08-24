import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(200);

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter(Boolean) as string[]));
  const actorRows = actorIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, actorIds))
    : [];
  const actorMap = new Map(actorRows.map((u) => [u.id, u.name ?? u.email]));

  async function markRead(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, s.user.id)));
    revalidatePath("/notifications");
  }

  async function markAllRead() {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, s.user.id), isNull(notifications.readAt)));
    revalidatePath("/notifications");
  }

  async function deleteNotification(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, s.user.id)));
    revalidatePath("/notifications");
  }

  const unreadCount = rows.filter((r) => !r.readAt).length;

  return (
    <AppShell title="Notifications" subtitle={`${unreadCount} unread`}>
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{rows.length} most recent</span>
          {unreadCount > 0 && (
            <form action={markAllRead}>
              <SubmitButton className="text-[11px] text-amber-400 hover:text-amber-300 font-body">Mark all as read</SubmitButton>
            </form>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-zinc-500 font-body">No notifications.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((n) => {
              const unread = !n.readAt;
              return (
                <li
                  key={n.id}
                  className={`rounded-md p-3 text-xs font-body border ${unread ? "bg-amber-500/5 border-amber-500/30" : "bg-black/30 border-white/5"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={`${unread ? "text-white" : "text-zinc-300"} font-semibold`}>
                        {n.link ? (
                          <a href={n.link} className="hover:text-amber-300">{n.title}</a>
                        ) : (
                          n.title
                        )}
                      </div>
                      {n.body && (<div className="text-zinc-400 mt-0.5 whitespace-pre-wrap">{n.body}</div>)}
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
                        {n.kind} · {n.actorId ? actorMap.get(n.actorId) ?? "system" : "system"} · {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {unread && (
                        <form action={markRead}>
                          <input type="hidden" name="id" value={n.id} />
                          <SubmitButton className="text-[10px] text-amber-400 hover:text-amber-300">Mark read</SubmitButton>
                        </form>
                      )}
                      <form action={deleteNotification}>
                        <input type="hidden" name="id" value={n.id} />
                        <SubmitButton className="text-[10px] text-zinc-500 hover:text-red-400">Delete</SubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
