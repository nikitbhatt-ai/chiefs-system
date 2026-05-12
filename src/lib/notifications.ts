import { db } from "@/db";
import { notifications } from "@/db/schema";

export type NotificationKind =
  | "mention"
  | "comment_reply"
  | "task_assigned"
  | "stage_change"
  | "doc_reminder";

export async function notify(
  userId: string,
  opts: {
    kind: NotificationKind;
    title: string;
    body?: string | null;
    link?: string | null;
    dealId?: string | null;
    actorId?: string | null;
  },
) {
  if (!userId) return;
  await db.insert(notifications).values({
    userId,
    kind: opts.kind,
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
    dealId: opts.dealId ?? null,
    actorId: opts.actorId ?? null,
  });
}

export async function notifyMany(
  userIds: string[],
  opts: Parameters<typeof notify>[1],
) {
  const uniq = Array.from(new Set(userIds.filter(Boolean)));
  if (uniq.length === 0) return;
  await db.insert(notifications).values(
    uniq.map((userId) => ({
      userId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      dealId: opts.dealId ?? null,
      actorId: opts.actorId ?? null,
    })),
  );
}
