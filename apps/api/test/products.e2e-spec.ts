import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaService } from '@product-finder/server';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { expectMatchesContract } from './contract.js';
import { createTestApp, expectProblem, nextIp, runImportCli, validReview, writeCsv } from './helpers.js';
import { resetDatabase, resetReviews } from './test-db.js';

interface Summary {
  sku: string;
  name: string;
  region: string;
  status: string;
  certifications: string[];
  launchYear: number | null;
  function: string;
}

let app: INestApplication<App>;
let prisma: PrismaService;

// These tests only read, so one import for the whole file is enough.
// One facet test imports a changed export, then the real one again.
beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
  await resetDatabase(prisma);
  await runImportCli();
});

afterAll(async () => {
  await app.close();
});

// A fresh client IP per request: the cursor walks send hundreds of searches, more than the read
// limit of one IP (600 per minute) allows.
const get = (query: Record<string, string | number | string[]> = {}) =>
  request(app.getHttpServer()).get('/api/products').set('X-Forwarded-For', nextIp()).query(query);

/** A search that must answer 200 with a body that fits the contract. */
async function search(query: Record<string, string | number | string[]> = {}) {
  const res = await get(query).expect(200);
  expectMatchesContract(res, 'searchProducts');
  return res;
}

async function all(query: Record<string, string | string[]> = {}): Promise<Summary[]> {
  const res = await search({ ...query, pageSize: 50 });
  const items: Summary[] = [...res.body.items];
  for (let page = 2; (page - 1) * 50 < res.body.total; page += 1) {
    items.push(...(await search({ ...query, pageSize: 50, page })).body.items);
  }
  return items;
}

describe('GET /api/products', () => {
  it('lists active and phase-out products by default, sorted by name', async () => {
    const res = await search();
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(res.body.items).toHaveLength(20);
    const expected = await prisma.product.count({ where: { status: { in: ['ACTIVE', 'PHASE_OUT'] } } });
    expect(res.body.total).toBe(expected);

    const items = await all();
    expect(items.every((p) => p.status !== 'DISCONTINUED')).toBe(true);
    const names = items.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('includes discontinued products only when asked', async () => {
    const items = await all({ status: 'DISCONTINUED' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.status === 'DISCONTINUED')).toBe(true);
    expect(items.map((p) => p.sku)).toContain('P-10151');
  });

  it('matches every search term in any field, case-insensitive', async () => {
    const items = await all({ q: 'GLUCOS home' });
    expect(items.length).toBeGreaterThan(0);
    for (const product of items) {
      const row = await prisma.product.findUniqueOrThrow({ where: { sku: product.sku } });
      expect(row.searchText).toContain('glucos');
      expect(row.searchText).toContain('home');
    }
  });

  it('includes Global products in a region filter', async () => {
    const items = await all({ region: 'EMEA' });
    const regions = new Set(items.map((p) => p.region));
    expect(regions).toEqual(new Set(['EMEA', 'Global']));
  });

  it('requires all selected certifications', async () => {
    const items = await all({ certifications: 'Halal,Vegan' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.certifications.includes('Halal') && p.certifications.includes('Vegan'))).toBe(
      true,
    );
  });

  it('matches any of the selected functions', async () => {
    const items = await all({ function: 'Surfactant,Emulsifier' });
    expect(new Set(items.map((p) => p.function))).toEqual(new Set(['Surfactant', 'Emulsifier']));
  });

  it('sorts by launch year with unknown years last', async () => {
    const items = await all({ sort: '-launchYear', status: 'ACTIVE,PHASE_OUT,DISCONTINUED' });
    const years = items.map((p) => p.launchYear);
    const firstNull = years.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(years.slice(firstNull).every((y) => y === null)).toBe(true);
    const known = years.slice(0, firstNull) as number[];
    expect(known).toEqual([...known].sort((a, b) => b - a));
  });

  it('pages without overlap', async () => {
    const first = await search({ sort: '-launchYear', pageSize: 10, page: 1 });
    const second = await search({ sort: '-launchYear', pageSize: 10, page: 2 });
    const skus = [...first.body.items, ...second.body.items].map((p: Summary) => p.sku);
    expect(new Set(skus).size).toBe(20);
  });

  it('rejects a bad query with a 400 problem', async () => {
    const bad: Record<string, string | number>[] = [
      { pageSize: 51 },
      { page: 0 },
      { sort: 'price' },
      { status: 'SOLD' },
      { q: 'x'.repeat(101) },
      { unknown: 'x' },
    ];
    for (const query of bad) {
      expectProblem(await get(query), 400, 'searchProducts');
    }
    const res = await get({ sort: 'price' });
    expectProblem(res, 400, 'searchProducts');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: '/api/products',
      errors: [expect.stringContaining('sort')],
    });
    expect(res.body).not.toHaveProperty('message');
  });
});

