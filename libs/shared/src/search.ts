/** Sort keys of GET /api/products. A leading `-` means descending. The order is the OpenAPI enum order. */
export const SORT_KEYS = [
  'name',
  '-name',
  'launchYear',
  '-launchYear',
  '-rating',
  '-reviews',
  'relevance',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** The sort without a search text. */
export const DEFAULT_SORT: SortKey = 'name';

// Needs a search text: the API answers 400 to relevance without `q`.
export const RELEVANCE_SORT = 'relevance' satisfies SortKey;

// Any non-string is false, not an error: a validator can see `?q=a&q=b` as an array.
export function hasSearchText(q: unknown): boolean {
  return typeof q === 'string' && q.trim().length > 0;
}

/** The sort when none is asked for: relevance with a search text, else DEFAULT_SORT. */
export function defaultSortFor(q: unknown): SortKey {
  return hasSearchText(q) ? RELEVANCE_SORT : DEFAULT_SORT;
}

/** Longest search text (`q`). The API refuses a longer one with a 400. The web cuts a longer one from a link. */
export const SEARCH_QUERY_MAX = 100;

/** Largest page size a client may ask for. */
export const PAGE_SIZE_MAX = 50;

// Without a limit `page=1e300` passes IsInt and Prisma fails on the offset with a 500.
export const PAGE_MAX = 10_000;

// An offset reads and drops every row before the page, so the API answers 400 past this depth and asks for a cursor.
export const PAGE_DEPTH_MAX = 10_000;

/** The last page number that a page size reaches within PAGE_DEPTH_MAX. */
export function lastPageFor(pageSize: number): number {
  return Math.floor(PAGE_DEPTH_MAX / pageSize);
}
