import { describe, expect, it } from '@jest/globals';
import { MAX_SKU_LENGTH, PRODUCT_NAME_MAX } from '@product-finder/shared';
import type { SummaryRow } from './product.mapper.js';
import { buildOrderBy } from './products.query.js';
import {
  CURSOR_MAX_LENGTH,
  type CursorSort,
  cursorAfter,
  cursorProblem,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  type SearchCursor,
} from './search-cursor.js';

const CURSOR_SORTS: CursorSort[] = ['name', '-name', 'launchYear', '-launchYear', '-rating', '-reviews'];

/** base64url of any JSON, to forge cursors. */
const forge = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');

describe('encodeCursor and decodeCursor', () => {
  it('give back the sort, the key and the SKU', () => {
    const cursors: SearchCursor[] = [
      { sort: 'name', key: 'Quorin SF 470', sku: 'P-10001' },
      { sort: '-name', key: 'Ölbad "x" / ü', sku: 'P-1' },
      { sort: 'launchYear', key: 2012, sku: 'P-2' },
      { sort: '-launchYear', key: null, sku: 'P-3' },
      { sort: '-rating', key: 4.333333333333333, sku: 'P-4' },
      { sort: '-rating', key: null, sku: 'P-5' },
      { sort: '-reviews', key: 0, sku: 'P-6' },
    ];
    for (const cursor of cursors) {
      const text = encodeCursor(cursor);
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(text)).toEqual(cursor);
    }
  });

  it('fits the cursor of the longest name the import accepts, in any characters', () => {
    expect(PRODUCT_NAME_MAX).toBe(200);
    // Bytes in the JSON per character: 2 for "ü" and for a quote, 4 for an emoji, 6 for a control character.
    const names = ['ü', '"', '\u{1F9EA}', '\u0001'].map((char) => char.repeat(PRODUCT_NAME_MAX));
    // A SKU takes at most 4 bytes per character: it has no control characters.
    const sku = '\u{1F9EA}'.repeat(MAX_SKU_LENGTH);
    for (const key of names) {
      for (const sort of ['name', '-name'] as const) {
        const text = encodeCursor({ sort, key, sku });
        expect(text.length).toBeLessThanOrEqual(CURSOR_MAX_LENGTH);
        expect(decodeCursor(text)).toEqual({ sort, key, sku });
      }
    }
  });

  it('keeps a key with a surrogate pair, which is well-formed text', () => {
    const cursor: SearchCursor = { sort: 'name', key: 'Lab \u{1F9EA} kit', sku: 'P-1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('refuses a bad shape: unknown sort, relevance, wrong key type, bad SKU', () => {
    const bad = [
      [],
      'x',
      { v: 1, sort: 'price', key: 'A', sku: 'P-1' },
      { v: 1, sort: 'relevance', key: 'A', sku: 'P-1' },
      { v: 1, sort: 'name', key: 3, sku: 'P-1' },
      { v: 1, sort: 'name', key: null, sku: 'P-1' },
      { v: 1, sort: 'name', key: 'nul\u0000', sku: 'P-1' },
      { v: 1, sort: '-reviews', key: null, sku: 'P-1' },
      { v: 1, sort: '-reviews', key: 1.5, sku: 'P-1' },
      { v: 1, sort: 'launchYear', key: 1e20, sku: 'P-1' },
      { v: 1, sort: 'launchYear', key: '2012', sku: 'P-1' },
      { v: 1, sort: '-rating', key: 'high', sku: 'P-1' },
      { v: 1, sort: 'name', key: 'A' },
      { v: 1, sort: 'name', key: 'A', sku: '' },
      { v: 1, sort: 'name', key: 'A', sku: 'P\u0000' },
      { v: 1, sort: 'name', key: 'A', sku: 'P'.repeat(65) },
      // A lone surrogate is not text that Postgres can hold. JSON can carry one, a URL query cannot.
      { v: 1, sort: 'name', key: 'A\ud800', sku: 'P-1' },
      { v: 1, sort: '-name', key: '\udc00B', sku: 'P-1' },
      { v: 1, sort: 'name', key: 'A', sku: 'P-\ud800' },
    ];
    for (const data of bad) {
      expect({ data, cursor: decodeCursor(forge(data)) }).toEqual({ data, cursor: undefined });
    }
  });
});

