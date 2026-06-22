// Active/Archived view toggle + active-tag chip, shared by every list page.
// `carry` is the set of other active params (search, status, …) so toggling
// the view or clearing the tag preserves them. `page` is intentionally dropped
// so changing the view resets to page 1.
export function ListFilters({
  basePath,
  view,
  tag,
  carry = {},
}: {
  basePath: string;
  view: "active" | "archived";
  tag: string;
  carry?: Record<string, string | undefined>;
}) {
  const mk = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...carry, ...over })) {
      if (v) qs.set(k, v);
    }
    const s = qs.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const tab = (active: boolean) =>
    active ? "text-amber-300 font-semibold" : "text-zinc-500 hover:text-zinc-300";

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-body">
      <div className="flex items-center gap-1.5">
        <a href={mk({ tag, view: undefined })} className={tab(view === "active")}>Active</a>
        <span className="text-zinc-700">·</span>
        <a href={mk({ tag, view: "archived" })} className={tab(view === "archived")}>Archived</a>
      </div>
      {tag && (
        <a
          href={mk({ view: view === "archived" ? "archived" : undefined })}
          className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 px-1.5 py-0.5"
          title="Clear tag filter"
        >
          tag: {tag} ✕
        </a>
      )}
    </div>
  );
}
