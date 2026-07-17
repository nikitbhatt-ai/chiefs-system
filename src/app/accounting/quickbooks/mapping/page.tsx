import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { listAccountMappings, setAccountMapping } from "@/lib/qbo";

export const dynamic = "force-dynamic";

export default async function QboMappingPage() {
  const rows = await listAccountMappings();

  async function save(formData: FormData) {
    "use server";
    const session = await auth();
    await setAccountMapping(
      String(formData.get("glId") ?? ""),
      (String(formData.get("qboId") ?? "").trim() || null),
      (String(formData.get("qboName") ?? "").trim() || null),
      session?.user?.id ?? null,
    );
    revalidatePath("/accounting/quickbooks/mapping");
  }

  const mappedCount = rows.filter((r) => r.qboAccountId || r.qboAccountName).length;

  return (
    <AppShell title="QuickBooks account mapping" subtitle="Map each ledger account to its QuickBooks counterpart">
      <Link href="/accounting/quickbooks" className="text-xs text-amber-400 hover:text-amber-300 font-body">← QuickBooks</Link>
      <p className="text-[11px] text-zinc-500 font-body">
        {mappedCount} of {rows.length} accounts mapped. Enter the QuickBooks account name (and id, if you have it) that each
        of our accounts corresponds to. Sync uses this mapping to route entries to the right QuickBooks account.
      </p>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Our account</th>
              <th className="px-4 py-2.5">QBO account name</th>
              <th className="px-4 py-2.5">QBO account id</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.map((r) => (
              <tr key={r.glId} className="border-t border-white/5">
                <td className="px-4 py-2 text-xs whitespace-nowrap">
                  <span className="font-mono text-zinc-500">{r.code}</span> <span className="text-white">{r.name}</span>
                  <span className="text-zinc-600"> · {r.type}</span>
                </td>
                <td className="px-4 py-2" colSpan={2}>
                  <form action={save} className="flex gap-2 items-center">
                    <input type="hidden" name="glId" value={r.glId} />
                    <input name="qboName" defaultValue={r.qboAccountName ?? ""} placeholder="QBO account name" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-full" />
                    <input name="qboId" defaultValue={r.qboAccountId ?? ""} placeholder="QBO id (optional)" className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white w-40" />
                    <button type="submit" className="text-[11px] font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-1.5 whitespace-nowrap">Save</button>
                  </form>
                </td>
                <td className="px-4 py-2 text-center">
                  {r.qboAccountId || r.qboAccountName ? <span className="text-emerald-400 text-xs">✓</span> : <span className="text-zinc-600 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
