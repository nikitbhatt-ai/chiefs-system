import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { listSyncLog } from "@/lib/qbo";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  ok: "text-emerald-400 bg-emerald-500/10",
  error: "text-red-400 bg-red-500/10",
  info: "text-zinc-400 bg-white/5",
};

export default async function QboSyncLogPage() {
  const rows = await listSyncLog();

  return (
    <AppShell title="QuickBooks sync log" subtitle="Every connection, mapping, and import attempt">
      <Link href="/accounting/quickbooks" className="text-xs text-amber-400 hover:text-amber-300 font-body">← QuickBooks</Link>

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Direction</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Message</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">No sync activity yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5 text-xs">{r.action}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{r.direction ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 ${STATUS_STYLE[r.status] ?? STATUS_STYLE.info}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{r.message ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
