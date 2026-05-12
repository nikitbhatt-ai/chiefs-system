import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customerDocuments, documentAuditLog } from "@/db/schema";
import { categoryVisibleTo } from "@/lib/customerDocuments";

export const dynamic = "force-dynamic";

// Wrapper around the blob URL that records a 'download' audit row before
// redirecting. Anyone with a direct blob link can still bypass this, but
// the in-app UI links here so the audit captures normal usage.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [doc] = await db
    .select({
      id: customerDocuments.id,
      customerId: customerDocuments.customerId,
      category: customerDocuments.category,
      blobUrl: customerDocuments.blobUrl,
    })
    .from(customerDocuments)
    .where(eq(customerDocuments.id, id));
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const role = (session.user as { role?: string }).role;
  if (!categoryVisibleTo(doc.category, role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.insert(documentAuditLog).values({
    documentId: doc.id,
    customerId: doc.customerId,
    userId: session.user.id,
    action: "download",
    ipAddress: ip,
  });

  return NextResponse.redirect(doc.blobUrl);
}
