import { describe, expect, it } from '@jest/globals';
import {
  buildFacetSql,
  type FacetCountRow,
  facetCacheKey,
  facetQueryKey,
  normalizeFacetSearch,
  toFacets,
} from './facets.query.js';
import type { ProductSearch } from './products.query.js';
import { searchWhereSql } from './products.query.js';

const LISTED = (n: number) => `in_latest_export AND status = ANY($${n}::"ProductStatus"[])`;
const DEFAULT_STATUSES = ['ACTIVE', 'PHASE_OUT'];
const FACET_NAME =
  "SELECT CASE GROUPING(function, application_area, region) WHEN 3 THEN 'function' WHEN 5 THEN 'applicationArea' ELSE 'region' END AS facet, COALESCE(function, application_area, region) AS value";
const SETS = 'GROUP BY GROUPING SETS ((function), (application_area), (region))';
const CERT_SELECT = "SELECT 'certifications' AS facet, value, count(*)::int AS count";
const CERT_END = ['GROUP BY value', 'ORDER BY facet, value'];
const lines = (...parts: string[]) => parts.join('\n');
/** The same SQL with every parameter number as $?, to compare fragments built apart. */
const anyParams = (text: string) => text.replace(/\$\d+/g, '$?');

/** The facet SQL of a search, normalized first like the service does. */
const sql = (search: ProductSearch) => buildFacetSql(normalizeFacetSearch(search));

describe('facetQueryKey and facetCacheKey', () => {
  it('give one key to queries that mean the same', () => {
    const a = normalizeFacetSearch({ q: 'soap kosher', region: ['EMEA'], status: ['PHASE_OUT', 'ACTIVE'] });
    const b = normalizeFacetSearch({ q: 'kosher  soap', region: ['EMEA', 'Global'] });

    expect(facetQueryKey(a)).toBe(facetQueryKey(b));
    expect(facetCacheKey('run-1', a)).toBe(facetCacheKey('run-1', b));
  });

  it('give other keys to other filters', () => {
    const keys = [
      {},
      { q: 'soap' },
      { function: ['Surfactant'] },
      { applicationArea: ['Surfactant'] },
      { region: ['EMEA'] },
      { certifications: ['Halal'] },
      { status: ['DISCONTINUED' as const] },
    ].map((search) => facetQueryKey(normalizeFacetSearch(search)));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts the catalog version in the cache key', () => {
    const search = normalizeFacetSearch({ region: ['EMEA'] });

    expect(facetCacheKey('run-1', search)).not.toBe(facetCacheKey('run-2', search));
    expect(facetCacheKey('run-1', search)).toBe(`run-1 ${facetQueryKey(search)}`);
  });
});

