import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { leads, users, upfitConfigs } from "@/db/schema";
import { notifyMany } from "@/lib/notifications";
import {
  getModel,
  getLightPackage,
  getInteriorOption,
  agencyTypeToCustomerType,
  estimateTotal,
  summarizeSelection,
  AGENCY_TYPES,
  type LightPackageSlug,
  type InteriorOptionSlug,
} from "@/lib/upfit/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PUBLIC endpoint for the 3D Upfit Builder (Shopify hero + internal tool).
// Unlike /api/leads/capture this is called directly from the browser, so it
// does NOT use the shared LEAD_CAPTURE_SECRET (which must never reach client
// code). Abuse is mitigated with a hidden honeypot field and strict input
// validation. It writes a `leads` row (source = "upfit_builder") plus an
// `upfit_configs` row capturing the exact 3D configuration, then notifies
// every active sales user.

type Body = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  agency?: unknown;
  agencyType?: unknown;
  quantity?: unknown;
  notes?: unknown;
  honeypot?: unknown;
  selection?: {
    modelSlug?: unknown;
    lightPackage?: unknown;
    interiorOptions?: unknown;
    bodyColor?: unknown;
  };
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot — bots fill hidden fields, humans never see them. Pretend success.
  if (str(body.honeypot)) {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const name = str(body.name);
  const email = str(body.email);
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  const sel = body.selection ?? {};
  const model = getModel(str(sel.modelSlug));
  if (!model) {
    return NextResponse.json({ error: "Pick a vehicle model." }, { status: 400 });
  }

  const lightPackage = (getLightPackage(str(sel.lightPackage))?.slug ??
    "lightbar") as LightPackageSlug;
  const interiorOptions = (Array.isArray(sel.interiorOptions) ? sel.interiorOptions : [])
    .map((o) => str(o))
    .filter((o): o is InteriorOptionSlug => !!getInteriorOption(o));
  const bodyColor = str(sel.bodyColor) || model.bodyColor;

  const selection = {
    modelSlug: model.slug,
    lightPackage,
    interiorOptions,
    bodyColor,
  };

  const phone = str(body.phone) || null;
  const agency = str(body.agency) || null;
  const agencyTypeSlug = str(body.agencyType) || AGENCY_TYPES[0].slug;
  const customerType = agencyTypeToCustomerType(agencyTypeSlug);
  const quantity = str(body.quantity) || null;
  const userNotes = str(body.notes) || null;

  const total = estimateTotal(selection);
  const summary = summarizeSelection(selection);
  const lightName = getLightPackage(lightPackage)?.name ?? lightPackage;

  const notesParts = [
    `Upfit Builder request — ${model.fullName}.`,
    summary,
    quantity ? `Quantity: ${quantity}` : null,
    agency ? `Agency: ${agency}` : null,
    userNotes ? `Notes: ${userNotes}` : null,
  ].filter(Boolean);

  const subSourceMeta = {
    builder: "upfit",
    selection,
    estimateTotal: total,
    modelName: model.fullName,
    quantity,
    agency,
    agencyType: agencyTypeSlug,
    capturedAt: new Date().toISOString(),
    capturedFromIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  };

  let leadId: string | null = null;
  try {
    const [row] = await db
      .insert(leads)
      .values({
        name,
        email,
        phone,
        customerType,
        source: "upfit_builder",
        subSource: `${model.name} · ${lightName}`,
        subSourceMeta,
        status: "new",
        notes: notesParts.join("\n"),
      })
      .returning({ id: leads.id });
    leadId = row?.id ?? null;
  } catch (err) {
    console.error("upfit lead insert failed:", err);
    return NextResponse.json({ error: "Could not save your request." }, { status: 500 });
  }

  // Persist the full configuration. Best-effort: if the upfit_configs table
  // hasn't been created yet, the lead is still captured above.
  try {
    await db.insert(upfitConfigs).values({
      leadId,
      modelSlug: model.slug,
      modelName: model.fullName,
      vehicleType: model.type,
      bodyColor,
      lightPackage,
      interiorOptions,
      estimateTotal: total,
      config: selection,
      source: "upfit_builder",
      contactName: name,
      contactEmail: email,
      contactPhone: phone,
      agency,
      agencyType: agencyTypeSlug,
      notes: userNotes,
    });
  } catch (err) {
    console.error("upfit config insert failed (lead still captured):", err);
  }

  // Notify active sales users.
  try {
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.active, true), eq(users.role, "sales")));
    if (recipients.length) {
      await notifyMany(
        recipients.map((r) => r.id),
        {
          kind: "task_assigned",
          title: `New upfit request: ${name}`,
          body: `${model.name} · ${lightName} · Est. $${total.toLocaleString()}${quantity ? ` · Qty ${quantity}` : ""}`,
          link: `/leads`,
        },
      );
    }
  } catch (err) {
    console.error("upfit lead notify failed:", err);
  }

  return NextResponse.json({ ok: true, id: leadId }, { status: 201 });
}
