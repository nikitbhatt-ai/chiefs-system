import Link from "next/link";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents, dollarsToCents, centsToDollars } from "@/lib/accounting";
import { defaultLaborRateCents, laborRateMap, setLaborRate } from "@/lib/jobCosting";

export const dynamic = "force-dynamic";

const inputCls = "bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-32 text-right";

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

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
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
                  <input name="rate" inputMode="decimal" defaultValue={defaultCents ? centsToDollars(defaultCents) : ""} placeholder="0.00" className={inputCls} />
                  <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5">Save</button>
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
                      <input name="rate" inputMode="decimal" defaultValue={cents != null ? centsToDollars(cents) : ""} placeholder="0.00" className={inputCls} />
                      <button type="submit" className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-1.5">Save</button>
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
