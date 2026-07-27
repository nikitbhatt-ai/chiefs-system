"use client";

import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  MapPin,
  Check,
  Ban,
  Pencil,
} from "lucide-react";
import {
  fmtEventRange,
  fmtWallClock,
  eventTypeLabel,
  SHOP_TZ_LABEL,
} from "@/lib/calendar";
import { EventForm } from "./EventForm";
import { styleFor, TYPE_STYLES, type CalEvent, type LinkOption, type UserOption } from "./types";

type Props = {
  currentUserId: string;
  role: string | null;
  users: UserOption[];
  customers: LinkOption[];
  deals: LinkOption[];
  workOrders: LinkOption[];
};

type ViewMode = "month" | "week" | "agenda";

// ── UTC-field date maths (our wall-clock convention lives in the UTC fields) ──
const DAY = 86_400_000;
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const startOfDayUTC = (d: Date) => utcDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => utcDay(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
const startOfWeek = (d: Date) => addDays(startOfDayUTC(d), -startOfDayUTC(d).getUTCDay());
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Today" = the viewer's local calendar day, mapped into UTC-field space.
function todayUTC(): Date {
  const n = new Date();
  return utcDay(n.getFullYear(), n.getMonth(), n.getDate());
}

// Does an event touch a given day (inclusive of multi-day spans)?
function overlapsDay(e: CalEvent, day: Date): boolean {
  const s = startOfDayUTC(new Date(e.startsAt)).getTime();
  const en = startOfDayUTC(new Date(e.endsAt)).getTime();
  const d = day.getTime();
  return d >= s && d <= en;
}

export function CalendarClient(props: Props) {
  const [qc] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={qc}>
      <CalendarView {...props} />
    </QueryClientProvider>
  );
}

