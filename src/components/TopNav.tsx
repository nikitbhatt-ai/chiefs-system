"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavItem = { href: string; label: string; roles?: readonly string[] };
type NavGroup = { label: string; href?: string; children?: NavItem[]; roles?: readonly string[] };

const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/" },
  { label: "Workflow", href: "/workflow" },
  {
    label: "CRM",
    children: [
      { href: "/crm", label: "Customers" },
      { href: "/leads", label: "Leads" },
      { href: "/deals", label: "Deals" },
      { href: "/pipeline", label: "Pipeline (kanban)" },
      { href: "/quotes", label: "Quotes" },
      { href: "/partners", label: "Partners" },
    ],
  },
  {
    label: "Operations",
    children: [
      { href: "/work-orders", label: "Work Orders" },
      { href: "/vehicles", label: "Vehicles" },
      { href: "/inventory", label: "Inventory" },
      { href: "/packages", label: "Packages" },
      { href: "/purchase-orders", label: "Purchase Orders" },
      { href: "/invoices", label: "Invoices" },
      { href: "/procurement", label: "Procurement" },
      { href: "/vendors", label: "Vendors" },
    ],
  },
  {
    label: "Admin",
    children: [
      // Accounting is admin-only — the matching page layout and API routes
      // enforce the same restriction server-side; this just hides the link.
      { href: "/accounting", label: "Accounting", roles: ["admin"] },
      { href: "/timeclock", label: "Timeclock" },
      { href: "/reporting", label: "Reporting" },
      { href: "/users", label: "Users" },
      { href: "/settings/lookups", label: "Settings (lookups)" },
      { href: "/settings/sla", label: "Settings (stage SLAs)" },
      { href: "/settings/stage-mapping", label: "Settings (stage mapping)" },
      { href: "/settings/lead-capture-test", label: "Settings (lead-capture test)" },
    ],
  },
];

// Show an item/group to everyone unless it declares `roles`, in which case the
// current user's role must be in the list.
function visibleFor(role: string | null | undefined, roles?: readonly string[]): boolean {
  if (!roles) return true;
  return !!role && roles.includes(role);
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isGroupActive(pathname: string, group: NavGroup): boolean {
  if (group.href) return isActive(pathname, group.href);
  return !!group.children?.some((c) => isActive(pathname, c.href));
}

export function TopNav({ role }: { role?: string | null }) {
  const pathname = usePathname() || "/";
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Filter the nav to what this role may see: drop role-gated items, then drop
  // any group left with no visible children.
  const nav = NAV.filter((group) => visibleFor(role, group.roles))
    .map((group) =>
      group.children
        ? { ...group, children: group.children.filter((c) => visibleFor(role, c.roles)) }
        : group,
    )
    .filter((group) => !group.children || group.children.length > 0);

  useEffect(() => { setOpenIdx(null); }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target as Node)) setOpenIdx(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIdx(null);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <nav className="border-b border-white/5 px-4 sm:px-6" ref={navRef}>
      <ul className="flex flex-wrap gap-1 overflow-visible">
        {nav.map((group, idx) => {
          const active = isGroupActive(pathname, group);
          const baseClasses = "inline-block px-3 py-2.5 text-xs font-body border-b-2 transition-colors whitespace-nowrap";
          const stateClasses = active
            ? "text-white border-amber-500"
            : "text-zinc-400 hover:text-white border-transparent hover:border-amber-500/50";

          if (!group.children) {
            return (<li key={group.label}><Link href={group.href!} className={`${baseClasses} ${stateClasses}`}>{group.label}</Link></li>);
          }

          const isOpen = openIdx === idx;
          return (
            <li key={group.label} className="relative">
              <button type="button" onClick={() => setOpenIdx(isOpen ? null : idx)} aria-haspopup="menu" aria-expanded={isOpen} className={`${baseClasses} ${stateClasses} flex items-center gap-1 cursor-pointer`}>
                {group.label}
                <svg className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isOpen ? (
                <div role="menu" className="absolute left-0 top-full mt-0 z-50 min-w-[180px] bg-zinc-950 border border-white/10 rounded-md shadow-lg py-1">
                  {group.children.map((child) => {
                    const childActive = isActive(pathname, child.href);
                    return (<Link key={child.href} href={child.href} role="menuitem" className={`block px-3 py-2 text-xs font-body transition-colors ${childActive ? "text-white bg-white/5" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}>{child.label}</Link>);
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
