import { describe, expect, it } from '@jest/globals';
import { DEFAULT_VISIBLE_STATUSES } from '@product-finder/shared';
import {
  buildOrderBy,
  buildSearchSql,
  buildWhere,
  effectiveSort,
  listedSql,
  listedWhere,
  type PagedSearch,
  type ProductSearch,
  pageDepthProblem,
  searchWhereSql,
} from './products.query.js';

describe('listedWhere', () => {
  it('requires the latest export and the given statuses', () => {
    expect(listedWhere(['ACTIVE'])).toEqual({ inLatestExport: true, status: { in: ['ACTIVE'] } });
  });

  it('uses the default statuses when none are given', () => {
    expect(listedWhere()).toEqual({ inLatestExport: true, status: { in: DEFAULT_VISIBLE_STATUSES } });
  });
});

describe('buildWhere', () => {
  it('lists only default statuses in the latest export when nothing is set', () => {
    expect(buildWhere({})).toEqual({
      AND: [{ inLatestExport: true, status: { in: ['ACTIVE', 'PHASE_OUT'] } }],
    });
  });

  it('adds one case-insensitive contains per term (AND)', () => {
    const where = buildWhere({ q: 'Surfactant  kosher' });
    expect(where.AND).toEqual([
      { inLatestExport: true, status: { in: ['ACTIVE', 'PHASE_OUT'] } },
      { searchText: { contains: 'Surfactant', mode: 'insensitive' } },
      { searchText: { contains: 'kosher', mode: 'insensitive' } },
    ]);
  });

  it('escapes LIKE wildcards, so they match as plain text', () => {
    const where = buildWhere({ q: '100% a_b' });
    expect(where.AND).toContainEqual({ searchText: { contains: '100\\%', mode: 'insensitive' } });
    expect(where.AND).toContainEqual({ searchText: { contains: 'a\\_b', mode: 'insensitive' } });
  });

  it('uses ANY (in) for function and application area', () => {
    const where = buildWhere({ function: ['Emulsifier', 'Surfactant'], applicationArea: ['Home Care'] });
    expect(where.AND).toContainEqual({ function: { in: ['Emulsifier', 'Surfactant'] } });
    expect(where.AND).toContainEqual({ applicationArea: { in: ['Home Care'] } });
  });

  it('lets Global products match every region filter', () => {
    const where = buildWhere({ region: ['EMEA'] });
    expect(where.AND).toContainEqual({ region: { in: ['EMEA', 'Global'] } });
  });

  it('requires ALL certifications (hasEvery)', () => {
    const where = buildWhere({ certifications: ['Halal', 'Vegan'] });
    expect(where.AND).toContainEqual({ certifications: { hasEvery: ['Halal', 'Vegan'] } });
  });

  it('uses the requested statuses', () => {
    const where = buildWhere({ status: ['DISCONTINUED'] });
    expect(where.AND[0]).toEqual({ inLatestExport: true, status: { in: ['DISCONTINUED'] } });
  });
});

