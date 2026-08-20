// Drives the Graph adapter over every enabled mailbox. Called by the
// /api/cron/mail-sync cron and by the "Sync now" button on /communications.
//
// Shape of a run, per mailbox and per folder:
//   no cursor yet → bounded backfill (COMM_BACKFILL_DAYS, default 30) then
//                   take a "latest" delta token, so a first run never drags in
//                   years of mail
//   cursor stored → follow the deltaLink; persist the next one
//
// Failures are recorded on the row and the loop continues: one mailbox with a
// revoked permission must not stop the others from syncing.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { commAccounts, commSyncState } from "@/db/schema";
import { existingExternalIds, recordCommunication } from "@/lib/communications";
import {
  fetchAttachmentMeta,
  fetchDelta,
  fetchLatestDeltaLink,
  fetchMessagesSince,
  graphConfigured,
  mapGraphMessage,
  resolveGraphUserId,
  SYNCED_FOLDERS,
  type GraphMessage,
  type SyncedFolder,
} from "@/lib/graph";

export type FolderResult = {
  folder: SyncedFolder;
  fetched: number;
  created: number;
  duplicates: number;
  skipped: Record<string, number>;
  error?: string;
};

export type AccountResult = {
  address: string;
  folders: FolderResult[];
  error?: string;
};

export type SyncSummary = {
  ran: boolean;
  reason?: string;
  accounts: AccountResult[];
  created: number;
};

function backfillSince(): Date {
  const days = Number(process.env.COMM_BACKFILL_DAYS ?? 30);
  const safe = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() - safe * 24 * 60 * 60 * 1000);
}

async function syncFolder(
  account: { id: string; address: string; graphUserId: string },
  folder: SyncedFolder,
): Promise<FolderResult> {
  const result: FolderResult = { folder, fetched: 0, created: 0, duplicates: 0, skipped: {} };

  const [existingState] = await db
    .select()
    .from(commSyncState)
    .where(and(eq(commSyncState.accountId, account.id), eq(commSyncState.folder, folder)))
    .limit(1);

  let state = existingState;
  if (!state) {
    const [created] = await db
      .insert(commSyncState)
      .values({ accountId: account.id, folder })
      .returning();
    state = created;
  }

  let messages: GraphMessage[] = [];
  let nextDeltaLink: string | null = state.deltaLink ?? null;

  if (state.deltaLink) {
    const delta = await fetchDelta(state.deltaLink);
    messages = delta.messages;
    nextDeltaLink = delta.deltaLink;
  } else {
    messages = await fetchMessagesSince(account.graphUserId, folder, backfillSince());
    nextDeltaLink = await fetchLatestDeltaLink(account.graphUserId, folder);
  }

  // Drafts aren't communication, and @removed entries are deletions — we keep
  // the record of a message that was sent even if it's later deleted.
  const usable = messages.filter((m) => !m["@removed"] && !m.isDraft);
  result.fetched = usable.length;

  const mapped = usable
    .map((m) => ({ msg: m, input: mapGraphMessage(m, account.address, folder) }))
    .filter((x): x is { msg: GraphMessage; input: NonNullable<ReturnType<typeof mapGraphMessage>> } => !!x.input);

  const known = await existingExternalIds(mapped.map((m) => m.input.externalId ?? "").filter(Boolean));

  for (const { msg, input } of mapped) {
    if (input.externalId && known.has(input.externalId)) {
      result.duplicates++;
      continue;
    }

    if (msg.hasAttachments && msg.id) {
      try {
        input.attachments = await fetchAttachmentMeta(account.graphUserId, msg.id);
      } catch {
        // Attachment listing is best-effort; never lose the message over it.
      }
    }

    const recorded = await recordCommunication(input);
    if (!recorded.ok) {
      result.skipped[recorded.skipped] = (result.skipped[recorded.skipped] ?? 0) + 1;
    } else if (recorded.created) {
      result.created++;
    } else {
      result.duplicates++;
    }
  }

  await db
    .update(commSyncState)
    .set({
      deltaLink: nextDeltaLink,
      lastRunAt: new Date(),
      lastIngested: result.created,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(commSyncState.id, state.id));

  return result;
}

export async function syncAccount(account: {
  id: string;
  address: string;
  graphUserId: string | null;
}): Promise<AccountResult> {
  const out: AccountResult = { address: account.address, folders: [] };

  try {
    // Resolve the address to an Entra object id once and remember it.
    let graphUserId = account.graphUserId;
    if (!graphUserId) {
      graphUserId = await resolveGraphUserId(account.address);
      await db
        .update(commAccounts)
        .set({ graphUserId, updatedAt: new Date() })
        .where(eq(commAccounts.id, account.id));
    }

    for (const folder of SYNCED_FOLDERS) {
      try {
        out.folders.push(await syncFolder({ ...account, graphUserId }, folder));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        out.folders.push({ folder, fetched: 0, created: 0, duplicates: 0, skipped: {}, error: message });
        await db
          .update(commSyncState)
          .set({ lastError: message, lastRunAt: new Date(), updatedAt: new Date() })
          .where(and(eq(commSyncState.accountId, account.id), eq(commSyncState.folder, folder)));
      }
    }

    const firstError = out.folders.find((f) => f.error)?.error ?? null;
    await db
      .update(commAccounts)
      .set({ lastSyncedAt: new Date(), lastError: firstError, updatedAt: new Date() })
      .where(eq(commAccounts.id, account.id));
    if (firstError) out.error = firstError;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out.error = message;
    await db
      .update(commAccounts)
      .set({ lastError: message, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(commAccounts.id, account.id));
  }

  return out;
}

export async function syncAllMailboxes(opts: { accountId?: string } = {}): Promise<SyncSummary> {
  if (!graphConfigured()) {
    return { ran: false, reason: "graph_not_configured", accounts: [], created: 0 };
  }

  const filters = [
    eq(commAccounts.active, true),
    eq(commAccounts.syncEnabled, true),
    eq(commAccounts.provider, "graph"),
    eq(commAccounts.kind, "mailbox"),
  ];
  if (opts.accountId) filters.push(eq(commAccounts.id, opts.accountId));

  const accounts = await db
    .select({ id: commAccounts.id, address: commAccounts.address, graphUserId: commAccounts.graphUserId })
    .from(commAccounts)
    .where(and(...filters));

  if (accounts.length === 0) {
    return { ran: false, reason: "no_enabled_mailboxes", accounts: [], created: 0 };
  }

  const results: AccountResult[] = [];
  for (const account of accounts) {
    results.push(await syncAccount(account));
  }

  const created = results.reduce(
    (sum, a) => sum + a.folders.reduce((s, f) => s + f.created, 0),
    0,
  );
  return { ran: true, accounts: results, created };
}
