import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lookups } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  { slug: "source", label: "Lead sources" },
  { slug: "sub_source", label: "Sub-sources (nest under a source)" },
  { slug: "credential_type", label: "Credential types" },
  { slug: "trade_show", label: "Trade shows" },
  { slug: "social_platform", label: "Social platforms" },
  { slug: "department", label: "Departments" },
];

async function createLookup(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;
  const category = String(formData.get("category") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  const sortOrder = Number(formData.get("sortOrder") ?? 0) || 0;
  if (!category || !value) return;
  await db.insert(lookups).values({ category, value, parentId, sortOrder });
  revalidatePath("/settings/lookups");
}

async function toggleLookup(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  if (!id) return;
  await db.update(lookups).set({ active }).where(eq(lookups.id, id));
  revalidatePath("/settings/lookups");
}

async function deleteLookup(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(lookups).where(eq(lookups.id, id));
  revalidatePath("/settings/lookups");
}

export default async function LookupsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return (
      <AppShell title="Settings" subtitle="Admin only">
        <div className="bg-surface border border-red-500/30 rounded-lg p-4 text-xs font-body text-red-300">
          You need the <strong>admin</strong> role to manage settings.
        </div>
      </AppShell>
    );
  }
  const params = await searchParams;
  const category = params.category ?? "source";
  if (!CATEGORIES.some((c) => c.slug === category)) redirect("/settings/lookups?category=source");
  const all = await db.select().from(lookups).orderBy(asc(lookups.sortOrder), asc(lookups.value));
  const rows = all.filter((r) => r.category === category);
  const sources = all.filter((r) => r.category === "source" && r.active);
  const parentMap = new Map(sources.map((s) => [s.id, s.value]));
  return (
    <AppShell title="Lookups" subtitle="Admin-editable dropdown options">
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <a key={c.slug} href={`/settings/lookups?category=${c.slug}`} className={`text-[11px] font-body px-3 py-1.5 rounded-md border ${category === c.slug ? "bg-amber-500/10 border-amber-500/40 text-amber-300" : "border-white/10 text-zinc-400 hover:text-white"}`}>{c.label}</a>
        ))}
      </div>
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">Add option</h3>
        <form action={createLookup} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input type="hidden" name="category" value={category} />
          <input name="value" required placeholder="Value" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          {category === "sub_source" ? (
            <select name="parentId" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
              <option value="">— Parent source —</option>
              {sources.map((s) => (<option key={s.id} value={s.id}>{s.value}</option>))}
            </select>
          ) : (<input type="hidden" name="parentId" value="" />)}
          <input name="sortOrder" type="number" placeholder="Sort order" defaultValue="0" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add</SubmitButton>
        </form>
      </div>
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2">Value</th>
              {category === "sub_source" && <th className="px-3 py-2">Parent</th>}
              <th className="px-3 py-2">Sort</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={category === "sub_source" ? 5 : 4} className="px-4 py-8 text-center text-xs text-zinc-500">No options yet — add the first one above.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-xs text-white">{r.value}</td>
                  {category === "sub_source" && (<td className="px-3 py-2 text-xs text-zinc-400">{r.parentId ? parentMap.get(r.parentId) ?? "—" : "—"}</td>)}
                  <td className="px-3 py-2 text-xs text-zinc-500">{r.sortOrder}</td>
                  <td className="px-3 py-2 text-xs">
                    <form action={toggleLookup} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                      <SubmitButton className={`text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${r.active ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"}`}>{r.active ? "Active" : "Inactive"}</SubmitButton>
                    </form>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <form action={deleteLookup} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="text-[11px] text-zinc-500 hover:text-red-400">Delete</SubmitButton>
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