describe('GET /api/products, sort relevance', () => {
  const skus = (items: Summary[]) => items.map((p) => p.sku);

  it('ranks by relevance by default when there is a search text', async () => {
    const byDefault = await all({ q: 'hydro' });
    expect(byDefault.length).toBeGreaterThan(1);
    expect(skus(byDefault)).toEqual(skus(await all({ q: 'hydro', sort: 'relevance' })));
    expect(skus(byDefault)).not.toEqual(skus(await all({ q: 'hydro', sort: 'name' })));
  });

  it('puts an exact SKU first, then SKUs that start with the text: q=P-10001 returns P-10001 first', async () => {
    // Only P-10001 holds "p-10001" in the real export. Give P-10002 a search text with p-10001 and
    // p-10010, so it competes. By name, P-10002 (Novarel EF 240) comes before P-10001 (Quorin SF 470)
    // and in the middle of P-10010 to P-10018. Put the row back after.
    const { searchText } = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10002' } });
    await prisma.product.update({
      where: { sku: 'P-10002' },
      data: { searchText: `${searchText} replaces p-10001 and p-10010` },
    });
    try {
      expect(skus((await search({ q: 'P-10001', sort: 'name' })).body.items)).toEqual(['P-10002', 'P-10001']);
      for (const q of ['P-10001', 'p-10001']) {
        expect(skus((await search({ q })).body.items)).toEqual(['P-10001', 'P-10002']);
      }

      const byName = skus(await all({ q: 'P-1001', sort: 'name' }));
      expect(byName.at(-1)).not.toBe('P-10002');
      const ranked = skus(await all({ q: 'P-1001' }));
      expect(ranked.at(-1)).toBe('P-10002');
      expect(ranked.slice(0, -1).every((sku) => sku.startsWith('P-1001'))).toBe(true);
      expect(new Set(ranked)).toEqual(new Set(byName));
    } finally {
      await prisma.product.update({ where: { sku: 'P-10002' }, data: { searchText } });
    }
  });

  it('rejects relevance without a search text with a 400 problem that says why', async () => {
    const queries: Record<string, string>[] = [{ sort: 'relevance' }, { sort: 'relevance', q: '   ' }];
    for (const query of queries) {
      const res = await get(query);
      expectProblem(res, 400, 'searchProducts');
      expect(res.body).toMatchObject({
        status: 400,
        detail: 'sort relevance needs a search text in q',
        errors: ['sort relevance needs a search text in q'],
      });
    }
  });
});