function CalendarView(props: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => todayUTC());
  const [typeFilter, setTypeFilter] = useState("");
  const [attendeeFilter, setAttendeeFilter] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [formDate, setFormDate] = useState<string | null>(null);

  const today = useMemo(() => todayUTC(), []);

  // Small screens fall back to the agenda list.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      setView("agenda");
    }
  }, []);

  // Deep link from a notification: /calendar?event=<id> opens that event.
  useEffect(() => {
    const ev = new URLSearchParams(window.location.search).get("event");
    if (ev) setSelectedId(ev);
  }, []);

  const range = useMemo(() => {
    if (view === "month") {
      const first = utcDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1);
      const from = startOfWeek(first);
      return { from, to: addDays(from, 42) };
    }
    if (view === "week") {
      const from = startOfWeek(cursor);
      return { from, to: addDays(from, 7) };
    }
    const from = startOfDayUTC(cursor);
    return { from, to: addDays(from, 30) };
  }, [view, cursor]);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["calendar", range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const r = await fetch(
        `/api/calendar?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      );
      if (!r.ok) throw new Error("Failed to load events");
      return (await r.json()) as CalEvent[];
    },
    refetchInterval: 30_000,
  });

  const { data: fetchedSelected } = useQuery({
    queryKey: ["calendar-event", selectedId],
    queryFn: async () => {
      const r = await fetch(`/api/calendar/${selectedId}`);
      if (!r.ok) return null;
      return (await r.json()) as CalEvent;
    },
    enabled: !!selectedId,
  });

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (typeFilter && e.eventType !== typeFilter) return false;
        if (attendeeFilter && !e.attendees.some((a) => a.userId === attendeeFilter)) return false;
        if (onlyMine && !(e.createdBy === props.currentUserId || e.attendees.some((a) => a.userId === props.currentUserId))) return false;
        return true;
      }),
    [events, typeFilter, attendeeFilter, onlyMine, props.currentUserId],
  );

  const selectedEvent = selectedId
    ? events.find((e) => e.id === selectedId) ?? fetchedSelected ?? null
    : null;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-event"] });
    router.refresh();
  }

  async function respond(id: string, response: string) {
    await fetch(`/api/calendar/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response }),
    });
    refresh();
  }

  async function cancelEvent(id: string) {
    if (!window.confirm("Cancel this event? It stays on the calendar, marked cancelled — not deleted.")) return;
    await fetch(`/api/calendar/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancel: true }),
    });
    setSelectedId(null);
    refresh();
  }

  function openCreate(date?: string) {
    setEditing(null);
    setFormDate(date ?? null);
    setFormOpen(true);
  }
  function openEdit(e: CalEvent) {
    setEditing(e);
    setFormDate(null);
    setFormOpen(true);
    setSelectedId(null);
  }

  function go(delta: number) {
    if (view === "month") setCursor((c) => addMonths(c, delta));
    else if (view === "week") setCursor((c) => addDays(c, 7 * delta));
    else setCursor((c) => addDays(c, 30 * delta));
  }

  const heading =
    view === "month"
      ? fmtWallClock(cursor, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${fmtWallClock(range.from, { month: "short", day: "numeric", year: "numeric" })}`
        : `${fmtWallClock(range.from, { month: "short", day: "numeric" })} – ${fmtWallClock(addDays(range.to, -1), { month: "short", day: "numeric" })}`;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
            <button onClick={() => go(-1)} className="px-2 py-1.5 text-zinc-400 hover:text-white hover:bg-white/5" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setCursor(today)} className="px-3 py-1.5 text-xs font-body text-zinc-300 hover:text-white hover:bg-white/5 border-x border-white/10">Today</button>
            <button onClick={() => go(1)} className="px-2 py-1.5 text-zinc-400 hover:text-white hover:bg-white/5" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <h3 className="text-sm sm:text-base font-display font-bold text-white">{heading}</h3>
          {isLoading && <span className="text-[10px] text-zinc-500">loading…</span>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden text-xs font-body">
            {(["month", "week", "agenda"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 capitalize ${view === v ? "bg-amber-500 text-black font-semibold" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => openCreate()} className="inline-flex items-center gap-1.5 text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5">
            <Plus className="w-4 h-4" /> New event
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-body">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-zinc-200">
          <option value="">All types</option>
          {Object.entries(TYPE_STYLES).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        <select value={attendeeFilter} onChange={(e) => setAttendeeFilter(e.target.value)} className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-zinc-200">
          <option value="">Any attendee</option>
          {props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer px-2 py-1.5 rounded-md border border-white/10 bg-black/40">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-amber-500" />
          Only mine
        </label>
        {(typeFilter || attendeeFilter || onlyMine) && (
          <button onClick={() => { setTypeFilter(""); setAttendeeFilter(""); setOnlyMine(false); }} className="text-zinc-400 hover:text-zinc-200">Clear</button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {Object.entries(TYPE_STYLES).map(([v, s]) => (
          <span key={v} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 font-body">
            <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
            <s.Icon className="w-3 h-3" />
            {s.label}
          </span>
        ))}
      </div>

      {/* Views */}
      {view === "month" && <MonthGrid range={range} cursorMonth={cursor.getUTCMonth()} today={today} events={filtered} onSelect={setSelectedId} onCreate={openCreate} />}
      {view === "week" && <WeekView range={range} today={today} events={filtered} onSelect={setSelectedId} onCreate={openCreate} />}
      {view === "agenda" && <AgendaView range={range} events={filtered} onSelect={setSelectedId} />}

      {/* Detail panel */}
      {selectedEvent && (
        <DetailPanel
          event={selectedEvent}
          currentUserId={props.currentUserId}
          onClose={() => setSelectedId(null)}
          onEdit={openEdit}
          onCancel={cancelEvent}
          onRespond={respond}
        />
      )}

      {/* Create / edit form */}
      {formOpen && (
        <EventForm
          editing={editing}
          defaultDate={formDate}
          users={props.users}
          customers={props.customers}
          deals={props.deals}
          workOrders={props.workOrders}
          onClose={() => setFormOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

// ── Event chip ────────────────────────────────────────────────────────────────
function EventChip({ e, onSelect }: { e: CalEvent; onSelect: (id: string) => void }) {
  const s = styleFor(e.eventType);
  const cancelled = !!e.cancelledAt;
  return (
    <button
      onClick={() => onSelect(e.id)}
      title={`${e.title} · ${eventTypeLabel(e.eventType)}`}
      className={`w-full flex items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[10px] leading-tight ${s.chip} ${cancelled ? "opacity-50 line-through" : ""}`}
    >
      <s.Icon className="w-3 h-3 shrink-0" />
      {!e.allDay && <span className="tabular-nums shrink-0">{fmtWallClock(e.startsAt, { hour: "numeric", minute: "2-digit" })}</span>}
      <span className="truncate">{e.title}</span>
    </button>
  );
}

// ── Month grid ────────────────────────────────────────────────────────────────
function MonthGrid({
  range,
  cursorMonth,
  today,
  events,
  onSelect,
  onCreate,
}: {
  range: { from: Date; to: Date };
  cursorMonth: number;
  today: Date;
  events: CalEvent[];
  onSelect: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(range.from, i));

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden">
      <div className="grid grid-cols-7 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
        {WEEKDAYS.map((w) => <div key={w} className="px-2 py-1.5 text-center">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getUTCMonth() === cursorMonth;
          const isToday = day.getTime() === today.getTime();
          const dayEvents = events.filter((e) => overlapsDay(e, day));
          return (
            <div
              key={day.toISOString()}
              className={`min-h-[92px] border-b border-r border-white/5 p-1 flex flex-col gap-0.5 ${inMonth ? "" : "bg-black/20"}`}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onCreate(ymd(day))}
                  title="New event on this day"
                  className={`text-[10px] font-body w-5 h-5 flex items-center justify-center rounded-full ${isToday ? "bg-amber-500 text-black font-bold" : inMonth ? "text-zinc-400 hover:bg-white/10" : "text-zinc-600 hover:bg-white/10"}`}
                >
                  {day.getUTCDate()}
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((e) => <EventChip key={e.id} e={e} onSelect={onSelect} />)}
                {dayEvents.length > 3 && (
                  <button onClick={() => onSelect(dayEvents[3].id)} className="text-[10px] text-zinc-500 hover:text-zinc-300 text-left px-1">
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week view (7 day columns, each a compact list) ────────────────────────────
function WeekView({
  range,
  today,
  events,
  onSelect,
  onCreate,
}: {
  range: { from: Date; to: Date };
  today: Date;
  events: CalEvent[];
  onSelect: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(range.from, i));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((day) => {
        const isToday = day.getTime() === today.getTime();
        const dayEvents = events.filter((e) => overlapsDay(e, day));
        return (
          <div key={day.toISOString()} className="rounded-lg border border-white/10 bg-[#12121c] p-2 min-h-[120px]">
            <div className="flex items-center justify-between mb-1.5">
              <div className={`text-[11px] font-body ${isToday ? "text-amber-300 font-semibold" : "text-zinc-400"}`}>
                {fmtWallClock(day, { weekday: "short", day: "numeric" })}
              </div>
              <button onClick={() => onCreate(ymd(day))} className="text-zinc-500 hover:text-white" aria-label="New event"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex flex-col gap-1">
              {dayEvents.length === 0 ? (
                <span className="text-[10px] text-zinc-600">—</span>
              ) : (
                dayEvents.map((e) => <EventChip key={e.id} e={e} onSelect={onSelect} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agenda view (chronological, grouped by day) ───────────────────────────────
function AgendaView({
  range,
  events,
  onSelect,
}: {
  range: { from: Date; to: Date };
  events: CalEvent[];
  onSelect: (id: string) => void;
}) {
  // Bucket each event by its start day, clamped to the window start.
  const groups = new Map<string, { day: Date; items: CalEvent[] }>();
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const e of sorted) {
    const start = startOfDayUTC(new Date(e.startsAt));
    const day = start.getTime() < range.from.getTime() ? range.from : start;
    const key = ymd(day);
    const g = groups.get(key) ?? { day, items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => a.day.getTime() - b.day.getTime());

  if (ordered.length === 0) {
    return <div className="rounded-lg border border-white/10 bg-[#12121c] p-8 text-center text-xs text-zinc-500">No events in this range.</div>;
  }

  return (
    <div className="space-y-3">
      {ordered.map((g) => (
        <div key={g.day.toISOString()} className="rounded-lg border border-white/10 bg-[#12121c] overflow-hidden">
          <div className="px-3 py-1.5 bg-white/5 text-[11px] font-body font-semibold text-zinc-300">
            {fmtWallClock(g.day, { weekday: "long", month: "short", day: "numeric" })}
          </div>
          <div className="divide-y divide-white/5">
            {g.items.map((e) => {
              const s = styleFor(e.eventType);
              const cancelled = !!e.cancelledAt;
              return (
                <button key={e.id} onClick={() => onSelect(e.id)} className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/5">
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm text-white ${cancelled ? "line-through text-zinc-500" : ""}`}>
                      {e.title}
                      {cancelled && <span className="ml-2 text-[10px] uppercase text-red-300">cancelled</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {fmtEventRange(e.startsAt, e.endsAt, e.allDay)} · {eventTypeLabel(e.eventType)}
                      {e.location ? ` · ${e.location}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail panel (right drawer / full-screen sheet on mobile) ─────────────────
function DetailPanel({
  event,
  currentUserId,
  onClose,
  onEdit,
  onCancel,
  onRespond,
}: {
  event: CalEvent;
  currentUserId: string;
  onClose: () => void;
  onEdit: (e: CalEvent) => void;
  onCancel: (id: string) => void;
  onRespond: (id: string, response: string) => void;
}) {
  const s = styleFor(event.eventType);
  const cancelled = !!event.cancelledAt;
  const amAttendee = event.attendees.some((a) => a.userId === currentUserId);

  const respPill = (r: string) =>
    r === "accepted"
      ? "text-emerald-300 bg-emerald-500/10"
      : r === "declined"
        ? "text-red-300 bg-red-500/10"
        : "text-zinc-400 bg-white/5";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md h-full overflow-y-auto bg-[#12121c] border-l border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 sticky top-0 bg-[#12121c]">
          <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-body rounded border px-2 py-0.5 ${s.badge}`}>
            <s.Icon className="w-3 h-3" /> {eventTypeLabel(event.eventType)}
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {cancelled && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              This event was cancelled on {fmtWallClock(event.cancelledAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} {SHOP_TZ_LABEL}.
            </div>
          )}

          <div>
            <h3 className={`text-lg font-display font-bold ${cancelled ? "line-through text-zinc-500" : "text-white"}`}>{event.title}</h3>
            <p className="text-xs text-zinc-400 mt-1">{fmtEventRange(event.startsAt, event.endsAt, event.allDay)}</p>
          </div>

          {event.location && (
            <div className="flex items-start gap-2 text-xs text-zinc-300">
              <MapPin className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" /> {event.location}
            </div>
          )}

          {event.description && (
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{event.description}</p>
          )}

          <div className="text-[11px] text-zinc-500 space-y-1">
            <div>Posted by {event.createdByName ?? "—"}</div>
            <div>Visibility: {event.visibility === "team" ? "Everyone" : "Select people only"}</div>
          </div>

          {/* Linked records */}
          {(event.customerId || event.dealId || event.workOrderId) && (
            <div className="flex flex-wrap gap-2">
              {event.customerId && <Link href={`/crm/${event.customerId}`} className="text-[11px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1">Customer: {event.customerName ?? "view"}</Link>}
              {event.dealId && <Link href={`/deals/${event.dealId}`} className="text-[11px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1">Deal: {event.dealLabel ?? "view"}</Link>}
              {event.workOrderId && <Link href={`/work-orders/${event.workOrderId}`} className="text-[11px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1">Work order: {event.woNumber ?? "view"}</Link>}
            </div>
          )}

          {/* Attendees */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-1.5">Attendees ({event.attendees.length})</div>
            {event.attendees.length === 0 ? (
              <p className="text-[11px] text-zinc-600">No one invited — team-wide notice.</p>
            ) : (
              <ul className="space-y-1">
                {event.attendees.map((a) => (
                  <li key={a.userId} className="flex items-center justify-between text-xs text-zinc-300">
                    <span>{a.name ?? "—"}{a.userId === currentUserId ? " (you)" : ""}</span>
                    <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize ${respPill(a.response)}`}>{a.response}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Accept / decline for the current user */}
          {amAttendee && !cancelled && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Your response:</span>
              <button onClick={() => onRespond(event.id, "accepted")} className={`inline-flex items-center gap-1 text-xs rounded-md px-2.5 py-1.5 border ${event.myResponse === "accepted" ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40" : "text-zinc-300 border-white/10 hover:bg-white/5"}`}>
                <Check className="w-3.5 h-3.5" /> Accept
              </button>
              <button onClick={() => onRespond(event.id, "declined")} className={`inline-flex items-center gap-1 text-xs rounded-md px-2.5 py-1.5 border ${event.myResponse === "declined" ? "bg-red-500/20 text-red-200 border-red-500/40" : "text-zinc-300 border-white/10 hover:bg-white/5"}`}>
                <Ban className="w-3.5 h-3.5" /> Decline
              </button>
            </div>
          )}

          {/* Manage */}
          {event.canManage && !cancelled && (
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button onClick={() => onEdit(event)} className="inline-flex items-center gap-1 text-xs font-body bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-1.5">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={() => onCancel(event.id)} className="inline-flex items-center gap-1 text-xs font-body text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-md px-3 py-1.5">
                <Ban className="w-3.5 h-3.5" /> Cancel event
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
