import Link from "next/link";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents, dollarsToCents, centsToDollars } from "@/lib/accounting";
import { defaultLaborRateCents, laborRateMap, setLaborRate } from "@/lib/laborRates";
import { RateInput } from "@/components/accounting/RateInput";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function LaborRatesPage() {
  const [staff, rateMap, defaultCents] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, displayName: users.displayName, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.displayName)),
    laborRateMap(),
    defaultLaborRateCents(),
  ]);

  async function saveRate(formData: FormData) {
    "use server";
    const raw = String(formData.get("userId") ?? "");
    const userId = raw === "__default__" ? null : raw;
    const rateCents = dollarsToCents(String(formData.get("rate") ?? ""));
    await setLaborRate(userId, rateCents);
    revalidatePath("/accounting/labor-rates");
  }

  return (
    <AppShell title="Labor rates" subtitle="Hourly cost rate per tech — drives job-costing labor from the time clock">
      <div className="flex items-center gap-3">
        <Link href="/accounting/job-costing" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Job costing</Link>
      </div>

      {defaultCents <= 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-body text-amber-200">
          <span className="font-semibold">No shop default rate is set.</span> Until one is, any tech without their own
          rate has their clocked hours valued at $0 — so job costs and build margins are understated everywhere. Set
          the Shop default below.
        </div>
      )}

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5 text-right">Current rate</th>
              <th className="px-4 py-2.5 text-right">Set hourly rate ($)</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            <tr className="border-t border-white/5 bg-white/[0.02]">
              <td className="px-4 py-2.5 text-white font-semibold">Shop default</td>
              <td className="px-4 py-2.5 text-xs text-zinc-500">fallback for anyone without an override</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(defaultCents)}/h</td>
              <td className="px-4 py-2.5 text-right">
                <form action={saveRate} className="flex justify-end gap-2 items-center">
                  <input type="hidden" name="userId" value="__default__" />
                  <RateInput
                    name="rate"
                    ariaLabel="Shop default hourly cost rate in dollars"
                    defaultValue={defaultCents ? centsToDollars(defaultCents) : ""}
                    placeholder="0.00"
                  />
                  <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5">Save</SubmitButton>
                </form>
              </td>
            </tr>
            {staff.map((u) => {
              const cents = rateMap.get(u.id);
              return (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{u.displayName || u.name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs capitalize text-zinc-400">{u.role}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{cents != null ? `${fmtCents(cents)}/h` : <span className="text-zinc-600">(default)</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={saveRate} className="flex justify-end gap-2 items-center">
                      <input type="hidden" name="userId" value={u.id} />
                      <RateInput
                        name="rate"
                        ariaLabel={`Hourly cost rate in dollars for ${u.displayName || u.name || "this person"}`}
                        defaultValue={cents != null ? centsToDollars(cents) : ""}
                      />
                      <SubmitButton className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-1.5">Save</SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Rates are a cost basis for job costing (labor hours × rate), not payroll. Leave a person blank to use the shop
        default. Job-cost labor recomputes from these rates and the time clock every time you view a job.
      </p>
    </AppShell>
  );
}
