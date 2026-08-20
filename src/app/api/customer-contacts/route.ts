import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customerContacts } from "@/db/schema";
import { normalizeEmail } from "@/lib/communications";

export const dynamic = "force-dynamic";

// Contacts are the matcher's lookup table: every address here is mail that
// files itself. GET ?customerId= to list one account's contacts.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const customerId = new URL(req.url).searchParams.get("customerId");
  const where = customerId
    ? and(eq(customerContacts.customerId, customerId), eq(customerContacts.active, true))
    : eq(customerContacts.active, true);

  const rows = await db
    .select()
    .from(customerContacts)
    .where(where)
    .orderBy(asc(customerContacts.name));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.customerId !== "string") {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (!body.email && !body.phone) {
    return NextResponse.json({ error: "an email or a phone number is required" }, { status: 400 });
  }

  const [row] = await db
    .insert(customerContacts)
    .values({
      customerId: body.customerId,
      name: body.name ?? null,
      title: body.title ?? null,
      // Lowercased on write so the matcher can use a plain equality index.
      email: normalizeEmail(body.email),
      phone: body.phone ?? null,
      isPrimary: !!body.isPrimary,
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
