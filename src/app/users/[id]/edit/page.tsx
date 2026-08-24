import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";

const ROLES = ["admin", "manager", "sales", "warehouse", "tech", "accountant"] as const;
type Role = (typeof ROLES)[number];

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return (
      <AppShell title="Users" subtitle="Admin only">
        <div className="bg-surface border border-red-500/30 rounded-lg p-4 text-xs font-body text-red-300">
          Admin access required.
        </div>
      </AppShell>
    );
  }

  const { id } = await params;
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) notFound();

  async function update(formData: FormData) {
    "use server";
    const session = await auth();
    if (session?.user?.role !== "admin") return;

    const name = String(formData.get("name") ?? "").trim() || null;
    const role = String(formData.get("role") ?? "sales") as Role;
    const active = formData.get("active") === "on";
    const newPassword = String(formData.get("newPassword") ?? "");

    const update: Record<string, unknown> = {
      name,
      role: ROLES.includes(role) ? role : "sales",
      active,
      updatedAt: new Date(),
    };
    if (newPassword.length >= 8) {
      update.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    await db.update(users).set(update).where(eq(users.id, id));
    revalidatePath("/users");
    redirect("/users");
  }

  return (
    <AppShell title="Edit user" subtitle={u.email}>
      <form
        action={update}
        className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl"
      >
        <div className="md:col-span-2 text-[11px] text-zinc-500 font-body">
          Email is permanent and managed by Auth.js: <span className="text-white font-mono">{u.email}</span>
        </div>
        <input
          name="name"
          defaultValue={u.name ?? ""}
          placeholder="Full name"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <select
          name="role"
          defaultValue={u.role}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-zinc-300 font-body md:col-span-2">
          <input type="checkbox" name="active" defaultChecked={u.active} />
          Active (uncheck to disable sign-in without deleting the account)
        </label>
        <input
          name="newPassword"
          type="password"
          minLength={8}
          placeholder="Set new password (leave blank to keep)"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
        />
        <div className="md:col-span-2 flex justify-end gap-2">
          <a
            href="/users"
            className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors"
          >
            Cancel
          </a>
          <SubmitButton
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Save changes
          </SubmitButton>
        </div>
      </form>
    </AppShell>
  );
}