describe('cursorProblem', () => {
  const name = encodeCursor({ sort: 'name', key: 'A', sku: 'P-1' });

  it('refuses relevance, also as the default sort with q: similarity is not stable to page by', () => {
    expect(cursorProblem(name, { sort: 'relevance', q: 'soap' })).toBe(
      'cursor does not work with sort relevance (the default when q is set). Set another sort, or use page.',
    );
    expect(cursorProblem(name, { q: 'soap' })).toContain('sort relevance');
  });

  it('refuses page with a cursor', () => {
    expect(cursorProblem(name, { page: 1 })).toBe('Send page or cursor, not both.');
  });

  it('refuses a cursor of another sort and a cursor that is not valid', () => {
    expect(cursorProblem(name, { sort: '-rating' })).toBe(
      'cursor is for sort name, not -rating. Use it with the sort it came from.',
    );
    expect(cursorProblem('nope', {})).toBe('cursor is not valid. Use nextCursor from an earlier answer.');
  });
});

describe('keysetWhere', () => {
  it('starts after the cursor row by name, with an index range on name', () => {
    expect(keysetWhere({ sort: 'name', key: 'Hydrova', sku: 'P-7' })).toEqual({
      name: { gte: 'Hydrova' },
      OR: [{ name: { gt: 'Hydrova' } }, { sku: { gt: 'P-7' } }],
    });
    expect(keysetWhere({ sort: '-name', key: 'Hydrova', sku: 'P-7' })).toEqual({
      name: { lte: 'Hydrova' },
      OR: [{ name: { lt: 'Hydrova' } }, { sku: { gt: 'P-7' } }],
    });
    expect(keysetWhere({ sort: '-reviews', key: 3, sku: 'P-7' })).toEqual({
      reviewCount: { lte: 3 },
      OR: [{ reviewCount: { lt: 3 } }, { sku: { gt: 'P-7' } }],
    });
  });

  it('keeps the NULL ratings after a rated cursor row, because they sort last', () => {
    expect(keysetWhere({ sort: '-rating', key: 4.5, sku: 'P-7' })).toEqual({
      OR: [{ ratingAvg: { lt: 4.5 } }, { ratingAvg: 4.5, sku: { gt: 'P-7' } }, { ratingAvg: null }],
    });
    expect(keysetWhere({ sort: 'launchYear', key: 2012, sku: 'P-7' })).toEqual({
      OR: [{ launchYear: { gt: 2012 } }, { launchYear: 2012, sku: { gt: 'P-7' } }, { launchYear: null }],
    });
  });

  it('reads only NULLs, by SKU, after a cursor row without a rating', () => {
    expect(keysetWhere({ sort: '-rating', key: null, sku: 'P-7' })).toEqual({
      ratingAvg: null,
      sku: { gt: 'P-7' },
    });
    expect(keysetWhere({ sort: '-launchYear', key: null, sku: 'P-7' })).toEqual({
      launchYear: null,
      sku: { gt: 'P-7' },
    });
  });
});

describe('cursorAfter', () => {
  it('takes the sort key and the SKU of the row', () => {
    const row = summary({ sku: 'P-9', name: 'Zeta', launchYear: null, ratingAvg: 3.5, reviewCount: 2 });
    expect(cursorAfter('name', row)).toEqual({ sort: 'name', key: 'Zeta', sku: 'P-9' });
    expect(cursorAfter('-launchYear', row)).toEqual({ sort: '-launchYear', key: null, sku: 'P-9' });
    expect(cursorAfter('-rating', row)).toEqual({ sort: '-rating', key: 3.5, sku: 'P-9' });
    expect(cursorAfter('-reviews', row)).toEqual({ sort: '-reviews', key: 2, sku: 'P-9' });
  });
});

// A walk over every page, with the where of keysetWhere and the order of buildOrderBy run in memory.
// The rows have equal names, equal ratings and NULLs, so ties and NULLS LAST cross page edges.

function summary(fields: Partial<SummaryRow> & { sku: string }): SummaryRow {
  return {
    name: 'Name',
    chemicalName: null,
    function: 'Surfactant',
    applicationArea: 'Home Care',
    region: 'EMEA',
    certifications: [],
    status: 'ACTIVE',
    launchYear: null,
    ratingAvg: null,
    reviewCount: 0,
    ...fields,
  };
}

