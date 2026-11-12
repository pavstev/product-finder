import { Prisma } from '@product-finder/server';
import {
  defaultSortFor,
  effectiveStatuses,
  normalizeSku,
  PAGE_DEPTH_MAX,
  type ProductStatus,
  regionsToMatch,
  RELEVANCE_SORT,
  type SortKey,
} from '@product-finder/shared';
import type { SUMMARY_SELECT } from './product.mapper.js';
import { SORT_COLUMNS } from './search-cursor.js';

export const MAX_TERMS = 8;

/** The search filters, already validated. Lists match ANY, except certifications, which match ALL. */
export interface ProductSearch {
  q?: string;
  function?: string[];
  applicationArea?: string[];
  region?: string[];
  certifications?: string[];
  status?: ProductStatus[];
  sort?: SortKey;
}

/** A search with its page. The service fills in the defaults. */
export interface PagedSearch extends ProductSearch {
  page: number;
  pageSize: number;
}

/** Why a page is too deep for page numbers, or undefined. Deeper rows need a cursor, which relevance does not have. */
export function pageDepthProblem(page: number, pageSize: number): string | undefined {
  return page * pageSize <= PAGE_DEPTH_MAX
    ? undefined
    : `page * pageSize must be at most ${PAGE_DEPTH_MAX}. To read further, use cursor with the nextCursor of the page before (any sort except ${RELEVANCE_SORT}).`;
}

/** The requested sort, else relevance with a search text, else name. */
export function effectiveSort(search: ProductSearch): SortKey {
  return search.sort ?? defaultSortFor(search.q);
}

/** Splits the search text on whitespace. At most MAX_TERMS terms. */
export function parseTerms(q: string | undefined): string[] {
  return (q ?? '')
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_TERMS);
}

/** Listed products as a Prisma where: in the latest export and in the requested statuses. */
export function listedWhere(statuses?: readonly ProductStatus[]): Prisma.ProductWhereInput {
  return { inLatestExport: true, status: { in: [...effectiveStatuses(statuses)] } };
}

function hasItems(list: string[] | undefined): list is string[] {
  return !!list && list.length > 0;
}

// Prisma passes `contains` to ILIKE without escaping, so `%` and `_` would act as wildcards.
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Search filters to a Prisma where. Every term must match. Uses the trigram index on search_text. */
export function buildWhere(search: ProductSearch): { AND: Prisma.ProductWhereInput[] } {
  const and: Prisma.ProductWhereInput[] = [listedWhere(search.status)];
  for (const term of parseTerms(search.q)) {
    and.push({ searchText: { contains: escapeLike(term), mode: 'insensitive' } });
  }
  if (hasItems(search.function)) {
    and.push({ function: { in: search.function } });
  }
  if (hasItems(search.applicationArea)) {
    and.push({ applicationArea: { in: search.applicationArea } });
  }
  if (hasItems(search.region)) {
    and.push({ region: { in: regionsToMatch(search.region) } });
  }
  if (hasItems(search.certifications)) {
    and.push({ certifications: { hasEvery: search.certifications } });
  }
  return { AND: and };
}

/** Stable sort: sku asc is always the last key, so pages never overlap. Nulls go last. */
export function buildOrderBy(sort: SortKey | undefined): Prisma.ProductOrderByWithRelationInput[] {
  const { field, direction, nullable } =
    sort && sort !== RELEVANCE_SORT ? SORT_COLUMNS[sort] : SORT_COLUMNS.name;
  const key = { [field]: nullable ? { sort: direction, nulls: 'last' } : direction };
  return [key, { sku: 'asc' }];
}

// Raw SQL for the relevance sort. The filters below are the same rules as buildWhere. The e2e tests compare both paths.

/** Listed products as SQL. */
export function listedSql(statuses?: readonly ProductStatus[]): Prisma.Sql {
  return Prisma.sql`in_latest_export AND status = ANY(${[...effectiveStatuses(statuses)]}::"ProductStatus"[])`;
}

/** The SQL condition of each search filter. A filter that is not set has none. */
export interface SearchConditions {
  listed: Prisma.Sql;
  /** One per term. */
  text: Prisma.Sql[];
  function?: Prisma.Sql;
  applicationArea?: Prisma.Sql;
  region?: Prisma.Sql;
  certifications?: Prisma.Sql;
}

