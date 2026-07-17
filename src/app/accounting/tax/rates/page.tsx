import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppShell } from "@/components/AppShell";
import { LedgerError } from "@/lib/accounting";
import { listTaxRates, addTaxRate, setTaxRateActive } from "@/lib/tax";

export const dynamic = "force-dynamic";

export default async function TaxRatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const rates = await listTaxRates();

  async function add(formData: FormData) {
    "use server";
    try {
      await addTaxRate(String(formData.get("jurisdiction") ?? ""), String(formData.get("rate") ?? ""), String(formData.get("notes") ?? "") || null);
    } catch (e) {
      redirect(`/accounting/tax/rates?error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Could not add the rate.")}`);
    }
    revalidatePath("/accounting/tax/rates");
    redirect("/accounting/tax/rates");
  }
  async function toggle(formData: FormData) {
    "use server";
    await setTaxRateActive(String(formData.get("id") ?? ""), formData.get("active") === "true");
    revalidatePath("/accounting/tax/rates");
  }

  return (
    <AppShell title="Tax rates" subtitle="Configurable jurisdictions and rates — nothing is hardcoded">
      <Link href="/accounting/tax" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Tax</Link>

      <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 font-body">
        Enter the rates that apply to your jurisdictions. These are a reference for your team — confirm current rates with a qualified accountant.
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>}

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <form action={add} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Jurisdiction</label>
            <input name="jurisdiction" placeholder="e.g. Missouri — Jackson County" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Rate %</label>
            <input name="rate" inputMode="decimal" placeholder="8.25" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full text-right" />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <input name="notes" placeholder="notes (optional)" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add</button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Jurisdiction</th>
              <th className="px-4 py-2.5 text-right">Rate</th>
              <th className="px-4 py-2.5">Notes</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rates.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">No rates configured yet — add one above.</td></tr>
            ) : (
              rates.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{r.jurisdiction}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{Number(r.ratePct).toFixed(3)}%</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{r.notes ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${r.isActive ? "text-emerald-400 bg-emerald-500/10" : "text-zinc-500 bg-white/5"}`}>
                      {r.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={r.isActive ? "false" : "true"} />
                      <button type="submit" className="text-[11px] font-body text-zinc-400 hover:text-white bg-white/5 border border-white/10 rounded-md px-3 py-1">
                        {r.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
