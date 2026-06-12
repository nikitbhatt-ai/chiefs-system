import Link from "next/link";

type Tab = "quote" | "upfit";

export function QuoteTabs({ quoteId, active }: { quoteId: string; active: Tab }) {
  const tabs: { key: Tab; label: string; href: string }[] = [
    { key: "quote", label: "Quote", href: `/quotes/${quoteId}` },
    { key: "upfit", label: "Upfit builder", href: `/quotes/${quoteId}/upfit` },
  ];
  return (
    <div className="flex gap-1 border-b border-white/10">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`text-[11px] font-body px-4 py-2 border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-amber-500 text-white font-semibold"
                : "border-transparent text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
