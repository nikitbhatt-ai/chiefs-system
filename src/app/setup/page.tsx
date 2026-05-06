import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

type LoadState =
  | { kind: "ready"; adminCount: number }
  | { kind: "schema-missing" }
  | { kind: "error"; message: string };

async function loadState(): Promise<LoadState> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, "admin"));
    return { kind: "ready", adminCount: row?.count ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('relation "users" does not exist') ||
      msg.includes("does not exist") ||
      msg.includes("undefined_table")
    ) {
      return { kind: "schema-missing" };
    }
    return { kind: "error", message: msg };
  }
}

async function createFirstAdmin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "")
    .toLowerCase()
    .trim();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const errors: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid-email");
  if (!name) errors.push("name-required");
  if (password.length < 8) errors.push("password-short");
  if (password !== confirm) errors.push("password-mismatch");

  if (errors.length) {
    redirect(`/setup?errors=${encodeURIComponent(errors.join(","))}`);
  }

  // Re-check inside the action: refuse if any admin already exists.
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  if (existingAdmin) {
    redirect("/signin");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Insert or upgrade an existing row with the same email.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash,
        name,
        displayName: name,
        role: "admin",
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      email,
      passwordHash,
      name,
      displayName: name,
      role: "admin",
      active: true,
    });
  }

  redirect("/signin?setup=ok");
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ errors?: string }>;
}) {
  const state = await loadState();
  const params = await searchParams;
  const errorList = (params.errors ?? "").split(",").filter(Boolean);

  if (state.kind === "ready" && state.adminCount > 0) {
    redirect("/signin");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md bg-[#161624] border border-white/5 rounded-xl p-8 space-y-6">
        <div>
          <div className="text-[10px] text-amber-400 font-body font-semibold uppercase tracking-wider">
            First-time setup
          </div>
          <h1 className="text-2xl font-display font-bold text-white mt-1">
            Create the first admin
          </h1>
          <p className="text-xs text-zinc-500 font-body mt-1 leading-relaxed">
            This page only works once. After an admin exists, it
            automatically redirects to sign-in.
          </p>
        </div>

        {state.kind === "schema-missing" ? (
          <SchemaMissing />
        ) : state.kind === "error" ? (
          <div className="text-xs font-body text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <div className="font-semibold">Database error</div>
            <div className="mt-1 text-zinc-400 break-words">{state.message}</div>
          </div>
        ) : (
          <FormBlock errorList={errorList} action={createFirstAdmin} />
        )}
      </div>
    </main>
  );
}

function FormBlock({
  errorList,
  action,
}: {
  errorList: string[];
  action: (formData: FormData) => Promise<void>;
}) {
  const errMsg = (code: string) => {
    switch (code) {
      case "invalid-email":
        return "Enter a valid email.";
      case "name-required":
        return "Name is required.";
      case "password-short":
        return "Password must be at least 8 characters.";
      case "password-mismatch":
        return "Passwords don't match.";
      default:
        return null;
    }
  };

  return (
    <>
      {errorList.length > 0 && (
        <div className="text-xs font-body text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 space-y-1">
          {errorList.map((c) => (
            <div key={c}>{errMsg(c)}</div>
          ))}
        </div>
      )}

      <form action={action} className="space-y-3">
        <div>
          <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
            Your name
          </label>
          <input
            name="name"
            required
            placeholder="Jane Doe"
            className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@chiefspursuitsurplus.com"
            className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 focus:outline-none focus:border-amber-500/50"
          />
          <div className="text-[10px] text-zinc-600 font-body mt-1">
            8 characters minimum.
          </div>
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
            Confirm password
          </label>
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-amber-500 text-black hover:bg-amber-400 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
        >
          Create admin and continue
        </button>
      </form>
    </>
  );
}

function SchemaMissing() {
  return (
    <div className="text-xs font-body text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 space-y-2 leading-relaxed">
      <div className="font-semibold">Database tables don&apos;t exist yet</div>
      <div className="text-zinc-300">
        Open the Vercel dashboard → your Postgres store → <em>Query</em> tab,
        paste the contents of <code className="text-amber-400">_reference/initial-schema.sql</code>{" "}
        from the repo, and run it once. Then refresh this page.
      </div>
      <div className="text-zinc-500 text-[10px]">
        It&apos;s safe to run the SQL multiple times against an empty database;
        if some objects already exist, only the missing ones will be added.
      </div>
    </div>
  );
}
