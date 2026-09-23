import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { can } from "@/lib/rbac";
import { getLotRows, type LotRow } from "@/lib/lotQuery";
import {
  daysOnLot,
  shortVin,
  LOT_STATUSES,
  LOT_STATUS_LABELS,
  OWNERSHIPS,
  OWNERSHIP_LABELS,
  type LotFilters,
  type LotStatus,
  type Ownership,
} from "@/lib/lot";
import { LotStatusControl, StatusBadge } from "./LotStatusControl";
import { AttachToDealButton } from "@/components/AttachToDealButton";

export const metadata = { title: "Lot" };
// Days-on-lot moves with the clock, so this page is never cached.
export const dynamic = "force-dynamic";

type SP = {
  ownership?: string;
  status?: string;
  deal?: string;
  q?: string;
};

function parseFilters(sp: SP): LotFilters {
  const ownership =
    sp.ownership === "unset"
      ? "unset"
      : OWNERSHIPS.includes(sp.ownership as Ownership)
        ? (sp.ownership as Ownership)
        : null;
  const lotStatus = LOT_STATUSES.includes(sp.status as LotStatus)
    ? (sp.status as LotStatus)
    : null;
  const deal = sp.deal === "has" || sp.deal === "none" ? sp.deal : null;
  return { ownership, lotStatus, deal, q: sp.q?.trim() || null };
}