describe('GET /api/products/facets', () => {
  interface FacetValue {
    value: string;
    count: number;
  }
  type FacetList = 'functions' | 'applicationAreas' | 'regions' | 'certifications';
  type Statuses = ('ACTIVE' | 'PHASE_OUT' | 'DISCONTINUED')[];
  interface Filters {
    q?: string;
    function?: string[];
    applicationArea?: string[];
    region?: string[];
    certifications?: string[];
    status?: Statuses;
  }

  const facets = (query: Record<string, string> = {}) =>
    request(app.getHttpServer()).get('/api/products/facets').query(query);

  /** Facets that must answer 200 with a body that fits the contract. */
  const facetsOk = async (query: Record<string, string> = {}) => {
    const res = await facets(query).expect(200);
    expectMatchesContract(res, 'getFacets');
    return res;
  };

  const valuesOf = (list: FacetValue[]) => list.map((item) => item.value);
  const asQuery = (filters: Filters): Record<string, string> =>
    Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]),
    );

  /**
   * COUNT(*) of the listed products that match the filters, with a plain Prisma where. It does not
   * use the facet SQL. Global matches every region filter, and a product needs every certification.
   */
  function countWhere(filters: Filters): Promise<number> {
    const and: Prisma.ProductWhereInput[] = [
      { inLatestExport: true, status: { in: filters.status ?? ['ACTIVE', 'PHASE_OUT'] } },
    ];
    for (const term of (filters.q ?? '').split(/\s+/).filter((part) => part.length > 0)) {
      and.push({ searchText: { contains: term, mode: 'insensitive' } });
    }
    if (filters.function) {
      and.push({ function: { in: filters.function } });
    }
    if (filters.applicationArea) {
      and.push({ applicationArea: { in: filters.applicationArea } });
    }
    if (filters.region) {
      and.push({ region: { in: [...filters.region, 'Global'] } });
    }
    if (filters.certifications) {
      and.push({ certifications: { hasEvery: filters.certifications } });
    }
    return prisma.product.count({ where: { AND: and } });
  }

  /** What each facet value must count: a search with that value instead of the facet's own filter. */
  const expected: Record<FacetList, (filters: Filters, value: string) => Filters> = {
    functions: (filters, value) => ({ ...filters, function: [value] }),
    applicationAreas: (filters, value) => ({ ...filters, applicationArea: [value] }),
    regions: (filters, value) => ({ ...filters, region: [value] }),
    // ALL, not ANY: the count keeps the picked certifications and adds this one.
    certifications: (filters, value) => ({
      ...filters,
      certifications: [...(filters.certifications ?? []), value],
    }),
  };

  it('returns every value of the listed products, sorted, with a count', async () => {
    const res = await facetsOk();
    expect(valuesOf(res.body.regions)).toEqual([
      'Asia Pacific',
      'EMEA',
      'Global',
      'Latin America',
      'North America',
    ]);
    expect(res.body.statuses).toEqual(['ACTIVE', 'PHASE_OUT', 'DISCONTINUED']);
    expect(valuesOf(res.body.functions)).toContain('Surfactant');
    expect(valuesOf(res.body.certifications)).toContain('Halal');
    expect(valuesOf(res.body.certifications)).not.toContain('');
    const areas = valuesOf(res.body.applicationAreas);
    expect(areas).toEqual([...areas].sort());
    // Every value comes from a listed product, so nothing counts 0 without filters.
    for (const list of ['functions', 'applicationAreas', 'regions', 'certifications'] as const) {
      expect((res.body[list] as FacetValue[]).every((item) => item.count > 0)).toBe(true);
    }
  });

  it('counts like a COUNT(*) with the same filters, each list facet without its own filter', async () => {
    const cases: Filters[] = [
      {},
      { region: ['EMEA'], certifications: ['Vegan'] },
      {
        q: 'emulsions',
        function: ['Emulsifier', 'Surfactant'],
        applicationArea: ['Personal Care', 'Home Care'],
        status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      },
      { q: 'based', certifications: ['Halal', 'Vegan'], region: ['Asia Pacific'] },
    ];
    for (const filters of cases) {
      const res = await facetsOk(asQuery(filters));
      const unfiltered = await facetsOk(filters.status ? { status: filters.status.join(',') } : {});
      for (const list of ['functions', 'applicationAreas', 'regions', 'certifications'] as const) {
        const got = res.body[list] as FacetValue[];
        // The filters change the counts, never the values.
        expect(valuesOf(got)).toEqual(valuesOf(unfiltered.body[list]));
        const counts = await Promise.all(got.map((item) => countWhere(expected[list](filters, item.value))));
        expect({ filters, list, counts: got.map((item) => item.count) }).toEqual({ filters, list, counts });
      }
    }
  });

  it('keeps a value that the filters leave without products, with count 0', async () => {
    const res = await facetsOk({ q: 'no-product-has-this-text' });
    expect(valuesOf(res.body.functions)).toEqual(valuesOf((await facetsOk()).body.functions));
    expect(res.body.functions.every((item: FacetValue) => item.count === 0)).toBe(true);
  });

  it('answers 304 with no body to a second request that sends the ETag of the first', async () => {
    const first = await facetsOk({ region: 'EMEA' });
    const etag = first.headers.etag;
    const { id: version } = await prisma.importRun.findFirstOrThrow({
      where: { status: 'SUCCEEDED' },
      orderBy: { finishedAt: 'desc' },
    });
    expect(etag).toMatch(new RegExp(`^W/"${version}-[A-Za-z0-9_-]{16}"$`));
    expect(first.headers['cache-control']).toBe('public, max-age=60');

    const again = await facets({ region: 'EMEA' }).set('If-None-Match', etag).expect(304);
    expectMatchesContract(again, 'getFacets');
    expect((again.text as string | undefined) ?? '').toBe('');
    expect(again.headers.etag).toBe(etag);
    expect(again.headers['cache-control']).toBe('public, max-age=60');

    // A list of tags matches when one of them is current, and * always matches (Express fresh).
    await facets({ region: 'EMEA' }).set('If-None-Match', `W/"old-tag", ${etag}`).expect(304);
    await facets({ region: 'EMEA' }).set('If-None-Match', '*').expect(304);
    await facets({ region: 'EMEA' }).set('If-None-Match', 'W/"old-tag", W/"other"').expect(200);

    // The same filters in another spelling have the same ETag. Other filters have another one.
    await facets({ region: 'Global,EMEA' }).set('If-None-Match', etag).expect(304);
    const other = await facets({ region: 'Asia Pacific' }).set('If-None-Match', etag).expect(200);
    expect(other.headers.etag).not.toBe(etag);
  });

  it('gives a new ETag and new counts after an import, so no facets from before it are served', async () => {
    const before = await facetsOk({ status: 'DISCONTINUED' });
    expect(valuesOf(before.body.functions)).not.toContain('Retired Function');

    // P-10151 is discontinued. An export gives it a function that no other product has.
    const changed = writeCsv(
      () => true,
      (line) => (line.startsWith('P-10151,') ? line.replace(',Polymer,', ',Retired Function,') : line),
    );
    await runImportCli(changed);
    try {
      const after = await facets({ status: 'DISCONTINUED' }).set('If-None-Match', before.headers.etag);
      expect(after.status).toBe(200);
      expectMatchesContract(after, 'getFacets');
      expect(after.headers.etag).not.toBe(before.headers.etag);
      expect(after.body.functions).toContainEqual({ value: 'Retired Function', count: 1 });
      // Values of discontinued products show only when discontinued products are asked for.
      expect(valuesOf((await facetsOk()).body.functions)).not.toContain('Retired Function');
      expect(valuesOf((await facetsOk({ status: 'ACTIVE,PHASE_OUT' })).body.functions)).not.toContain(
        'Retired Function',
      );
    } finally {
      await runImportCli();
    }
    expect(valuesOf((await facetsOk({ status: 'DISCONTINUED' })).body.functions)).not.toContain(
      'Retired Function',
    );
  });

  it('rejects a bad status, a sort or a page with a 400 problem', async () => {
    expectProblem(await facets({ status: 'SOLD' }), 400, 'getFacets');
    expectProblem(await facets({ sort: 'name' }), 400, 'getFacets');
    expectProblem(await facets({ page: '2' }), 400, 'getFacets');
  });
});

