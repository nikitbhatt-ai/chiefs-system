// Shared list pagination helpers. List pages parse the ?page param, query
// one page worth of rows with limit/offset, and render <Pagination/> beneath
// the table. Keeps unbounded list pages from loading entire tables into memory
// as the data grows.

export const DEFAULT_PER_PAGE = 50;

export function parsePagination(pageParam: string | undefined, perPage: number = DEFAULT_PER_PAGE) {
  const page = Math.max(1, Math.floor(Number(pageParam) || 1));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}