describe('buildFacetSql', () => {
  it('leaves the region filter out of the region counts only', () => {
    const facets = sql({ region: ['EMEA'] });

    expect(facets.text).toBe(
      lines(
        `${FACET_NAME}, (CASE GROUPING(function, application_area, region) ` +
          'WHEN 3 THEN count(*) FILTER (WHERE region = ANY($1::text[])) ' +
          'WHEN 5 THEN count(*) FILTER (WHERE region = ANY($2::text[])) ' +
          'ELSE count(*) END)::int AS count',
        'FROM product',
        `WHERE ${LISTED(3)}`,
        SETS,
        'UNION ALL',
        CERT_SELECT,
        `FROM (SELECT unnest(certifications) AS value FROM product WHERE ${LISTED(4)} AND region = ANY($5::text[])) AS cert`,
        ...CERT_END,
      ),
    );
    expect(facets.values).toEqual([
      ['EMEA', 'Global'],
      ['EMEA', 'Global'],
      DEFAULT_STATUSES,
      DEFAULT_STATUSES,
      ['EMEA', 'Global'],
    ]);
  });

  it('leaves the function filter out of the function counts only', () => {
    const facets = sql({ function: ['Surfactant'] });

    expect(facets.text).toContain(
      'WHEN 3 THEN count(*) WHEN 5 THEN count(*) FILTER (WHERE function = ANY($1::text[])) ' +
        'ELSE count(*) FILTER (WHERE function = ANY($2::text[])) END',
    );
    expect(facets.text).toContain(`WHERE ${LISTED(4)} AND function = ANY($5::text[])) AS cert`);
  });

  it('leaves the application area filter out of the application area counts only', () => {
    const facets = sql({ applicationArea: ['Home Care'] });

    expect(facets.text).toContain(
      'WHEN 3 THEN count(*) FILTER (WHERE application_area = ANY($1::text[])) WHEN 5 THEN count(*) ' +
        'ELSE count(*) FILTER (WHERE application_area = ANY($2::text[])) END',
    );
    expect(facets.text).toContain(`WHERE ${LISTED(4)} AND application_area = ANY($5::text[])) AS cert`);
  });

  it('gives each of the three list facets every other list filter, in the order of the search', () => {
    const facets = sql({ function: ['Surfactant'], applicationArea: ['Home Care'], region: ['EMEA'] });
    const fn = 'function = ANY($?::text[])';
    const area = 'application_area = ANY($?::text[])';
    const region = 'region = ANY($?::text[])';

    expect(anyParams(facets.text)).toContain(
      `WHEN 3 THEN count(*) FILTER (WHERE ${area} AND ${region}) ` +
        `WHEN 5 THEN count(*) FILTER (WHERE ${fn} AND ${region}) ` +
        `ELSE count(*) FILTER (WHERE ${fn} AND ${area}) END`,
    );
  });

  it('keeps the certifications filter in every count, as a product must have all of them', () => {
    // Certifications are ALL, not ANY. So a count says how many products are left if this one is picked too.
    const facets = sql({ certifications: ['Halal'] });

    expect(facets.text).toBe(
      lines(
        `${FACET_NAME}, count(*)::int AS count`,
        'FROM product',
        `WHERE ${LISTED(1)} AND certifications @> $2::text[]`,
        SETS,
        'UNION ALL',
        CERT_SELECT,
        `FROM (SELECT unnest(certifications) AS value FROM product WHERE ${LISTED(3)} AND certifications @> $4::text[]) AS cert`,
        ...CERT_END,
      ),
    );
    expect(facets.values).toEqual([DEFAULT_STATUSES, ['Halal'], DEFAULT_STATUSES, ['Halal']]);
  });

  it('counts certifications with exactly the filters of the search', () => {
    const search = normalizeFacetSearch({
      function: ['Surfactant'],
      applicationArea: ['Home Care'],
      region: ['EMEA'],
      certifications: ['Halal', 'Vegan'],
      status: ['DISCONTINUED'],
    });
    const where = searchWhereSql(search);
    const facets = buildFacetSql(search);

    expect(anyParams(facets.text)).toContain(
      `FROM (SELECT unnest(certifications) AS value FROM product WHERE ${anyParams(where.text)}) AS cert`,
    );
    expect(facets.values.slice(-where.values.length)).toEqual(where.values);
  });

  it('escapes LIKE wildcards and sends every value as a parameter', () => {
    const facets = sql({ q: "100% O'Brien", function: ["'; DROP TABLE product; --"] });

    expect(facets.text).not.toContain('Brien');
    expect(facets.text).not.toContain('DROP');
    expect(facets.values).toContain('%100\\%%');
    expect(facets.values).toContain("%O'Brien%");
  });
});

describe('toFacets', () => {
  const row = (facet: FacetCountRow['facet'], value: string, count: number): FacetCountRow => ({
    facet,
    value,
    count,
  });
  const rows: FacetCountRow[] = [
    row('applicationArea', 'Home Care', 7),
    row('certifications', 'Halal', 4),
    row('function', 'Surfactant', 9),
    row('region', 'EMEA', 3),
    row('region', 'Global', 2),
    row('region', 'North America', 4),
  ];

  it('adds the Global products to every other region, as a search for that region lists them', () => {
    const regions = toFacets([row('region', 'EMEA', 3), row('region', 'Global', 2)]).regions;

    expect(regions).toEqual([
      { value: 'EMEA', count: 5 },
      { value: 'Global', count: 2 },
    ]);
    expect(toFacets([row('region', 'EMEA', 3)]).regions).toEqual([{ value: 'EMEA', count: 3 }]);
  });

  it('keeps the values of the unfiltered facets, with 0 for a value the filters leave out', () => {
    const base = toFacets([...rows, row('function', 'Emulsifier', 5), row('region', 'Asia Pacific', 1)]);
    // The order of the base wins, also for a value that only the base has.
    const filtered = toFacets([row('function', 'Surfactant', 2), row('region', 'Global', 1)], base);

    expect(filtered.functions).toEqual([
      { value: 'Surfactant', count: 2 },
      { value: 'Emulsifier', count: 0 },
    ]);
    expect(filtered.regions).toEqual([
      { value: 'EMEA', count: 1 },
      { value: 'Global', count: 1 },
      { value: 'North America', count: 1 },
      { value: 'Asia Pacific', count: 1 },
    ]);
    expect(filtered.applicationAreas).toEqual([{ value: 'Home Care', count: 0 }]);
    expect(filtered.certifications).toEqual([{ value: 'Halal', count: 0 }]);
  });
});
