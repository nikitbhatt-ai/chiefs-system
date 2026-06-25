import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

const ROLES = ["admin", "manager", "sales", "warehouse", "tech", "accountant"] as const;
type Role = (typeof ROLES)[number];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/10 text-red-300 border-red-500/30",
  manager: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  sales: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  warehouse: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  tech: "bg-green-500/10 text-green-300 border-green-500/30",
  accountant: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
};

async function createUser(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "sales") as Role;
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(users).values({
    email,
    name,
    role: ROLES.includes(role) ? role : "sales",
    passwordHash,
    active: true,
  });
  revalidatePath("/users");
}

async function toggleActive(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  if (!id) return;
  await db
    .update(users)
    .set({ active, updatedAt: new Date() })
    .where(eq(users.id, id));
  revalidatePath("/users");
}

export default async function UsersPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return (
      <AppShell title="Users" subtitle="Admin only">
        <div className="bg-[#161624] border border-red-500/30 rounded-lg p-4 text-xs font-body text-red-300">
          You need the <strong>admin</strong> role to manage users. Contact an
          administrator.
        </div>
      </AppShell>
    );
  }

  const rows = await db.select().from(users).orderBy(desc(users.createdAt));

  return (
    <AppShell title="Users" subtitle="Team accounts and roles">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          Add user
        </h3>
        <form action={createUser} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="Email *"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <input
            name="name"
            placeholder="Full name"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <select
            name="role"
            defaultValue="sales"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            required
            placeholder="Initial password *"
            minLength={8}
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <p className="md:col-span-2 text-[11px] text-zinc-500 -mt-1">
            User can change their password after signing in. Minimum 8 characters.
          </p>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Create user
            </button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No users yet.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-xs text-white">{u.email}</td>
                  <td className="px-4 py-2.5 text-xs">{u.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${ROLE_COLORS[u.role]}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {u.active ? (
                      <span className="text-green-400">Active</span>
                    ) : (
                      <span className="text-zinc-500">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <a
                      href={`/users/${u.id}/edit`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Edit
                    </a>
                    <form action={toggleActive} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                      <button
                        type="submit"
                        className="text-[11px] text-zinc-500 hover:text-white font-body"
                      >
                        {u.active ? "Disable" : "Enable"}
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
