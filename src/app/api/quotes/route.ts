import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { upsertQuoteLink } from "@/lib/customerDocLinks";
import { nextDocumentNumber } from "@/lib/documentNumber";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(quotes).orderBy(desc(quotes.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // Assign the shared 4-digit job number up front; the quote number and
  // the eventual work order + invoice all key off it.
  const documentNumber = await nextDocumentNumber();
  const quoteNumber = body.quoteNumber ?? `Q-${documentNumber}`;
  const [row] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      documentNumber,
      customerId: body.customerId ?? null,
      dealId: body.dealId ?? null,
      status: body.status ?? "draft",
      notes: body.notes ?? null,
      lineItems: body.lineItems ?? [],
      subtotal: body.subtotal != null ? String(body.subtotal) : "0",
      taxTotal: body.taxTotal != null ? String(body.taxTotal) : "0",
      grandTotal: body.grandTotal != null ? String(body.grandTotal) : "0",
    })
    .returning();
  // Auto-link the new quote into the customer folder so it appears under
  // 'Quotes & Estimates' immediately (matches saveQuote behavior).
  if (row?.id) {
    try {
      await upsertQuoteLink(row.id);
    } catch (err) {
      console.error("upsertQuoteLink on create failed:", err);
    }
  }
  return NextResponse.json(row, { status: 201 });
}
