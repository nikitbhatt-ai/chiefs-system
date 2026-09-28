import { NextRequest } from "next/server";
import { handleLeadIntake } from "@/lib/leads/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleLeadIntake(req, { sourceChannel: "shopify_parts_inquiry" });
}
