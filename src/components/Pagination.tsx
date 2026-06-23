import { pageCount } from "@/lib/pagination";

// Prev/next pager for server-rendered list pages. `baseQuery` is the current
// querystring WITHOUT `page` (so filters/search carry across page changes).
export function Pagination({
  page,
  total,
  perPage,
  baseQuery,
}: {
  page: number;
  total: number;
  perPage: number;
  baseQuery: string;
}) {
  if (total <= perPage) return null;
  const pages = pageCount(total, perPage);
  const mk = (p: number) => {
    const qs = new URLSearchParams(baseQuery);
    qs.set("page", String(p));
    return `?${qs.toString()}`;
  };
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const linkCls = "text-amber-400 hover:text-amber-300";
  const mutedCls = "text-zinc-600";

  return (
    <div className="flex items-center justify-between px-3 py-2 text-[11px] font-body text-zinc-400 border-t border-white/5">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-3">
        {page > 1 ? <a href={mk(page - 1)} className={linkCls}>← Prev</a> : <span className={mutedCls}>← Prev</span>}
        <span>Page {page} / {pages}</span>
        {page < pages ? <a href={mk(page + 1)} className={linkCls}>Next →</a> : <span className={mutedCls}>Next →</span>}
      </div>
    </div>
  );
}
