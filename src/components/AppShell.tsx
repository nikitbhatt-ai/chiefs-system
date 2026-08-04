import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { TopNav } from "@/components/TopNav";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ThemeToggle } from "@/components/ThemeToggle";

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

  let unreadCount = 0;
  if (session?.user) {
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));
    unreadCount = unread.length;
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/5 px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="shrink-0">
          <h1 className="text-base sm:text-lg font-display font-bold text-white">
            Chiefs Pursuit Surplus
          </h1>
          <p className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
            ERP/CRM · Internal
          </p>
        </div>
        <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1 flex justify-center">
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <ThemeToggle />
          <Link
            href="/notifications"
            className="relative inline-flex items-center justify-center text-zinc-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
            aria-label="Notifications"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2v1M5 5a3 3 0 116 0v3l1.5 2H3.5L5 8V5z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 12.5a1.5 1.5 0 003 0" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[9px] font-body font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <div className="text-right hidden sm:block">
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

      <TopNav role={session?.user?.role ?? null} />
      <Breadcrumbs />

      <section className="p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg sm:text-xl font-display font-bold text-white">{title}</h2>
          {subtitle ? (
            <p className="text-xs text-zinc-500 font-body mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </section>
    </main>
  );
}
