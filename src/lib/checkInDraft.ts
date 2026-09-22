// Local draft storage for the lot check-in form.
//
// The lot has patchy signal. If the page reloads, the browser is killed, or a
// submit fails, everything typed so far would otherwise be gone — and whoever
// typed it is standing next to the truck with the phone in one hand. Drafts
// live in the browser only; nothing here reaches the server.
//
// Deliberately NOT a service worker or an offline sync engine. This covers the
// realistic cases; we revisit only if the team actually reports losing
// check-ins.

export type DraftPhoto = { url: string; slot: string | null; key: string };

export type CheckInDraft = {
  vin: string;
  // Every named form field, as FormData sees it. Storing the form's own
  // snapshot means a new field is covered without touching this file.
  fields: Record<string, string>;
  // Kept apart from `fields` because the form merges them into one
  // `damageNotes` value; restoring from the merged string would lose which
  // chips were tapped.
  chips: string[];
  damageText: string;
  fuel: string;
  // Photos already uploaded to Blob. The URLs survive a reload, so a restored
  // draft keeps its photos rather than asking for them again.
  photos: DraftPhoto[];
  savedAt: number;
};

const PREFIX = "chiefs:checkin-draft:";

// Drafts are per-VIN, so two people (or one person on two vehicles) do not
// overwrite each other, and reopening a VIN finds its own work.
function keyFor(vin: string): string {
  return `${PREFIX}${vin.trim().toUpperCase()}`;
}

// Every accessor is guarded: localStorage throws in private mode, when site
// data is blocked, and when the quota is full. A draft is a convenience — it
// must never be the reason the form breaks.
export function saveDraft(draft: CheckInDraft): void {
  if (typeof window === "undefined") return;
  if (!draft.vin) return;
  try {
    window.localStorage.setItem(keyFor(draft.vin), JSON.stringify(draft));
  } catch {
    // Out of quota or storage blocked — carry on without a draft.
  }
}

export function loadDraft(vin: string): CheckInDraft | null {
  if (typeof window === "undefined") return null;
  if (!vin) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(vin));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckInDraft;
    // Shape check: a half-written or hand-edited entry must not crash the form.
    if (!parsed || typeof parsed !== "object" || typeof parsed.vin !== "string") return null;
    return {
      vin: parsed.vin,
      fields: isRecord(parsed.fields) ? parsed.fields : {},
      chips: Array.isArray(parsed.chips) ? parsed.chips.filter((c) => typeof c === "string") : [],
      damageText: typeof parsed.damageText === "string" ? parsed.damageText : "",
      fuel: typeof parsed.fuel === "string" ? parsed.fuel : "",
      photos: Array.isArray(parsed.photos)
        ? parsed.photos.filter(
            (p): p is DraftPhoto =>
              !!p && typeof p.url === "string" && typeof p.key === "string",
          )
        : [],
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearDraft(vin: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(vin));
  } catch {
    // Nothing to do — a stale draft is offered, not forced.
  }
}

// A draft with nothing in it is noise: offering to restore an empty form is
// worse than not offering at all.
export function isDraftWorthOffering(draft: CheckInDraft | null): draft is CheckInDraft {
  if (!draft) return false;
  if (draft.photos.length > 0) return true;
  if (draft.chips.length > 0) return true;
  if (draft.damageText.trim()) return true;
  if (draft.fuel) return true;
  return Object.entries(draft.fields).some(
    ([name, value]) => name !== "vin" && name !== "photos" && String(value).trim() !== "",
  );
}

// "3 minutes ago" beats a timestamp when deciding whether a draft is the work
// you just lost or something from last week.
export function describeAge(savedAt: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - savedAt) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function isRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
