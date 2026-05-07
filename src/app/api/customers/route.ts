import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customers } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select().from(customers).orderBy(desc(customers.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [row] = await db
    .insert(customers)
    .values({
      name: body.name.trim(),
      type: body.type ?? "commercial",
      email: body.email ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      taxExempt: !!body.taxExempt,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
