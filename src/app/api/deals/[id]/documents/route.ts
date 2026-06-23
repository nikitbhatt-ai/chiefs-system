import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, customerDocuments } from "@/db/schema";
import { categoryForKind, categoryVisibleTo } from "@/lib/customerDocuments";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const [deal] = await db.select().from(deals).where(eq(deals.id, id));
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!deal.customerId) {
    return NextResponse.json({ error: "Deal has no customer; cannot upload" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "").trim() || "deal_attachment";

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  // Cap upload size (25 MB) so a single request can't blow past the function
  // body limit or fill blob storage.
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit" }, { status: 413 });
  }

  const category = categoryForKind(kind);
  // Write-side RBAC: the same category access that gates downloads must gate
  // uploads, otherwise a low-privilege user could drop documents into
  // manager-only folders (contracts, credentials, invoices, compliance).
  if (!categoryVisibleTo(category, session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const blob = await put(`customers/${deal.customerId}/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  const [prior] = await db
    .select({ id: customerDocuments.id, version: customerDocuments.version, parentDocumentId: customerDocuments.parentDocumentId })
    .from(customerDocuments)
    .where(and(
      eq(customerDocuments.customerId, deal.customerId),
      eq(customerDocuments.category, category),
      eq(customerDocuments.fileName, file.name),
      eq(customerDocuments.isCurrentVersion, true),
    ))
    .limit(1);
  let version = 1;
  let parentDocumentId: string | null = null;
  if (prior) {
    version = prior.version + 1;
    parentDocumentId = prior.parentDocumentId ?? prior.id;
    await db.update(customerDocuments).set({ isCurrentVersion: false }).where(eq(customerDocuments.id, prior.id));
  }

  const [row] = await db
    .insert(customerDocuments)
    .values({
      customerId: deal.customerId,
      category,
      fileName: file.name,
      blobUrl: blob.url,
      mimeType: file.type || null,
      sizeBytes: file.size || null,
      uploadedBy: session.user.id,
      associatedDealId: id,
      kind,
      version,
      isCurrentVersion: true,
      parentDocumentId,
    })
    .returning();

  return NextResponse.json({ document: row });
}
