"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTION_LABELS: Record<string, string> = {
  "": "Dashboard",
  workflow: "Workflow",
  crm: "Customers",
  leads: "Leads",
  quotes: "Quotes",
  "work-orders": "Work Orders",
  vehicles: "Vehicles",
  inventory: "Inventory",
  packages: "Packages",
  "purchase-orders": "Purchase Orders",
  vendors: "Vendors",
  timeclock: "Timeclock",
  reporting: "Reporting",
  users: "Users",
  deals: "Deals",
  setup: "Setup",
  signin: "Sign in",
};

const SECTION_PARENT: Record<string, string> = {
  workflow: "Workflow",
  crm: "CRM",
  leads: "CRM",
  quotes: "CRM",
  "work-orders": "Operations",
  vehicles: "Operations",
  inventory: "Operations",
  packages: "Operations",
  "purchase-orders": "Operations",
  vendors: "Operations",
  timeclock: "Admin",
  reporting: "Admin",
  users: "Admin",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prettifySegment(seg: string): string {
  if (UUID_RE.test(seg)) return seg.slice(0, 8);
  return seg
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function Breadcrumbs() {
  const pathname = usePathname() || "/";
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; href?: string }[] = [
    { label: "Dashboard", href: "/" },
  ];

  if (segments.length > 0) {
    const section = segments[0];
    const parent = SECTION_PARENT[section];
    if (parent) crumbs.push({ label: parent });

    let acc = "";
    segments.forEach((seg, i) => {
      acc += `/${seg}`;
      const label =
        i === 0
          ? SECTION_LABELS[seg] ?? prettifySegment(seg)
          : prettifySegment(seg);
      const isLast = i === segments.length - 1;
      crumbs.push({ label, href: isLast ? undefined : acc });
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="px-4 sm:px-6 py-2 border-b border-white/5">
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-body text-zinc-500">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden className="text-zinc-700">
                  /
                </span>
              ) : null}
              {c.href && !isLast ? (
                <Link
                  href={c.href}
                  className="hover:text-white transition-colors"
                >
                  {c.label}
                </Link>
              ) : (
                <span className={isLast ? "text-zinc-300" : ""}>{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
