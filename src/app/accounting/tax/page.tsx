import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { fmtCents, dollarsToCents, LedgerError } from "@/lib/accounting";
import { fmtDate } from "@/lib/datetime";
import { taxSummary, recordTaxRemittance, listTaxRates } from "@/lib/tax";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function parseRange(sp: Record<string, string | string[] | undefined>) {
  const today = new Date();
  const y = today.getFullYear();
  const from = typeof sp.from === "string" && sp.from ? new Date(`${sp.from}T00:00:00`) : new Date(`${y}-01-01T00:00:00`);
  const to = typeof sp.to === "string" && sp.to ? new Date(`${sp.to}T23:59:59`) : today;
  return { from, to };
}

export default async function TaxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { from, to } = parseRange(sp);
  const error = typeof sp.error === "string" ? sp.error : null;
  const [summary, rates] = await Promise.all([taxSummary(from, to), listTaxRates()]);
  const activeRates = rates.filter((r) => r.isActive);

  async function remit(formData: FormData) {
    "use server";
    const session = await auth();
    try {
      await recordTaxRemittance({
        amountCents: dollarsToCents(String(formData.get("amount") ?? "")),
        paymentDate: formData.get("date") ? new Date(`${formData.get("date")}T12:00:00`) : undefined,
        jurisdiction: (String(formData.get("jurisdiction") ?? "") || null),
        memo: (String(formData.get("memo") ?? "") || null),
        createdBy: session?.user?.id ?? null,
      });
    } catch (e) {
      redirect(`/accounting/tax?error=${encodeURIComponent(e instanceof LedgerError ? e.message : "Could not record the remittance.")}`);
    }
    revalidatePath("/accounting/tax");
    redirect("/accounting/tax");
  }

  return (
    <AppShell title="Tax" subtitle="Sales-tax liability and filing summary from the ledger">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/tax/rates" className="text-xs text-amber-400 hover:text-amber-300 font-body">Tax rates →</Link>
      </div>

      <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 font-body">
        These figures are a bookkeeping summary, not tax advice. Confirm all filings and amounts with a qualified accountant.
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-body">{error}</div>}

      <form method="get" className="flex items-end gap-2 flex-wrap">
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">From
          <input type="date" name="from" defaultValue={iso(from)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white mt-1" />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">To
          <input type="date" name="to" defaultValue={iso(to)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white mt-1" />
        </label>
        <button type="submit" className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-2">Apply</button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Opening liability", value: fmtCents(summary.openingLiabilityCents) },
          { label: "Collected this period", value: fmtCents(summary.collectedCents) },
          { label: "Remitted this period", value: fmtCents(summary.remittedCents) },
          { label: "Closing liability", value: fmtCents(summary.closingLiabilityCents), strong: true },
        ].map((c) => (
          <div key={c.label} className="bg-[#161624] border border-white/5 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{c.label}</div>
            <div className={`font-mono mt-1 ${c.strong ? "text-white font-semibold text-lg font-display" : "text-white"}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500 font-body">
        {fmtDate(from)} – {fmtDate(to)}. Collected = sales tax charged on invoices; Remitted = payments to the authority.
        Closing liability is the Sales Tax Payable balance owed as of {fmtDate(to)}.
      </p>

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Record a remittance</h3>
        <form action={remit} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Amount</label>
            <input name="amount" inputMode="decimal" placeholder="0.00" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full text-right" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Date</label>
            <input type="date" name="date" defaultValue={iso(new Date())} className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1">Jurisdiction</label>
            {activeRates.length > 0 ? (
              <select name="jurisdiction" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full">
                <option value="">—</option>
                {activeRates.map((r) => <option key={r.id} value={r.jurisdiction}>{r.jurisdiction}</option>)}
              </select>
            ) : (
              <input name="jurisdiction" placeholder="optional" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
            )}
          </div>
          <div className="flex gap-2">
            <input name="memo" placeholder="memo (optional)" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 whitespace-nowrap">Record</button>
          </div>
        </form>
        <p className="text-[10px] text-zinc-500 font-body">Posts Dr Sales Tax Payable / Cr Cash.</p>
      </div>
    </AppShell>
  );
}