describe('GET /api/products/:sku', () => {
  it('returns the detail, case-insensitive', async () => {
    const res = await request(app.getHttpServer()).get('/api/products/p-10001').expect(200);
    expectMatchesContract(res, 'getProduct');
    expect(res.body).toMatchObject({
      sku: 'P-10001',
      description: expect.stringContaining('Surfactant'),
      inLatestExport: true,
      reviewable: true,
      updatedAt: expect.any(String),
    });
  });

  it('returns 404 for an unknown SKU', async () => {
    const res = await request(app.getHttpServer()).get('/api/products/NOPE-1').expect(404);
    expectProblem(res, 404, 'getProduct');
  });
});

describe('every listed product can be opened', () => {
  it('answers 200 on GET /api/products/:sku for each product of all statuses', async () => {
    const items = await all({ status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'] });
    expect(items.length).toBeGreaterThanOrEqual(199);
    const failures: string[] = [];
    for (const { sku } of items) {
      const res = await request(app.getHttpServer()).get(`/api/products/${encodeURIComponent(sku)}`);
      if (res.status !== 200) {
        failures.push(`${sku}: ${res.status}`);
      } else {
        expectMatchesContract(res, 'getProduct');
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('GET /api/products, cursor', () => {
  const SORTS = ['name', '-name', 'launchYear', '-launchYear', '-rating', '-reviews'];

  /** Every page by nextCursor, from the first page. Each answer must fit the contract. */
  async function walk(query: Record<string, string | number>): Promise<string[]> {
    const skus: string[] = [];
    let cursor: string | null = null;
    for (let pages = 1; pages <= 300; pages += 1) {
      const res = await search(cursor ? { ...query, cursor } : query);
      expect(res.body.page).toBe(1);
      skus.push(...res.body.items.map((p: Summary) => p.sku));
      cursor = res.body.nextCursor;
      if (cursor === null) {
        return skus;
      }
    }
    throw new Error('The cursor walk did not end.');
  }

  /**
   * Ratings with ties, halves and NULLs: twelve products get a review, four of them a second one.
   * The reviews flow writes the aggregates, like in production.
   */
  async function rateSome(): Promise<void> {
    const listed = await all();
    const ratings = [5, 5, 4, 4, 4, 3, 3, 2, 5, 1, 4, 3];
    for (const [index, rating] of ratings.entries()) {
      const { sku } = listed[index * 3];
      const send = (value: number) =>
        request(app.getHttpServer())
          .post(`/api/products/${sku}/reviews`)
          .set('X-Forwarded-For', nextIp())
          .send({ ...validReview, rating: value })
          .expect(201);
      await send(rating);
      if (index < 4) {
        await send((rating % 5) + 1);
      }
    }
  }

  it('walks every visible product exactly once, in the order of the page numbers, for every sort', async () => {
    await rateSome();
    try {
      const rated = await prisma.product.findMany({ where: { ratingAvg: { not: null } } });
      expect(new Set(rated.map((p) => p.ratingAvg)).size).toBeLessThan(rated.length);
      for (const sort of SORTS) {
        const byPage = (await all({ sort })).map((p) => p.sku);
        for (const pageSize of [7, 50]) {
          const byCursor = await walk({ sort, pageSize });
          expect({ sort, pageSize, skus: byCursor }).toEqual({ sort, pageSize, skus: byPage });
          expect(new Set(byCursor).size).toBe(byCursor.length);
        }
      }
      const visible = await prisma.product.count({ where: { status: { in: ['ACTIVE', 'PHASE_OUT'] } } });
      expect((await walk({ pageSize: 7 })).length).toBe(visible);
    } finally {
      await resetReviews(prisma);
    }
  });

  it('walks all 199 products once with every status, by name and by rating', async () => {
    const status = 'ACTIVE,PHASE_OUT,DISCONTINUED';
    const every = await prisma.product.count();
    expect(every).toBe(199);
    for (const sort of ['name', '-rating']) {
      const skus = await walk({ sort, status, pageSize: 13 });
      expect(skus).toHaveLength(199);
      expect(new Set(skus).size).toBe(199);
    }
  });

  it('stops page numbers at page * pageSize 10,000 with a 400 that says to use cursor', async () => {
    expect((await search({ page: 200, pageSize: 50 })).body).toMatchObject({ items: [], nextCursor: null });
    const deep: Record<string, string | number>[] = [
      { page: 201, pageSize: 50 },
      { page: 501 },
      { page: 201, pageSize: 50, q: 'soap' },
    ];
    for (const query of deep) {
      const res = await get(query);
      expectProblem(res, 400, 'searchProducts');
      expect(res.body.detail).toContain('use cursor');
      expect(res.body.errors).toEqual([res.body.detail]);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects a cursor with relevance, with page, of another sort, or not a cursor, with a 400 problem', async () => {
    const cursor = (await search({ pageSize: 5 })).body.nextCursor as string;
    const cases: [Record<string, string | number>, string][] = [
      [{ cursor, q: 'soap' }, 'cursor does not work with sort relevance'],
      [{ cursor, q: 'soap', sort: 'relevance' }, 'cursor does not work with sort relevance'],
      [{ cursor, page: 2 }, 'Send page or cursor, not both.'],
      [{ cursor, sort: '-rating' }, 'cursor is for sort name, not -rating'],
      [{ cursor: 'not-a-cursor' }, 'cursor is not valid'],
    ];
    for (const [query, message] of cases) {
      const res = await get(query);
      expectProblem(res, 400, 'searchProducts');
      expect(res.body.errors).toEqual([expect.stringContaining(message)]);
    }
    expect((await search({ q: 'soap' })).body.nextCursor).toBeNull();
  });
});
