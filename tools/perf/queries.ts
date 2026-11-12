// The query set of the benchmark. Paths are relative to the API base, for example http://localhost:3100/api.

type Endpoint = 'search' | 'facets' | 'detail';

export interface BenchQuery {
  id: string;
  title: string;
  endpoint: Endpoint;
  path: string;
  /** The status the API answers today. Only queries that answer 200 are timed. */
  expectStatus: number;
  note?: string;
  /** Send `cursor`: the nextCursor after this many pages of `path`. The harness walks them before timing. */
  cursorAfterPages?: number;
}

const RELEVANCE_DEFAULT =
  'The API ranks a search without a sort by relevance. Q2n and Q3n use the name sort for comparison.';

export const QUERIES: readonly BenchQuery[] = [
  {
    id: 'Q1',
    title: 'default page 1, sort name',
    endpoint: 'search',
    path: '/products?page=1&sort=name',
    expectStatus: 200,
  },
  {
    id: 'Q2',
    title: 'q=glyc',
    endpoint: 'search',
    path: '/products?q=glyc',
    expectStatus: 200,
    note: RELEVANCE_DEFAULT,
  },
  {
    id: 'Q3',
    title: 'q=P-2345 (SKU fragment)',
    endpoint: 'search',
    path: '/products?q=P-2345',
    expectStatus: 200,
    note: RELEVANCE_DEFAULT,
  },
  {
    id: 'Q4',
    title: 'region=EMEA, certifications Halal and Vegan',
    endpoint: 'search',
    path: '/products?region=EMEA&certifications=Halal,Vegan',
    expectStatus: 200,
    note: 'The API parameter is certifications.',
  },
  {
    id: 'Q5',
    title: 'q=ester, function Emulsifier, sort by rating',
    endpoint: 'search',
    path: '/products?q=ester&function=Emulsifier&sort=-rating',
    expectStatus: 200,
    note: 'The API sort key is -rating (best first). There is no rating key.',
  },
  {
    id: 'Q6',
    title: 'deep page: page=800, pageSize=50',
    endpoint: 'search',
    path: '/products?page=800&pageSize=50',
    expectStatus: 400,
    note: 'page * pageSize stops at 10,000. Q6c reads the same rows by cursor, Q6m is the deepest offset page.',
  },
  { id: 'Q7', title: 'facets, no filter', endpoint: 'facets', path: '/products/facets', expectStatus: 200 },
  {
    id: 'Q8',
    title: 'facets with region=EMEA',
    endpoint: 'facets',
    path: '/products/facets?region=EMEA',
    expectStatus: 200,
    note: 'Facets take the same filters as the search.',
  },
  { id: 'Q9', title: 'detail P-200100', endpoint: 'detail', path: '/products/P-200100', expectStatus: 200 },
  // The same searches with the other sort, so one run gives the relevance cost.
  {
    id: 'Q2n',
    title: 'q=glyc, sort name',
    endpoint: 'search',
    path: '/products?q=glyc&sort=name',
    expectStatus: 200,
  },
  {
    id: 'Q3n',
    title: 'q=P-2345, sort name',
    endpoint: 'search',
    path: '/products?q=P-2345&sort=name',
    expectStatus: 200,
  },
  {
    id: 'Q5r',
    title: 'q=ester, function Emulsifier, sort relevance',
    endpoint: 'search',
    path: '/products?q=ester&function=Emulsifier&sort=relevance',
    expectStatus: 200,
  },
  // Facets with a search text, the path that finds the text matches first.
  {
    id: 'Q8q',
    title: 'facets with q=glyc and region=EMEA',
    endpoint: 'facets',
    path: '/products/facets?q=glyc&region=EMEA',
    expectStatus: 200,
  },
  // Deep pages. Q6m is the deepest page by offset. Q6c is the page of Q6 (rows 39,951 to 40,000) by cursor.
  {
    id: 'Q6m',
    title: 'deepest offset page: page=200, pageSize=50',
    endpoint: 'search',
    path: '/products?page=200&pageSize=50',
    expectStatus: 200,
  },
  {
    id: 'Q6c',
    title: 'rows of Q6 by cursor: pageSize=50 after 799 pages',
    endpoint: 'search',
    path: '/products?pageSize=50',
    expectStatus: 200,
    cursorAfterPages: 799,
  },
];

/** The path with `cursor` added. No cursor leaves it as it is. */
export function withCursor(path: string, cursor: string | null): string {
  if (cursor === null) {
    return path;
  }
  const [pathname, search = ''] = path.split('?');
  const params = new URLSearchParams(search);
  params.set('cursor', cursor);
  return `${pathname}?${params.toString()}`;
}

/** The full URL of a query. */
export function queryUrl(apiBase: string, query: BenchQuery): string {
  return `${apiBase.replace(/\/+$/, '')}${query.path}`;
}
