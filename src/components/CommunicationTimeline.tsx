import { fmtDateTime } from "@/lib/datetime";

// Renders a chronological communication feed. Channel-agnostic by design: the
// same component shows synced email, manually logged calls, and (once the
// telephony adapter lands) call recordings, because they're all rows in
// `communications`.

export type TimelineRow = {
  id: string;
  channel: string;
  direction: string;
  status: string;
  source: string;
  matchedBy: string | null;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  occurredAt: Date;
  mailboxAddress: string | null;
  dealId: string | null;
  customerId: string | null;
  leadId: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
};

export type TimelineParticipant = {
  communicationId: string;
  role: string;
  name: string | null;
  email: string | null;
};

const CHANNEL_STYLES: Record<string, string> = {
  email: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  call: "bg-green-500/10 text-green-300 border-green-500/30",
  sms: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  meeting: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_person: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  note: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

function channelStyle(channel: string): string {
  return CHANNEL_STYLES[channel] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}

function durationLabel(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function CommunicationTimeline({
  rows,
  participants = [],
  // When set, rows with no deal_id are flagged as account-level so a rep can
  // tell "this was about the account" from "this was about this deal".
  contextDealId,
  emptyText = "No communication recorded yet.",
  actions,
}: {
  rows: TimelineRow[];
  participants?: TimelineParticipant[];
  contextDealId?: string | null;
  emptyText?: string;
  // Per-row controls (triage buttons on the inbox, delete on a deal).
  actions?: (row: TimelineRow) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500 font-body">{emptyText}</p>;
  }

  const byComm = new Map<string, TimelineParticipant[]>();
  for (const p of participants) {
    const list = byComm.get(p.communicationId) ?? [];
    list.push(p);
    byComm.set(p.communicationId, list);
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const people = byComm.get(row.id) ?? [];
        const from = people.find((p) => p.role === "from" || p.role === "caller");
        const to = people.filter((p) => p.role === "to" || p.role === "callee");
        const accountLevel = !!contextDealId && !row.dealId;
        const duration = durationLabel(row.durationSeconds);

        return (
          <li key={row.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${channelStyle(row.channel)}`}>
                  {row.channel.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {row.direction === "outbound" ? "→ sent" : row.direction === "inbound" ? "← received" : row.direction}
                </span>
                {row.source !== "manual" && (
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600" title={`Synced from ${row.source}${row.matchedBy ? ` · matched by ${row.matchedBy}` : ""}`}>
                    synced
                  </span>
                )}
                {accountLevel && (
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 border border-white/10 rounded px-1.5 py-0.5" title="Filed to the account, not to this specific deal">
                    account-level
                  </span>
                )}
                {row.status === "unassigned" && (
                  <span className="text-[10px] uppercase tracking-wider text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">
                    needs filing
                  </span>
                )}
                {duration && <span className="text-[10px] text-zinc-500">{duration}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 whitespace-nowrap">{fmtDateTime(row.occurredAt)}</span>
                {actions?.(row)}
              </div>
            </div>

            {(from || to.length > 0) && (
              <div className="text-[10px] text-zinc-500 mb-1 break-all">
                {from && <span>{from.name ?? from.email}</span>}
                {to.length > 0 && (
                  <span>
                    {" → "}
                    {to.slice(0, 3).map((p) => p.name ?? p.email).join(", ")}
                    {to.length > 3 ? ` +${to.length - 3}` : ""}
                  </span>
                )}
              </div>
            )}

            {row.subject && <div className="text-white font-semibold">{row.subject}</div>}

            {row.bodyText && row.bodyText.length > 320 ? (
              <details className="mt-1">
                <summary className="text-zinc-300 cursor-pointer list-none">
                  {row.snippet ?? `${row.bodyText.slice(0, 280)}…`}
                  <span className="text-amber-400 ml-1">show more</span>
                </summary>
                <div className="whitespace-pre-wrap text-zinc-200 mt-2 max-h-96 overflow-y-auto">{row.bodyText}</div>
              </details>
            ) : (
              (row.bodyText || row.snippet) && (
                <div className="whitespace-pre-wrap text-zinc-200 mt-1">{row.bodyText ?? row.snippet}</div>
              )
            )}

            {row.recordingUrl && (
              <a href={row.recordingUrl} className="inline-block mt-1.5 text-[11px] text-amber-400 hover:text-amber-300">
                Recording
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
