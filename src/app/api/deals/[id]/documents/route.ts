import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, files } from "@/db/schema";
import { docForPipeline } from "@/lib/documentTemplates";
import { getPipeline } from "@/lib/pipelines";

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

  const form = await req.formData();
  const file = form.get("file");
  const requestedKind = String(form.get("kind") ?? "").trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const pipeline = getPipeline(deal.pipeline);
  const docSpec = docForPipeline(pipeline.slug);
  let kind = requestedKind ?? docSpec?.slug ?? "deal_attachment";
  if (docSpec && (requestedKind === docSpec.slug || requestedKind == null)) {
    kind = docSpec.slug;
  }

  const blob = await put(`deals/${id}/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  const [row] = await db
    .insert(files)
    .values({
      entityType: "deal",
      entityId: id,
      blobUrl: blob.url,
      filename: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size || null,
      kind,
      uploadedBy: session.user.id,
    })
    .returning();

  return NextResponse.json({ file: row });
}
