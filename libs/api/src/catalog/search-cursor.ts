import type { Prisma } from '@product-finder/server';
import { defaultSortFor, RELEVANCE_SORT, skuProblem, type SortKey } from '@product-finder/shared';
import type { SummaryRow } from './product.mapper.js';

// Keyset cursors for GET /api/products. A cursor names the last row of a page (sort key and SKU), so the next page
// starts with a WHERE instead of an OFFSET. SKU is the last key of every sort, so the position is exact.
// A cursor is not a security token: forged, it only starts the page at another row of the current search.
// decodeCursor checks its shape, so a forged value cannot reach the database as a wrong type.

// The format tag. A later format bumps it, and old cursors then get a 400.
const CURSOR_VERSION = 1;
// Fits the longest name the import accepts (PRODUCT_NAME_MAX) with a 64-emoji SKU. A spec builds the worst case.
export const CURSOR_MAX_LENGTH = 2048;

/** Every sort but relevance: word_similarity() is not a stable key to page by. */
export type CursorSort = Exclude<SortKey, typeof RELEVANCE_SORT>;
type CursorKey = string | number | null;

export interface SearchCursor {
  sort: CursorSort;
  /** The sort key of the last row. Null when that row has no value (NULLs sort last). */
  key: CursorKey;
  sku: string;
}

interface SortColumn {
  field: 'name' | 'launchYear' | 'ratingAvg' | 'reviewCount';
  direction: 'asc' | 'desc';
  /** The column can be NULL. NULLs sort last in both directions. */
  nullable: boolean;
  kind: 'text' | 'integer' | 'number';
}

// The first sort key of each sort. buildOrderBy adds `sku asc` to each, and keysetWhere follows the same table.
export const SORT_COLUMNS: Readonly<Record<CursorSort, SortColumn>> = {
  name: { field: 'name', direction: 'asc', nullable: false, kind: 'text' },
  '-name': { field: 'name', direction: 'desc', nullable: false, kind: 'text' },
  launchYear: { field: 'launchYear', direction: 'asc', nullable: true, kind: 'integer' },
  '-launchYear': { field: 'launchYear', direction: 'desc', nullable: true, kind: 'integer' },
  '-rating': { field: 'ratingAvg', direction: 'desc', nullable: true, kind: 'number' },
  '-reviews': { field: 'reviewCount', direction: 'desc', nullable: false, kind: 'integer' },
};

const INT4_MAX = 2_147_483_647;

function isCursorSort(value: unknown): value is CursorSort {
  return typeof value === 'string' && Object.hasOwn(SORT_COLUMNS, value);
}

// Well-formed UTF-16 and no NUL, which JSON can carry but Postgres cannot hold.
// Not String.prototype.isWellFormed, which the ES2023 lib does not type: with the u flag, \p{Cs} matches only a lone surrogate.
function isStorableText(text: string): boolean {
  return !/\p{Cs}/u.test(text) && !text.includes('\u0000');
}

// A key that the column can hold, so Prisma never gets a wrong type.
function fitsColumn(column: SortColumn, key: unknown): key is CursorKey {
  if (key === null) {
    return column.nullable;
  }
  switch (column.kind) {
    case 'text':
      return typeof key === 'string' && isStorableText(key);
    case 'integer':
      return Number.isInteger(key) && Math.abs(key as number) <= INT4_MAX;
    case 'number':
      return typeof key === 'number' && Number.isFinite(key);
  }
}

// base64url of `{ v, sort, key, sku }`. JSON keeps a float exact, so the rating key compares equal.
export function encodeCursor(cursor: SearchCursor): string {
  const { sort, key, sku } = cursor;
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, sort, key, sku }), 'utf8').toString('base64url');
}

/** The cursor in the text, or undefined when the text is not a cursor of this version. */
export function decodeCursor(text: string): SearchCursor | undefined {
  if (text.length === 0 || text.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }
  const { v, sort, key, sku } = data as Record<string, unknown>;
  if (
    v !== CURSOR_VERSION ||
    !isCursorSort(sort) ||
    typeof sku !== 'string' ||
    skuProblem(sku) !== null ||
    !isStorableText(sku)
  ) {
    return undefined;
  }
  return fitsColumn(SORT_COLUMNS[sort], key) ? { sort, key, sku } : undefined;
}

/** The cursor that a page ending with this row hands out. */
export function cursorAfter(sort: CursorSort, row: SummaryRow): SearchCursor {
  return { sort, key: row[SORT_COLUMNS[sort].field], sku: row.sku };
}

/** The parts of a search query that decide whether its cursor fits. */
export interface CursorQuery {
  page?: number;
  q?: string;
  sort?: SortKey;
}

/** Why the cursor does not fit the query, or undefined. */
export function cursorProblem(cursor: string, query: CursorQuery): string | undefined {
  if (query.page !== undefined) {
    return 'Send page or cursor, not both.';
  }
  const sort = query.sort ?? defaultSortFor(query.q);
  if (sort === RELEVANCE_SORT) {
    return `cursor does not work with sort ${RELEVANCE_SORT} (the default when q is set). Set another sort, or use page.`;
  }
  const decoded = decodeCursor(cursor);
  if (!decoded) {
    return 'cursor is not valid. Use nextCursor from an earlier answer.';
  }
  if (decoded.sort !== sort) {
    return `cursor is for sort ${decoded.sort}, not ${sort}. Use it with the sort it came from.`;
  }
  return undefined;
}

/**
 * The rows after the cursor row, in the order of buildOrderBy. Written out, because a row value compare
 * cannot say a descending key before `sku asc`, or NULLS LAST. Never-NULL key: `key >= k AND (key > k OR sku > s)`.
 */
export function keysetWhere(cursor: SearchCursor): Prisma.ProductWhereInput {
  const { field, direction, nullable } = SORT_COLUMNS[cursor.sort];
  const afterSku = { sku: { gt: cursor.sku } };
  if (cursor.key === null) {
    return { [field]: null, ...afterSku };
  }
  const beyond = { [field]: { [direction === 'asc' ? 'gt' : 'lt']: cursor.key } };
  if (!nullable) {
    return { [field]: { [direction === 'asc' ? 'gte' : 'lte']: cursor.key }, OR: [beyond, afterSku] };
  }
  return { OR: [beyond, { [field]: cursor.key, ...afterSku }, { [field]: null }] };
}
