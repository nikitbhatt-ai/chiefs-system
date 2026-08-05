import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

type TestResult = {
  ok: boolean;
  status: number;
  body: unknown;
  url: string;
  secretSet: boolean;
};

async function runTest(): Promise<TestResult> {
  "use server";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/api/leads/capture`;
  const secret = process.env.LEAD_CAPTURE_SECRET ?? "";

  if (!secret) {
    return { ok: false, status: 0, body: { error: "LEAD_CAPTURE_SECRET env var is not set on Vercel" }, url, secretSet: false };
  }

  const payload = {
    source: "in_app_test",
    name: `Smoke Test ${new Date().toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}`,
    email: "smoke-test@example.com",
    notes: "Generated from /settings/lead-capture-test. Safe to delete.",
    metadata: { triggeredBy: "in_app_settings_button" },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: "Network error", detail: String(err instanceof Error ? err.message : err) },
      url,
      secretSet: true,
    };
  }
  const body = await res.json().catch(() => ({ error: "non-JSON response" }));
  revalidatePath("/settings/lead-capture-test");
  revalidatePath("/leads");
  return { ok: res.ok, status: res.status, body, url, secretSet: true };
}

export default async function LeadCaptureTestPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") {
    return (
      <AppShell title="Lead-capture test" subtitle="Admin only">
        <div className="bg-surface border border-red-500/30 rounded-lg p-4 text-xs font-body text-red-300">
          This page is admin-only.
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  // Show the 5 most recent leads from the in-app test source so the user
  // can confirm each run actually landed a row.
  const recent = await db
    .select({ id: leads.id, name: leads.name, createdAt: leads.createdAt, source: leads.source })
    .from(leads)
    .where(eq(leads.source, "in_app_test"))
    .orderBy(desc(leads.createdAt))
    .limit(5);

  const secretSet = Boolean(process.env.LEAD_CAPTURE_SECRET);

  async function action(): Promise<void> {
    "use server";
    const result = await runTest();
    // Stash result via redirect search params so the page can render it.
    const sp = new URLSearchParams();
    sp.set("result", encodeURIComponent(JSON.stringify(result)));
    redirect(`/settings/lead-capture-test?${sp.toString()}`);
  }

  let lastResult: TestResult | null = null;
  if (sp.result) {
    try {
      lastResult = JSON.parse(decodeURIComponent(sp.result)) as TestResult;
    } catch {
      lastResult = null;
    }
  }

  return (
    <AppShell title="Lead-capture test" subtitle="Send a synthetic lead to /api/leads/capture and confirm the round-trip">
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3 max-w-3xl">
        <div className="text-xs font-body text-zinc-300 leading-relaxed">
          Click the button to POST a synthetic lead to the public capture
          endpoint with the server&apos;s <code className="bg-black/40 px-1 rounded">LEAD_CAPTURE_SECRET</code>{" "}
          attached. The endpoint is the same one Shopify webhooks and the
          main-site contact form will hit when they come online.
        </div>
        <div className="text-[11px] font-body">
          <span className="text-zinc-500 mr-2">Env var status:</span>
          {secretSet ? (
            <span className="text-green-300">LEAD_CAPTURE_SECRET is set on this deployment ✓</span>
          ) : (
            <span className="text-red-300">
              LEAD_CAPTURE_SECRET is NOT set. Add it in Vercel → Settings → Environment Variables (Production + Preview), then redeploy.
            </span>
          )}
        </div>
        <form action={action}>
          <button
            type="submit"
            disabled={!secretSet}
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-md px-4 py-2"
          >
            Send a test lead
          </button>
        </form>

        {lastResult && (
          <div
            className={`rounded-md p-3 border ${
              lastResult.ok
                ? "bg-green-500/10 border-green-500/30 text-green-200"
                : "bg-red-500/10 border-red-500/30 text-red-200"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider font-body font-semibold mb-1">
              {lastResult.ok ? "Success" : "Failed"} · HTTP {lastResult.status || "—"}
            </div>
            <div className="text-[11px] font-mono break-all">{lastResult.url}</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap mt-2">
              {JSON.stringify(lastResult.body, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-2 max-w-3xl">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
          Recent test leads
        </h3>
        {recent.length === 0 ? (
          <p className="text-[11px] text-zinc-500 font-body">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((l) => (
              <li key={l.id} className="text-[11px] font-body flex items-center justify-between border-t border-white/5 py-1.5">
                <a href={`/leads`} className="text-amber-300 hover:text-amber-200">
                  {l.name}
                </a>
                <span className="text-zinc-500 font-mono">
                  {new Date(l.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-zinc-500 font-body">
          Filtered to <code className="bg-black/40 px-1 rounded">source = in_app_test</code>. Delete from /leads when you don&apos;t need them.
        </p>
      </div>
    </AppShell>
  );
}
