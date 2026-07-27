"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  CALENDAR_EVENT_TYPES,
  SHOP_TZ_LABEL,
  toDateInputValue,
  toLocalInputValue,
} from "@/lib/calendar";
import type { CalEvent, LinkOption, UserOption } from "./types";

function todayLocalDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function withTime(dateOrDatetime: string, fallbackTime: string): string {
  if (!dateOrDatetime) return "";
  return dateOrDatetime.length <= 10 ? `${dateOrDatetime.slice(0, 10)}T${fallbackTime}` : dateOrDatetime;
}

export function EventForm({
  editing,
  defaultDate,
  users,
  customers,
  deals,
  workOrders,
  onClose,
  onSaved,
}: {
  editing: CalEvent | null;
  defaultDate: string | null;
  users: UserOption[];
  customers: LinkOption[];
  deals: LinkOption[];
  workOrders: LinkOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const baseDate = defaultDate || todayLocalDate();

  const [title, setTitle] = useState(editing?.title ?? "");
  const [eventType, setEventType] = useState(editing?.eventType ?? "service");
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [startVal, setStartVal] = useState(
    editing
      ? editing.allDay
        ? toDateInputValue(editing.startsAt)
        : toLocalInputValue(editing.startsAt)
      : `${baseDate}T09:00`,
  );
  const [endVal, setEndVal] = useState(
    editing
      ? editing.allDay
        ? toDateInputValue(editing.endsAt)
        : toLocalInputValue(editing.endsAt)
      : `${baseDate}T10:00`,
  );
  const [location, setLocation] = useState(editing?.location ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [visibility, setVisibility] = useState(editing?.visibility ?? "team");
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(
    new Set(editing?.attendees.map((a) => a.userId) ?? []),
  );
  const [customerId, setCustomerId] = useState(editing?.customerId ?? "");
  const [dealId, setDealId] = useState(editing?.dealId ?? "");
  const [workOrderId, setWorkOrderId] = useState(editing?.workOrderId ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (next) {
      setStartVal((v) => v.slice(0, 10));
      setEndVal((v) => v.slice(0, 10));
    } else {
      setStartVal((v) => withTime(v, "09:00"));
      setEndVal((v) => withTime(v, "10:00"));
    }
  }

  function toggleAttendee(id: string) {
    setAttendeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      eventType,
      allDay,
      startsAt: startVal,
      endsAt: endVal,
      location: location.trim() || null,
      description: description.trim() || null,
      visibility,
      attendeeIds: Array.from(attendeeIds),
      customerId: customerId || null,
      dealId: dealId || null,
      workOrderId: workOrderId || null,
    };
    try {
      const res = await fetch(isEdit ? `/api/calendar/${editing!.id}` : "/api/calendar", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Could not save the event.");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event.");
      setSaving(false);
    }
  }

  const field = "mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white";
  const label = "text-[10px] uppercase tracking-wider text-zinc-500 font-body";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-[#12121c] border border-white/10 rounded-xl shadow-2xl my-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h3 className="text-sm font-display font-bold text-white">
            {isEdit ? "Edit event" : "New event"}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className={label}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="e.g. Tahoe console install — City of Hempstead" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Type</label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={field}>
                {CALENDAR_EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} className="accent-amber-500" />
                All day
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Start ({SHOP_TZ_LABEL})</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={startVal}
                onChange={(e) => setStartVal(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className={label}>End ({SHOP_TZ_LABEL})</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={endVal}
                onChange={(e) => setEndVal(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={field} placeholder="Hempstead shop — Bay 2, or a customer address" />
          </div>

          <div>
            <label className={label}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={field} />
          </div>

          <div>
            <label className={label}>Who can see this?</label>
            <div className="mt-1 flex gap-4 text-xs text-zinc-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="visibility" checked={visibility === "team"} onChange={() => setVisibility("team")} className="accent-amber-500" />
                Everyone
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="visibility" checked={visibility === "selected"} onChange={() => setVisibility("selected")} className="accent-amber-500" />
                Select people only
              </label>
            </div>
            {visibility === "selected" && (
              <p className="mt-1 text-[10px] text-zinc-500">Only the people you invite below (plus managers/admins) will see this event.</p>
            )}
          </div>

          <div>
            <label className={label}>Invite people {attendeeIds.size > 0 ? `(${attendeeIds.size})` : ""}</label>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-2 grid grid-cols-2 gap-1">
              {users.length === 0 ? (
                <span className="text-[11px] text-zinc-500">No active users.</span>
              ) : (
                users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={attendeeIds.has(u.id)} onChange={() => toggleAttendee(u.id)} className="accent-amber-500" />
                    <span className="truncate">{u.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">Link to a record (optional)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <div>
                <label className={label}>Customer</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={field}>
                  <option value="">— none —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Deal</label>
                <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={field}>
                  <option value="">— none —</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Work order</label>
                <select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} className={field}>
                  <option value="">— none —</option>
                  {workOrders.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>
            </div>
          </details>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-white/5">
          <button type="button" onClick={onClose} className="text-xs font-body text-zinc-300 bg-white/5 border border-white/10 rounded-md px-3 py-2 hover:bg-white/10">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 disabled:opacity-50">
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}
