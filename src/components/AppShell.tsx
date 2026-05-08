import { auth, signOut } from "@/auth";
import { TopNav } from "@/components/TopNav";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlobalSearch } from "@/components/GlobalSearch";

export async function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between gap-6">
        <div className="shrink-0">
          <h1 className="text-lg font-display font-bold text-white">
            Chiefs Pursuit Surplus
          </h1>
          <p className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
            ERP/CRM · Internal
          </p>
        </div>
        <div className="flex-1 flex justify-center">
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-xs text-white font-body font-semibold">
              {session?.user?.name ?? session?.user?.email}
            </div>
            <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
              {session?.user?.role}
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="text-xs text-zinc-400 hover:text-white font-body bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <TopNav />
      <Breadcrumbs />

      <section className="p-6 space-y-5">
        <div>
          <h2 className="text-xl font-display font-bold text-white">{title}</h2>
          {subtitle ? (
            <p className="text-xs text-zinc-500 font-body mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </section>
    </main>
  );
}
