import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { type PgTable } from "drizzle-orm/pg-core";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, customers, leads, quotes, workOrders, purchaseOrders, parts, packages } from "@/db/schema";

export const dynamic = "force-dynamic";

// Entity slug -> table. The slugs match the list route segments so the client
// control can pass its own page name. Every table here has `tags` (text[]) and
// `archived` columns.
const TABLES: Record<string, PgTable> = {
  deals,
  customers,
  leads,
  quotes,
  "work-orders": workOrders,
  "purchase-orders": purchaseOrders,
  parts,
  packages,
};

const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;

function cleanTags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  for (const raw of input) {
    const t = String(raw ?? "").trim().slice(0, MAX_TAG_LEN);
    if (t) seen.add(t);
    if (seen.size >= MAX_TAGS) break;
  }
  return Array.from(seen);
}

// PATCH /api/list-meta  body: { entity, id, tags?: string[], archived?: boolean }
// Tagging and archiving are non-destructive workflow actions, so any
// authenticated user may do them (hard delete stays manager-only elsewhere).
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const entity = String(body?.entity ?? "");
  const id = String(body?.id ?? "");
  const tableDef = TABLES[entity];
  if (!tableDef || !id) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const set: Record<string, unknown> = {};
  if ("tags" in body) {
    const tags = cleanTags(body.tags);
    if (tags === null) return NextResponse.json({ error: "tags must be an array" }, { status: 400 });
    set.tags = tags;
  }
  if ("archived" in body) {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
    }
    set.archived = body.archived;
  }
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  set.updatedAt = new Date();

  // Type-erased dispatch on purpose (entity is validated against TABLES above).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = tableDef as any;
  await db.update(table).set(set).where(eq(table.id, id));

  return NextResponse.json({ ok: true });
}