/** The search filters as SQL conditions. Every value is a parameter. */
export function searchConditions(search: ProductSearch): SearchConditions {
  return {
    listed: listedSql(search.status),
    text: parseTerms(search.q).map((term) => Prisma.sql`search_text ILIKE ${`%${escapeLike(term)}%`}`),
    function: hasItems(search.function) ? Prisma.sql`function = ANY(${search.function}::text[])` : undefined,
    applicationArea: hasItems(search.applicationArea)
      ? Prisma.sql`application_area = ANY(${search.applicationArea}::text[])`
      : undefined,
    region: hasItems(search.region)
      ? Prisma.sql`region = ANY(${regionsToMatch(search.region)}::text[])`
      : undefined,
    certifications: hasItems(search.certifications)
      ? Prisma.sql`certifications @> ${search.certifications}::text[]`
      : undefined,
  };
}

/** The conditions that are set, in the order of buildWhere. */
export function conditionList(conditions: SearchConditions): Prisma.Sql[] {
  const { listed, text, function: fn, applicationArea, region, certifications } = conditions;
  return [listed, ...text, fn, applicationArea, region, certifications].filter(
    (condition): condition is Prisma.Sql => condition !== undefined,
  );
}

/** The search filters as one SQL condition, in the order of buildWhere. */
export function searchWhereSql(search: ProductSearch): Prisma.Sql {
  return Prisma.join(conditionList(searchConditions(search)), ' AND ');
}

// The type needs every field of SUMMARY_SELECT, so a new summary field cannot be left out of the raw query.
const SUMMARY_COLUMNS: Record<keyof typeof SUMMARY_SELECT, string> = {
  sku: 'sku',
  name: 'name',
  chemicalName: 'chemical_name',
  function: 'function',
  applicationArea: 'application_area',
  region: 'region',
  certifications: 'certifications',
  status: 'status::text',
  launchYear: 'launch_year',
  ratingAvg: 'rating_avg',
  reviewCount: 'review_count',
};

// Prisma.raw is safe here: the text comes only from the constant above, never from a request.
const SUMMARY_SQL = Prisma.raw(
  Object.entries(SUMMARY_COLUMNS)
    .map(([field, column]) => (field === column ? column : `${column} AS "${field}"`))
    .join(', '),
);

/**
 * Best match first: exact SKU, SKU prefix, word_similarity of the name, then name and SKU.
 * No similarity(search_text, q) key: it scored every match and was too slow at 50k rows.
 */
function relevanceOrderSql(q: string | undefined): Prisma.Sql {
  const text = parseTerms(q).join(' ');
  const sku = normalizeSku(text);
  return Prisma.sql`(sku = ${sku}) DESC, (sku LIKE ${`${escapeLike(sku)}%`}) DESC, word_similarity(${text.toLowerCase()}, name) DESC, name, sku`;
}

/** The page and the count of a relevance search. Both use the same where fragment. */
interface SearchSql {
  page: Prisma.Sql;
  count: Prisma.Sql;
}

/** The raw SQL of a relevance search. The service runs both statements in one transaction. */
export function buildSearchSql(search: PagedSearch): SearchSql {
  if (effectiveSort(search) !== RELEVANCE_SORT) {
    throw new Error('buildSearchSql builds the relevance sort only. Use buildWhere and buildOrderBy.');
  }
  if (parseTerms(search.q).length === 0) {
    throw new Error('The relevance sort needs a search text.');
  }
  const where = searchWhereSql(search);
  const offset = (search.page - 1) * search.pageSize;
  return {
    page: Prisma.join(
      [
        Prisma.sql`SELECT ${SUMMARY_SQL}`,
        Prisma.sql`FROM product`,
        Prisma.sql`WHERE ${where}`,
        Prisma.sql`ORDER BY ${relevanceOrderSql(search.q)}`,
        Prisma.sql`LIMIT ${search.pageSize} OFFSET ${offset}`,
      ],
      '\n',
    ),
    count: Prisma.join(
      [Prisma.sql`SELECT count(*)::int AS total`, Prisma.sql`FROM product`, Prisma.sql`WHERE ${where}`],
      '\n',
    ),
  };
}
