import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/leads", label: "Leads" },
  { href: "/quotes", label: "Quotes" },
  { href: "/vehicles", label: "Vehicles" },
  { href: "/inventory", label: "Inventory" },
  { href: "/work-orders", label: "Work Orders" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/timeclock", label: "Timeclock" },
  { href: "/reporting", label: "Reporting" },
];

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold text-white">
            Chiefs Pursuit Surplus
          </h1>
          <p className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
            ERP/CRM · Internal
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      <nav className="border-b border-white/5 px-6">
        <ul className="flex gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="inline-block px-3 py-2.5 text-xs font-body text-zinc-400 hover:text-white border-b-2 border-transparent hover:border-amber-500/50 transition-colors whitespace-nowrap"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section className="p-6 space-y-5">
        <div>
          <h2 className="text-xl font-display font-bold text-white">
            Dashboard
          </h2>
          <p className="text-xs text-zinc-500 font-body mt-0.5">
            Operational overview
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Open Deals", value: "—" },
            { label: "Vehicles On Lot", value: "—" },
            { label: "Work Orders In Progress", value: "—" },
            { label: "POs Pending Receipt", value: "—" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-[#161624] border border-white/5 rounded-lg p-4"
            >
              <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
                {stat.label}
              </div>
              <div className="text-2xl font-display font-bold text-white mt-1">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#161624] border border-amber-500/20 rounded-lg p-4">
          <div className="text-[10px] text-amber-400 font-body font-semibold uppercase tracking-wider mb-1">
            Build status
          </div>
          <p className="text-xs text-zinc-300 font-body leading-relaxed">
            Scaffold is live. Next: transcribing CRM, Vehicles, Quotes,
            Work Orders, Inventory, Purchase Orders, Timeclock, and Reporting
            from the recovered source in <code className="text-amber-400">_reference/deobfuscated.js</code>.
          </p>
        </div>
      </section>
    </main>
  );
}
