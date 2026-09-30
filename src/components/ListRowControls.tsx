"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBusy } from "@/lib/useBusy";

// Inline per-row tags + archive control shared by every list page. Tag chips
// link to ?tag=<tag> on the current list (relative href). The 🏷 toggle opens a
// comma-separated editor; Archive/Unarchive flips the soft-archive flag. Both
// mutations POST to /api/list-meta and refresh the route.
export function ListRowControls({
  entity,
  id,
  tags,
  archived,
  showArchive = true,
}: {
  entity: string;
  id: string;
  tags: string[];
  archived: boolean;
  showArchive?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(tags.join(", "));
  // These buttons are on every list page in the app, and the round trip is fast
  // enough that the old `busy` flag was on screen for ~30ms — invisible. useBusy
  // holds it long enough to see and marks the button `data-pending`, which is
  // what the global CSS turns into a spinner.
  const { run, props: busyProps } = useBusy();

  function patch(payload: Record<string, unknown>) {
    return run(async () => {
      try {
        await fetch("/api/list-meta", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity, id, ...payload }),
        });
        router.refresh();
      } finally {
        setEditing(false);
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {!editing &&
        tags.map((t) => (
          <a
            key={t}
            href={`?tag=${encodeURIComponent(t)}`}
            className="text-[10px] rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-zinc-300 hover:border-amber-500/40 hover:text-amber-300"
          >
            {t}
          </a>
        ))}
      {editing ? (
        <>
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="tag1, tag2"
            className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white w-32"
          />
          <button
            type="button"
            {...busyProps}
            onClick={() => patch({ tags: val.split(",").map((s) => s.trim()).filter(Boolean) })}
            className="text-[10px] text-green-400 hover:text-green-300"
          >
            save
          </button>
          <button type="button" onClick={() => { setEditing(false); setVal(tags.join(", ")); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">
            cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit tags"
          className="text-[11px] text-zinc-500 hover:text-amber-300"
        >
          🏷
        </button>
      )}
      {showArchive && (
        <button
          type="button"
          {...busyProps}
          onClick={() => patch({ archived: !archived })}
          className="text-[10px] text-zinc-500 hover:text-amber-300"
        >
          {archived ? "Unarchive" : "Archive"}
        </button>
      )}
    </span>
  );
}
