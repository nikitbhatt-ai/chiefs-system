import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

const MAX_BYTES = 4 * 1024 * 1024; // Stay below Vercel's 4.5 MB serverless limit.

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid upload payload." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const pathname = String(formData.get("pathname") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (!pathname) {
    return NextResponse.json({ error: "Missing pathname." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is 4 MB per photo. Try resizing or compressing it first.`,
      },
      { status: 413 }
    );
  }

  try {
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type || undefined,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
