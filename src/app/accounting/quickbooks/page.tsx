import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { dollarsToCents, LedgerError } from "@/lib/accounting";
import { fmtDateTime } from "@/lib/datetime";
import {
  qboConfigured,
  getSettings,
  isConnected,
  beginAuth,
  disconnect,
  setEnvironment,
  importPayrollLabor,
  departmentsForPayroll,
  type PayrollKind,
} from "@/lib/qbo";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const connected = sp.connected === "1";
  const configured = qboConfigured();
  const [settings, depts] = await Promise.all([getSettings(), departmentsForPayroll()]);
  const linked = isConnected(settings);

  async function connect() {
    "use server";
    let url: string;
    try {
      url = await beginAuth();
    } catch (e) {
      redirect(`/accounting/quickbooks?error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Could not start the connection.")}`);
    }
    redirect(url);
  }
  async function disconnectQbo() {
    "use server";
    const session = await auth();
    await disconnect(session?.user?.id ?? null);
    revalidatePath("/accounting/quickbooks");
    redirect("/accounting/quickbooks");
  }
  async function switchEnv(formData: FormData) {
    "use server";
    const session = await auth();
    const env = String(formData.get("environment") ?? "sandbox") === "production" ? "production" : "sandbox";
    try {
      await setEnvironment(env, formData.get("confirm") === "on", session?.user?.id ?? null);
    } catch (e) {
      redirect(`/accounting/quickbooks?error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Could not change environment.")}`);
    }
    revalidatePath("/accounting/quickbooks");
    redirect("/accounting/quickbooks");
  }
  async function importPayroll(formData: FormData) {
    "use server";
    const session = await auth();
    const periodLabel = String(formData.get("period") ?? "").trim() || "payroll period";
    const lines = depts.map((d) => ({
      departmentId: d.id,
      amountCents: dollarsToCents(String(formData.get(`amt_${d.id}`) ?? "")),
      // Anything not explicitly marked direct is treated as overhead — see
      // importPayrollLabor on why that's the safe default.
      kind: (String(formData.get(`kind_${d.id}`) ?? "admin") === "direct" ? "direct" : "admin") as PayrollKind,
    }));
    try {
      await importPayrollLabor({ periodLabel, lines, createdBy: session?.user?.id ?? null });
    } catch (e) {
      redirect(`/accounting/quickbooks?error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Could not import payroll.")}`);
    }
    revalidatePath("/accounting/quickbooks");
    redirect("/accounting/quickbooks?imported=1");
  }

  return (
    <AppShell title="QuickBooks Online" subtitle="Connect Intuit, map accounts, and reconcile payroll — sandbox first">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/quickbooks/mapping" className="text-xs text-amber-400 hover:text-amber-300 font-body">Account mapping →</Link>
        <Link href="/accounting/quickbooks/sync-log" className="text-xs text-amber-400 hover:text-amber-300 font-body">Sync log →</Link>
      </div>

      {!configured && (
        <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 font-body">
          Not configured yet. Set <code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code> and <code>QBO_REDIRECT_URI</code> in
          the Vercel environment and register the redirect URI in your Intuit developer app to enable connecting.
        </div>
      )}
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>}
      {connected && <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2 font-body">Connected to QuickBooks.</div>}
      {sp.imported === "1" && <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2 font-body">Payroll labor imported and posted to the ledger.</div>}

      {/* Connection */}
      <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Status</div>
          <div className={`font-body font-semibold ${linked ? "text-emerald-400" : "text-zinc-300"}`}>{linked ? "Connected" : "Not connected"}</div>
          {linked && <div className="text-[11px] text-zinc-500 font-body">Realm {settings.realmId} · since {fmtDateTime(settings.connectedAt)}</div>}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Company type</div>
          <div className={`font-body font-semibold ${settings.environment === "production" ? "text-red-300" : "text-white"}`}>{settings.environment}</div>
        </div>
        <div className="flex justify-end gap-2">
          {linked ? (
            <form action={disconnectQbo}>
              <SubmitButton className="text-xs font-body text-zinc-400 hover:text-red-400 bg-white/5 border border-white/10 rounded-md px-4 py-2">Disconnect</SubmitButton>
            </form>
          ) : (
            <form action={connect}>
              <SubmitButton disabled={!configured} className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed">
                Connect to QuickBooks
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {/* Environment (sandbox-first, explicit production confirm) */}
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Company environment</h3>
        <p className="text-[11px] text-zinc-500 font-body">
          Always connect a <span className="text-zinc-300">sandbox</span> company first. Pointing at a production company
          requires ticking the confirmation box, and changing the environment disconnects the current session.
        </p>
        <form action={switchEnv} className="flex flex-wrap items-center gap-3">
          <select name="environment" defaultValue={settings.environment} className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white">
            <option value="sandbox">sandbox</option>
            <option value="production">production</option>
          </select>
          <label className="text-[11px] text-zinc-400 font-body flex items-center gap-1.5">
            <input type="checkbox" name="confirm" /> I confirm switching to a production company
          </label>
          <SubmitButton className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-4 py-2">Apply</SubmitButton>
        </form>
      </div>

      {/* Payroll labor import for P&L reconciliation */}
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Import payroll labor</h3>
        <p className="text-[11px] text-zinc-500 font-body">
          Enter labor totals per department from your payroll report to reconcile the P&amp;L labor section. Mark each
          department direct or administrative: direct labor posts to 5300 (above gross profit, a cost of the build),
          administrative to 6010 (overhead). Cr Cash for the total. Once a live QuickBooks connection is in place these
          totals can be pulled automatically.
        </p>
        <form action={importPayroll} className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Period label</label>
            <input name="period" placeholder="e.g. 2026-07 or Jul 1–15" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-64" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {depts.map((d) => (
              <div key={d.id}>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">{d.name} ($)</label>
                <input name={`amt_${d.id}`} inputMode="decimal" placeholder="0.00" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full text-right" />
                <select
                  name={`kind_${d.id}`}
                  defaultValue="admin"
                  aria-label={`${d.name} labor type`}
                  className="mt-1 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 w-full"
                >
                  <option value="admin">Administrative (6010)</option>
                  <option value="direct">Direct labor (5300)</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Import & post</SubmitButton>
          </div>
        </form>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Sync is one-direction into QuickBooks and starts against a sandbox company. This is bookkeeping automation, not tax
        advice — reconcile with a qualified accountant.
      </p>
    </AppShell>
  );
}