export default async function LotPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const canEditStatus = can(session, "vehicle:setLotStatus");
  // Attaching a vehicle to a deal is commercial, so office and admin only.
  const canLinkDeal = can(session, "vehicle:linkDeal");
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const rows = await getLotRows(filters);
  const now = new Date();

  const onSite = rows.filter((r) => r.lotStatus !== "departed").length;
  const unassigned = rows.filter(
    (r) => r.lotStatus !== "departed" && !r.dealId,
  ).length;
  const measured = rows
    .map((r) => daysOnLot(r.arrivedAt, r.departedAt, now))
    .filter((d): d is number => d !== null);
  const oldest = measured.length ? Math.max(...measured) : null;

  return (
    <AppShell title="Lot" subtitle="Everything on site, longest-sitting first">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2.5 max-w-xl">
          <Stat label="On site" value={String(onSite)} />
          <Stat label="No deal" value={String(unassigned)} />
          <Stat
            label="Longest stay"
            value={oldest === null ? "—" : `${oldest}d`}
            tone={oldest !== null && oldest >= 30 ? "warn" : undefined}
          />
        </div>

        <Filters sp={sp} />

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-400 font-body bg-surface border border-white/5 rounded-lg p-6 text-center">
            Nothing matches. {sp.q || sp.ownership || sp.status || sp.deal ? (
              <Link href="/lot" className="text-amber-400 underline">
                Clear the filters
              </Link>
            ) : (
              <>
                Vehicles appear here once they are{" "}
                <Link href="/lot/check-in" className="text-amber-400 underline">
                  checked in
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <>
            {/* Desktop: a table, because comparing rows is the whole job. */}
            <div className="hidden lg:block bg-surface border border-white/5 rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] font-body uppercase tracking-wider text-zinc-500">
                    <th className="px-3 py-2.5 font-semibold w-16"></th>
                    <th className="px-3 py-2.5 font-semibold">VIN</th>
                    <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                    <th className="px-3 py-2.5 font-semibold">Owner</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Location</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Days</th>
                    <th className="px-3 py-2.5 font-semibold">Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const days = daysOnLot(r.arrivedAt, r.departedAt, now);
                    return (
                      <tr key={r.vehicleId} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5">
                          <Thumb url={r.frontPhotoUrl} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[13px] text-white whitespace-nowrap">
                          {shortVin(r.vin)}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-zinc-200">
                          {describe(r)}
                        </td>
                        <td className="px-3 py-2.5 text-[13px]">
                          <Owner ownership={r.ownership} />
                        </td>
                        <td className="px-3 py-2.5">
                          <LotStatusControl
                            vehicleId={r.vehicleId}
                            value={r.lotStatus}
                            canEdit={canEditStatus}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-zinc-300">
                          {r.lotLocation ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Days days={days} />
                        </td>
                        <td className="px-3 py-2.5 text-[13px]">
                          <Deal row={r} canLink={canLinkDeal} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards, because a table on a phone is a scroll puzzle. */}
            <div className="lg:hidden space-y-2.5">
              {rows.map((r) => {
                const days = daysOnLot(r.arrivedAt, r.departedAt, now);
                return (
                  <div key={r.vehicleId} className="bg-surface border border-white/5 rounded-lg p-3">
                    <div className="flex gap-3">
                      <Thumb url={r.frontPhotoUrl} large />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-[13px] text-white">{shortVin(r.vin)}</p>
                            <p className="text-sm text-zinc-200 truncate">{describe(r)}</p>
                          </div>
                          <Days days={days} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-400">
                          <Owner ownership={r.ownership} />
                          <span>{r.lotLocation ?? "No location"}</span>
                        </div>
                        <div className="mt-1 text-[12px]">
                          <Deal row={r} canLink={canLinkDeal} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <LotStatusControl
                        vehicleId={r.vehicleId}
                        value={r.lotStatus}
                        canEdit={canEditStatus}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function describe(r: LotRow): string {
  const label = [r.year, r.make, r.model].filter(Boolean).join(" ");
  return label || "Unidentified vehicle";
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="bg-surface border border-white/5 rounded-lg px-3 py-2.5">
      <p className="text-[10px] font-body uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-xl font-display font-bold ${tone === "warn" ? "text-amber-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

// Days-on-lot is the number this page exists for, so it is styled to be read
// across the room: amber past a month, red past two.
function Days({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span className="text-[12px] text-zinc-600 font-body" title="No check-in on record">
        —
      </span>
    );
  }
  const tone =
    days >= 60 ? "text-red-400" : days >= 30 ? "text-amber-400" : "text-zinc-200";
  return (
    <span className={`font-display font-bold text-base ${tone} whitespace-nowrap`}>
      {days}
      <span className="text-[11px] font-body font-normal text-zinc-500">d</span>
    </span>
  );
}

function Owner({ ownership }: { ownership: Ownership | null }) {
  if (!ownership) {
    return (
      <span className="text-[12px] text-amber-400/80 font-body" title="Office has not classified this vehicle yet">
        Unclassified
      </span>
    );
  }
  return <span className="text-zinc-300 font-body">{OWNERSHIP_LABELS[ownership]}</span>;
}

function Deal({ row, canLink }: { row: LotRow; canLink: boolean }) {
  if (!row.dealId) {
    // Entry point A. Only offered for a vehicle actually here — attaching one
    // that has already left is almost always a mistake.
    if (canLink && row.lotStatus !== "departed") {
      return (
        <AttachToDealButton
          vehicleId={row.vehicleId}
          label={`${[row.year, row.make, row.model].filter(Boolean).join(" ") || "Vehicle"} · ${row.vin}`}
        />
      );
    }
    return <span className="text-zinc-500 font-body">No deal</span>;
  }
  return (
    <Link href={`/deals/${row.dealId}`} className="text-amber-400 hover:underline font-body">
      {row.customerName ?? "Deal"}
      {row.dealStage ? (
        <span className="text-zinc-500"> · {row.dealStage.replace(/_/g, " ")}</span>
      ) : null}
    </Link>
  );
}

function Thumb({ url, large }: { url: string | null; large?: boolean }) {
  const size = large ? "w-20 h-20" : "w-12 h-12";
  if (!url) {
    return (
      <div className={`${size} rounded-md bg-black/40 border border-white/5 flex items-center justify-center shrink-0`}>
        <svg className="w-4 h-4 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" strokeLinejoin="round" />
          <circle cx="12" cy="12.5" r="3.2" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} rounded-md object-cover border border-white/5 shrink-0`} />
  );
}

// A plain GET form: filters belong in the URL so a view can be bookmarked and
// shared, and so the back button behaves.
function Filters({ sp }: { sp: SP }) {
  const select =
    "min-h-[44px] rounded-lg border border-white/10 bg-black/40 px-3 text-[13px] text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70";
  return (
    <form
      method="get"
      className="bg-surface border border-white/5 rounded-lg p-3 grid grid-cols-2 lg:grid-cols-5 gap-2.5"
    >
      <input
        name="q"
        defaultValue={sp.q ?? ""}
        placeholder="VIN, make or model"
        className={`${select} col-span-2 lg:col-span-1 placeholder:text-zinc-500`}
      />
      <select name="ownership" defaultValue={sp.ownership ?? ""} className={select} aria-label="Ownership">
        <option value="" className="bg-zinc-900">Any owner</option>
        {OWNERSHIPS.map((o) => (
          <option key={o} value={o} className="bg-zinc-900">{OWNERSHIP_LABELS[o]}</option>
        ))}
        <option value="unset" className="bg-zinc-900">Unclassified</option>
      </select>
      <select name="status" defaultValue={sp.status ?? ""} className={select} aria-label="Lot status">
        <option value="" className="bg-zinc-900">On site</option>
        {LOT_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-zinc-900">{LOT_STATUS_LABELS[s]}</option>
        ))}
      </select>
      <select name="deal" defaultValue={sp.deal ?? ""} className={select} aria-label="Deal">
        <option value="" className="bg-zinc-900">Any deal state</option>
        <option value="has" className="bg-zinc-900">On a deal</option>
        <option value="none" className="bg-zinc-900">No deal</option>
      </select>
      <div className="col-span-2 lg:col-span-1 flex gap-2">
        <button
          type="submit"
          className="flex-1 min-h-[44px] rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-[13px] font-body font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
        >
          Apply
        </button>
        <Link
          href="/lot"
          className="min-h-[44px] px-3 flex items-center rounded-lg border border-white/10 text-[13px] font-body text-zinc-400"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
