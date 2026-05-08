import { NextResponse } from "next/server";
import { desc, ilike, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customers, leads, quotes, workOrders } from "@/db/schema";

const LIMIT = 5;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({
      customers: [],
      leads: [],
      quotes: [],
      workOrders: [],
    });
  }

  const like = `%${q}%`;

  const [customerRows, leadRows, quoteRows, workOrderRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(
        or(
          ilike(customers.name, like),
          ilike(customers.email, like),
          ilike(customers.phone, like),
        ),
      )
      .orderBy(desc(customers.createdAt))
      .limit(LIMIT),
    db
      .select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
      })
      .from(leads)
      .where(
        or(
          ilike(leads.name, like),
          ilike(leads.email, like),
          ilike(leads.phone, like),
        ),
      )
      .orderBy(desc(leads.createdAt))
      .limit(LIMIT),
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        status: quotes.status,
        grandTotal: quotes.grandTotal,
        customerName: customers.name,
      })
      .from(quotes)
      .leftJoin(customers, sql`${customers.id} = ${quotes.customerId}`)
      .where(
        or(
          ilike(quotes.quoteNumber, like),
          ilike(quotes.notes, like),
          ilike(customers.name, like),
        ),
      )
      .orderBy(desc(quotes.createdAt))
      .limit(LIMIT),
    db
      .select({
        id: workOrders.id,
        woNumber: workOrders.woNumber,
        status: workOrders.status,
        customerName: customers.name,
      })
      .from(workOrders)
      .leftJoin(customers, sql`${customers.id} = ${workOrders.customerId}`)
      .where(
        or(
          ilike(workOrders.woNumber, like),
          ilike(workOrders.notes, like),
          ilike(customers.name, like),
        ),
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(LIMIT),
  ]);

  return NextResponse.json({
    customers: customerRows.map((c) => ({
      type: "customer",
      id: c.id,
      title: c.name,
      subtitle: c.email ?? c.phone ?? undefined,
      href: `/crm/${c.id}`,
    })),
    leads: leadRows.map((l) => ({
      type: "lead",
      id: l.id,
      title: l.name,
      subtitle: l.email ?? l.phone ?? undefined,
      href: `/leads/${l.id}/edit`,
    })),
    quotes: quoteRows.map((q) => ({
      type: "quote",
      id: q.id,
      title: q.quoteNumber ?? `Quote ${q.id.slice(0, 8)}`,
      subtitle:
        [q.customerName, q.status].filter(Boolean).join(" · ") || undefined,
      href: `/quotes/${q.id}`,
    })),
    workOrders: workOrderRows.map((w) => ({
      type: "work_order",
      id: w.id,
      title: w.woNumber ?? `WO ${w.id.slice(0, 8)}`,
      subtitle:
        [w.customerName, w.status].filter(Boolean).join(" · ") || undefined,
      href: `/work-orders`,
    })),
  });
}
