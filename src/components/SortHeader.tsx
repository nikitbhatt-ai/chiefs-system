import type { InventorySortKey, SortDir } from "@/lib/inventorySort";

// A table header cell with stacked up/down arrows that link to sort this
// column ascending or descending. The active direction is highlighted. Sorting
// happens server-side (via ?sort=&dir= query params) so it orders the whole
// filtered list, not just the current page. Existing filters are preserved and
// the page is reset to 1 whenever the sort changes.
export function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  params,
  align = "left",
  basePath = "/inventory",
}: {
  label: string;
  sortKey: InventorySortKey;
  currentSort: InventorySortKey;
  currentDir: SortDir;
  params: Record<string, string>;
  align?: "left" | "right";
  basePath?: string;
}) {
  const href = (dir: SortDir) => {
    const qs = new URLSearchParams(params);
    qs.set("sort", sortKey);
    qs.set("dir", dir);
    return `${basePath}?${qs.toString()}`;
  };
  const active = currentSort === sortKey;
  const arrow = (dir: SortDir, glyph: string) => (
    <a
      href={href(dir)}
      aria-label={`Sort by ${label} ${dir === "asc" ? "ascending" : "descending"}`}
      className={
        active && currentDir === dir
          ? "text-amber-400"
          : "text-zinc-600 hover:text-zinc-300"
      }
    >
      {glyph}
    </a>
  );
  return (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}>
      <span
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-zinc-300" : ""}`}
      >
        <span>{label}</span>
        <span className="inline-flex flex-col leading-[0.6] text-[8px]">
          {arrow("asc", "▲")}
          {arrow("desc", "▼")}
        </span>
      </span>
    </th>
  );
}
