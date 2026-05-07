import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
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
  const [row] = await db
    .insert(parts)
    .values({
      sku: body.sku,
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
