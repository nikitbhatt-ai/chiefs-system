import Link from "next/link";

export function KpiCard({
  label,
  value,
  hint,
  href,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  accent?: "amber" | "green" | "red" | "blue" | "zinc";
}) {
  const accentClass: Record<string, string> = {
    amber: "text-amber-300",
    green: "text-green-300",
    red: "text-red-300",
    blue: "text-blue-300",
    zinc: "text-white",
  };
  const valueColor = accentClass[accent ?? "zinc"];
  const body = (
    <div className="bg-surface border border-white/5 rounded-lg p-4 hover:border-amber-500/30 transition-colors h-full">
      <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-display font-bold mt-1 ${valueColor}`}>{value}</div>
      {hint ? <div className="text-[10px] text-zinc-500 font-body mt-1">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