const NAMES = ['Alpha', 'Beta', 'Beta', 'Gamma', 'Beta', 'Delta'];
const YEARS = [2010, null, 2012, 2010, null, 2015, 2012];
const RATINGS = [4.5, null, 3, 4.5, null, 5, 4.333333333333333, null, 3];
const ROWS: SummaryRow[] = Array.from({ length: 23 }, (_, i) =>
  summary({
    sku: `P-${String(100 - i * 3).padStart(3, '0')}`,
    name: NAMES[i % NAMES.length],
    launchYear: YEARS[i % YEARS.length],
    ratingAvg: RATINGS[i % RATINGS.length],
    reviewCount: i % 4,
  }),
);

type Where = Record<string, unknown>;
type Value = string | number | null;

function compareOp(op: string, value: Value, operand: Value): boolean {
  if (value === null || operand === null) {
    return false;
  }
  switch (op) {
    case 'gt':
      return value > operand;
    case 'gte':
      return value >= operand;
    case 'lt':
      return value < operand;
    case 'lte':
      return value <= operand;
    default:
      throw new Error(`Unknown operator ${op}`);
  }
}

/** The subset of a Prisma where that keysetWhere writes: AND, OR, equals, null and the four ranges. */
function matches(row: SummaryRow, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Where[]).every((part) => matches(row, part));
    }
    if (key === 'OR') {
      return (condition as Where[]).some((part) => matches(row, part));
    }
    const value = row[key as keyof SummaryRow] as Value;
    if (condition === null || typeof condition !== 'object') {
      return value === condition;
    }
    return Object.entries(condition).every(([op, operand]) => compareOp(op, value, operand as Value));
  });
}

/** The order of buildOrderBy: each key asc or desc, NULLs last when the key says so. */
function comparator(sort: CursorSort) {
  const keys = buildOrderBy(sort).map((entry) => {
    const [field, spec] = Object.entries(entry)[0] as [keyof SummaryRow, unknown];
    const direction = typeof spec === 'string' ? spec : (spec as { sort: string }).sort;
    return { field, sign: direction === 'asc' ? 1 : -1 };
  });
  return (a: SummaryRow, b: SummaryRow) => {
    for (const { field, sign } of keys) {
      const x = a[field] as Value;
      const y = b[field] as Value;
      if (x === y) {
        continue;
      }
      if (x === null || y === null) {
        return x === null ? 1 : -1;
      }
      return x < y ? -sign : sign;
    }
    return 0;
  };
}

function walk(sort: CursorSort, pageSize: number): string[] {
  const sorted = [...ROWS].sort(comparator(sort));
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard <= ROWS.length; guard++) {
    const decoded = cursor === undefined ? undefined : decodeCursor(cursor);
    const page = sorted.filter((row) => !decoded || matches(row, keysetWhere(decoded))).slice(0, pageSize);
    seen.push(...page.map((row) => row.sku));
    if (page.length < pageSize) {
      return seen;
    }
    cursor = encodeCursor(cursorAfter(sort, page[page.length - 1]));
  }
  throw new Error('The walk did not end.');
}

describe('a walk by cursor', () => {
  it('returns every row exactly once, in the sort order, for every sort and page size', () => {
    for (const sort of CURSOR_SORTS) {
      const expected = [...ROWS].sort(comparator(sort)).map((row) => row.sku);
      for (const pageSize of [1, 2, 3, 7, 23, 50]) {
        expect({ sort, pageSize, skus: walk(sort, pageSize) }).toEqual({ sort, pageSize, skus: expected });
      }
    }
  });

  it('has the ties and NULLs it is meant to test', () => {
    expect(ROWS.filter((row) => row.ratingAvg === null).length).toBeGreaterThan(3);
    expect(ROWS.filter((row) => row.launchYear === null).length).toBeGreaterThan(3);
    expect(ROWS.filter((row) => row.name === 'Beta').length).toBeGreaterThan(3);
    expect(new Set(ROWS.map((row) => row.sku)).size).toBe(ROWS.length);
  });
});
