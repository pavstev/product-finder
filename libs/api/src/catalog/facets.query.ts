import { Prisma } from '@product-finder/server';
import { effectiveStatuses, GLOBAL_REGION, PRODUCT_STATUSES, regionsToMatch } from '@product-finder/shared';
import type { FacetsDto, FacetValueDto } from './dto/product.dto.js';
import {
  conditionList,
  type ProductSearch,
  parseTerms,
  type SearchConditions,
  searchConditions,
} from './products.query.js';

// Facet counts. Each facet counts with every active filter except its own.
// Certifications keep their own filter, because a product must have all of them.
// Values come from the listed products alone, so a value that the filters leave out is still there, with 0.

type FacetField = 'function' | 'applicationArea' | 'region' | 'certifications';

/** One row of buildFacetSql. */
export interface FacetCountRow {
  facet: FacetField;
  value: string;
  count: number;
}

function sortedUnique(values: readonly string[] | undefined): string[] | undefined {
  const unique = [...new Set(values ?? [])].sort();
  return unique.length > 0 ? unique : undefined;
}

/** The facet filters in one form, so queries that mean the same get the same cache key and ETag. */
export function normalizeFacetSearch(search: ProductSearch): ProductSearch {
  const terms = [...new Set(parseTerms(search.q))].sort();
  const statuses = new Set(effectiveStatuses(search.status));
  return {
    ...(terms.length > 0 && { q: terms.join(' ') }),
    ...(sortedUnique(search.function) && { function: sortedUnique(search.function) }),
    ...(sortedUnique(search.applicationArea) && { applicationArea: sortedUnique(search.applicationArea) }),
    ...(sortedUnique(search.region) && { region: sortedUnique(regionsToMatch(search.region ?? [])) }),
    ...(sortedUnique(search.certifications) && { certifications: sortedUnique(search.certifications) }),
    status: PRODUCT_STATUSES.filter((status) => statuses.has(status)),
  };
}

/** The normalized query as text, for the cache key and the ETag hash. */
export function facetQueryKey(search: ProductSearch): string {
  const { q, function: fn, applicationArea, region, certifications, status } = search;
  return JSON.stringify([
    q ?? '',
    fn ?? [],
    applicationArea ?? [],
    region ?? [],
    certifications ?? [],
    status,
  ]);
}

// The key holds the catalog version, so a new import never reads the facets of the one before.
export function facetCacheKey(version: string, search: ProductSearch): string {
  return `${version} ${facetQueryKey(search)}`;
}

/** True when a filter other than the status is set, so the values come from the unfiltered facets. */
export function hasFacetFilters(search: ProductSearch): boolean {
  return (
    [search.function, search.applicationArea, search.region, search.certifications].some(
      (list) => (list?.length ?? 0) > 0,
    ) || parseTerms(search.q).length > 0
  );
}

const present = (...conditions: (Prisma.Sql | undefined)[]) =>
  conditions.filter((condition): condition is Prisma.Sql => condition !== undefined);

function where(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length > 0 ? Prisma.sql` WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
}

function countSql(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length > 0
    ? Prisma.sql`count(*) FILTER (WHERE ${Prisma.join(conditions, ' AND ')})`
    : Prisma.sql`count(*)`;
}

// GROUPING() has one bit per column, set when the row is not grouped by it:
// the (function) set is 3, (application_area) 5, (region) 6.
const GROUPING = Prisma.sql`GROUPING(function, application_area, region)`;

// The count of a grouping set: every function, application area and region filter except its own.
function listFacetCount(c: SearchConditions): Prisma.Sql {
  if (!c.function && !c.applicationArea && !c.region) {
    return Prisma.sql`count(*)::int`;
  }
  return Prisma.sql`(CASE ${GROUPING} WHEN 3 THEN ${countSql(present(c.applicationArea, c.region))} WHEN 5 THEN ${countSql(present(c.function, c.region))} ELSE ${countSql(present(c.function, c.applicationArea))} END)::int`;
}

/** The facet counts of a normalized search as one statement. A search text is found once, in a MATERIALIZED CTE. */
export function buildFacetSql(search: ProductSearch): Prisma.Sql {
  const c = searchConditions(search);
  const shared = present(c.listed, ...c.text, c.certifications);
  const lists = present(c.function, c.applicationArea, c.region);
  const matchFirst = c.text.length > 0;
  const from = matchFirst ? Prisma.raw('matched') : Prisma.raw('product');
  return Prisma.join(
    [
      ...(matchFirst
        ? [
            Prisma.sql`WITH matched AS MATERIALIZED (SELECT function, application_area, region, certifications FROM product${where(shared)})`,
          ]
        : []),
      Prisma.sql`SELECT CASE ${GROUPING} WHEN 3 THEN 'function' WHEN 5 THEN 'applicationArea' ELSE 'region' END AS facet, COALESCE(function, application_area, region) AS value, ${listFacetCount(c)} AS count`,
      Prisma.sql`FROM ${from}`,
      ...(matchFirst ? [] : [Prisma.sql`WHERE ${Prisma.join(shared, ' AND ')}`]),
      Prisma.sql`GROUP BY GROUPING SETS ((function), (application_area), (region))`,
      Prisma.sql`UNION ALL`,
      Prisma.sql`SELECT 'certifications' AS facet, value, count(*)::int AS count`,
      // Without a search text this is the search's own condition list: listed, then every filter.
      Prisma.sql`FROM (SELECT unnest(certifications) AS value FROM ${from}${where(matchFirst ? lists : conditionList(c))}) AS cert`,
      Prisma.sql`GROUP BY value`,
      Prisma.sql`ORDER BY facet, value`,
    ],
    '\n',
  );
}

const FACET_KEYS = {
  function: 'functions',
  applicationArea: 'applicationAreas',
  region: 'regions',
  certifications: 'certifications',
} as const satisfies Record<FacetField, keyof FacetsDto>;

type FacetLists = Pick<FacetsDto, (typeof FACET_KEYS)[FacetField]>;

/** The rows of buildFacetSql as the response. With `base`, its values and order win and gaps count 0. */
export function toFacets(rows: readonly FacetCountRow[], base?: FacetsDto): FacetsDto {
  const counts = new Map<FacetField, Map<string, number>>();
  for (const field of Object.keys(FACET_KEYS) as FacetField[]) {
    counts.set(field, new Map());
  }
  for (const row of rows) {
    counts.get(row.facet)?.set(row.value, row.count);
  }
  const global = counts.get('region')?.get(GLOBAL_REGION) ?? 0;
  const lists = {} as FacetLists;
  for (const [field, key] of Object.entries(FACET_KEYS) as [FacetField, keyof FacetLists][]) {
    const found = counts.get(field) as Map<string, number>;
    const values = base ? base[key].map((item) => item.value) : [...found.keys()];
    lists[key] = values.map((value): FacetValueDto => {
      const count = found.get(value) ?? 0;
      return { value, count: field === 'region' && value !== GLOBAL_REGION ? count + global : count };
    });
  }
  return { ...lists, statuses: [...PRODUCT_STATUSES] };
}
