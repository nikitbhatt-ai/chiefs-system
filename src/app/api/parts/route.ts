import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(parts).orderBy(desc(parts.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.sku || !body?.name) {
    return NextResponse.json({ error: "sku and name are required" }, { status: 400 });
  }
  const sku = String(body.sku).trim();
  // SKU (part number) is the unique natural key. Reject duplicates with a clear
  // message the UI surfaces as a popup, rather than letting the DB unique
  // constraint throw a 500.
  const [dupe] = await db.select({ id: parts.id }).from(parts).where(eq(parts.sku, sku)).limit(1);
  if (dupe) {
    return NextResponse.json(
      { error: "duplicate part number detected, add appropriate part number", code: "duplicate_sku" },
      { status: 409 },
    );
  }
  const [row] = await db
    .insert(parts)
    .values({
      sku,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      quantityOnHand: body.quantityOnHand ?? 0,
      quantityOnOrder: body.quantityOnOrder ?? 0,
      reorderPoint: body.reorderPoint ?? null,
      cost: body.cost != null ? String(body.cost) : null,
      price: body.price != null ? String(body.price) : null,
      vendorId: body.vendorId ?? null,
      manufacturerId: body.manufacturerId ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