describe('buildOrderBy', () => {
  it('sorts by name with sku as the tie-break by default', () => {
    expect(buildOrderBy(undefined)).toEqual([{ name: 'asc' }, { sku: 'asc' }]);
    expect(buildOrderBy('name')).toEqual([{ name: 'asc' }, { sku: 'asc' }]);
  });

  it('puts null launch years last in both directions', () => {
    expect(buildOrderBy('launchYear')).toEqual([
      { launchYear: { sort: 'asc', nulls: 'last' } },
      { sku: 'asc' },
    ]);
    expect(buildOrderBy('-launchYear')).toEqual([
      { launchYear: { sort: 'desc', nulls: 'last' } },
      { sku: 'asc' },
    ]);
  });

  it('puts null ratings last', () => {
    expect(buildOrderBy('-rating')).toEqual([{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { sku: 'asc' }]);
  });

  it('always ends with sku asc', () => {
    for (const sort of ['name', '-name', 'launchYear', '-launchYear', '-rating', '-reviews'] as const) {
      expect(buildOrderBy(sort).at(-1)).toEqual({ sku: 'asc' });
    }
  });
});

describe('pageDepthProblem', () => {
  it('accepts page * pageSize up to 10,000', () => {
    expect(pageDepthProblem(1, 50)).toBeUndefined();
    expect(pageDepthProblem(200, 50)).toBeUndefined();
    expect(pageDepthProblem(500, 20)).toBeUndefined();
    expect(pageDepthProblem(10_000, 1)).toBeUndefined();
  });
});

describe('effectiveSort', () => {
  it('sorts by name when there is no search text and no sort', () => {
    expect(effectiveSort({})).toBe('name');
  });

  it('keeps a requested sort, with or without a search text', () => {
    expect(effectiveSort({ q: 'glucos', sort: 'name' })).toBe('name');
    expect(effectiveSort({ sort: '-rating' })).toBe('-rating');
  });
});

describe('listedSql', () => {
  it('is the isListed rule of shared: latest export and the given or default statuses', () => {
    expect(listedSql().text).toBe('in_latest_export AND status = ANY($1::"ProductStatus"[])');
    expect(listedSql().values).toEqual([['ACTIVE', 'PHASE_OUT']]);
    expect(listedSql(['DISCONTINUED']).values).toEqual([['DISCONTINUED']]);
  });
});

// The columns of a product summary, in the order of SUMMARY_SELECT in product.mapper.ts.
const COLUMNS =
  'SELECT sku, name, chemical_name AS "chemicalName", function, application_area AS "applicationArea", ' +
  'region, certifications, status::text AS "status", launch_year AS "launchYear", ' +
  'rating_avg AS "ratingAvg", review_count AS "reviewCount"';
const LISTED = 'in_latest_export AND status = ANY($1::"ProductStatus"[])';
const DEFAULT_STATUSES = ['ACTIVE', 'PHASE_OUT'];
const COUNT = 'SELECT count(*)::int AS total';

const paged = (search: ProductSearch, page = 1, pageSize = 20): PagedSearch => ({
  ...search,
  page,
  pageSize,
});
const lines = (...parts: string[]) => parts.join('\n');

describe('buildSearchSql', () => {
  it('ranks a search text alone by exact SKU, SKU prefix, name similarity, then name and SKU', () => {
    const sql = buildSearchSql(paged({ q: 'glucos' }));

    expect(sql.page.text).toBe(
      lines(
        COLUMNS,
        'FROM product',
        `WHERE ${LISTED} AND search_text ILIKE $2`,
        'ORDER BY (sku = $3) DESC, (sku LIKE $4) DESC, word_similarity($5, name) DESC, name, sku',
        'LIMIT $6 OFFSET $7',
      ),
    );
    expect(sql.page.values).toEqual([DEFAULT_STATUSES, '%glucos%', 'GLUCOS', 'GLUCOS%', 'glucos', 20, 0]);
    // No trigram pass over search_text: it cost about 20 microseconds per match.
    expect(sql.page.text).not.toContain('similarity(search_text');
    expect(sql.count.text).toBe(lines(COUNT, 'FROM product', `WHERE ${LISTED} AND search_text ILIKE $2`));
    expect(sql.count.values).toEqual([DEFAULT_STATUSES, '%glucos%']);
  });

  it('matches every term and ranks by the first 8 terms, joined by one space', () => {
    const sql = buildSearchSql(paged({ q: '  Decyl   GLUCOSIDE a b c d e f g h ' }));

    expect(sql.count.values).toEqual([
      DEFAULT_STATUSES,
      '%Decyl%',
      '%GLUCOSIDE%',
      '%a%',
      '%b%',
      '%c%',
      '%d%',
      '%e%',
      '%f%',
    ]);
    expect(sql.page.values.slice(9, 12)).toEqual([
      'DECYL GLUCOSIDE A B C D E F',
      'DECYL GLUCOSIDE A B C D E F%',
      'decyl glucoside a b c d e f',
    ]);
  });

  it('upper-cases the SKU like the import, so p-10001 finds P-10001', () => {
    const sql = buildSearchSql(paged({ q: 'p-10001' }));

    expect(sql.page.values.slice(2, 4)).toEqual(['P-10001', 'P-10001%']);
  });

  it('escapes LIKE wildcards in the terms and in the SKU prefix', () => {
    const sql = buildSearchSql(paged({ q: '100% a_b' }));

    expect(sql.count.values).toEqual([DEFAULT_STATUSES, '%100\\%%', '%a\\_b%']);
    expect(sql.page.values.slice(3, 5)).toEqual(['100% A_B', '100\\% A\\_B%']);
  });

  it('uses the requested statuses', () => {
    const sql = buildSearchSql(paged({ q: 'x', status: ['DISCONTINUED'] }));

    expect(sql.count.values[0]).toEqual(['DISCONTINUED']);
  });

  it('uses ANY for the function filter', () => {
    const sql = buildSearchSql(paged({ q: 'x', function: ['Emulsifier', 'Surfactant'] }));

    expect(sql.count.text).toBe(
      lines(COUNT, 'FROM product', `WHERE ${LISTED} AND search_text ILIKE $2 AND function = ANY($3::text[])`),
    );
    expect(sql.count.values).toEqual([DEFAULT_STATUSES, '%x%', ['Emulsifier', 'Surfactant']]);
  });

  it('uses ANY for the application area filter', () => {
    const sql = buildSearchSql(paged({ q: 'x', applicationArea: ['Home Care'] }));

    expect(sql.count.text).toContain(' AND application_area = ANY($3::text[])');
    expect(sql.count.values[2]).toEqual(['Home Care']);
  });

  it('lets Global products match every region filter', () => {
    const sql = buildSearchSql(paged({ q: 'x', region: ['EMEA'] }));

    expect(sql.count.text).toContain(' AND region = ANY($3::text[])');
    expect(sql.count.values[2]).toEqual(['EMEA', 'Global']);
  });

  it('requires ALL certifications (array contains)', () => {
    const sql = buildSearchSql(paged({ q: 'x', certifications: ['Halal', 'Vegan'] }));

    expect(sql.count.text).toContain(' AND certifications @> $3::text[]');
    expect(sql.count.values[2]).toEqual(['Halal', 'Vegan']);
  });

  it('combines a search text with every filter, in the order of buildWhere', () => {
    const sql = buildSearchSql(
      paged({
        q: 'soap kosher',
        function: ['Surfactant'],
        applicationArea: ['Home Care', 'Personal Care'],
        region: ['Global'],
        certifications: ['Kosher'],
        status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      }),
    );

    const where =
      `WHERE ${LISTED} AND search_text ILIKE $2 AND search_text ILIKE $3 AND function = ANY($4::text[]) ` +
      'AND application_area = ANY($5::text[]) AND region = ANY($6::text[]) AND certifications @> $7::text[]';
    expect(sql.page.text).toBe(
      lines(
        COLUMNS,
        'FROM product',
        where,
        'ORDER BY (sku = $8) DESC, (sku LIKE $9) DESC, word_similarity($10, name) DESC, name, sku',
        'LIMIT $11 OFFSET $12',
      ),
    );
    expect(sql.page.values).toEqual([
      ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      '%soap%',
      '%kosher%',
      ['Surfactant'],
      ['Home Care', 'Personal Care'],
      ['Global'],
      ['Kosher'],
      'SOAP KOSHER',
      'SOAP KOSHER%',
      'soap kosher',
      20,
      0,
    ]);
    expect(sql.count.text).toBe(lines(COUNT, 'FROM product', where));
  });

  it('pages with LIMIT pageSize and OFFSET (page - 1) * pageSize', () => {
    const sql = buildSearchSql(paged({ q: 'x' }, 3, 50));

    expect(sql.page.text.split('\n').at(-1)).toBe('LIMIT $6 OFFSET $7');
    expect(sql.page.values.slice(-2)).toEqual([50, 100]);
    expect(sql.count.text).not.toContain('LIMIT');
  });

  it('refuses the other sorts, which run through buildWhere and buildOrderBy', () => {
    for (const sort of ['name', '-name', 'launchYear', '-launchYear', '-rating', '-reviews'] as const) {
      expect(() => buildSearchSql(paged({ q: 'x', sort }))).toThrow('relevance sort only');
    }
  });

  it('refuses relevance without a search text, as the API answers 400', () => {
    expect(() => buildSearchSql(paged({ sort: 'relevance' }))).toThrow('needs a search text');
    expect(() => buildSearchSql(paged({ q: '   ', sort: 'relevance' }))).toThrow('needs a search text');
  });

  it('gives the page and the count the same where fragment, with the same parameters', () => {
    const search = paged({ q: 'soap kosher', region: ['EMEA'], certifications: ['Halal', 'Vegan'] });
    const where = searchWhereSql(search);
    const sql = buildSearchSql(search);

    expect(sql.count.text).toBe(lines(COUNT, 'FROM product', `WHERE ${where.text}`));
    expect(sql.count.values).toEqual(where.values);
    expect(sql.page.text).toContain(`\nWHERE ${where.text}\nORDER BY `);
    expect(sql.page.values.slice(0, where.values.length)).toEqual(where.values);
  });
});
