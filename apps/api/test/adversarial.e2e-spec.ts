import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '@product-finder/server';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { expectMatchesContract } from './contract.js';
import { createTestApp, expectProblem, nextIp, runImportCli, validReview } from './helpers.js';
import { resetDatabase, resetReviews } from './test-db.js';

// Hostile or unusual input. The API must answer with a 4xx or a correct result, never a 500.
// Hostile export files are tested where the import lives (apps/catalog-import/test).

let app: INestApplication<App>;
let prisma: PrismaService;

// No test here changes a product, so one import is enough. Tests that count reviews reset them first.
beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
  await resetDatabase(prisma);
  await runImportCli();
});

afterAll(async () => {
  await app.close();
});

const post = (sku: string, body: object) =>
  request(app.getHttpServer())
    .post(`/api/products/${sku}/reviews`)
    .set('X-Forwarded-For', nextIp())
    .send(body);

const search = (query: Record<string, string | number>) =>
  request(app.getHttpServer()).get('/api/products').query(query);

describe('hostile search input', () => {
  it('treats LIKE wildcards as plain text', async () => {
    for (const q of ['%', '_', '%%', 'P-1000_', '\\']) {
      const res = await search({ q }).expect(200);
      expectMatchesContract(res, 'searchProducts');
      expect({ q, total: res.body.total }).toEqual({ q, total: 0 });
    }
  });

  it('never fails with a 500 on an absurd page number', async () => {
    for (const page of ['1e12', '1e300', '9007199254740993', '1.5', '-1', 'abc']) {
      const res = await search({ page });
      // Either the page (200) or a problem (400). The contract lists both.
      expectMatchesContract(res, 'searchProducts');
      expect({ page, status: res.status }).toEqual({ page, status: expect.any(Number) });
      expect(res.status).toBeLessThan(500);
    }
    await search({ page: '1.5' }).expect(400);
    await search({ page: 10_001, pageSize: 1 }).expect(400);
    await search({ page: 10_000, pageSize: 1 }).expect(200);
    // page * pageSize stops at row 10,000, so page 10,000 of the default 20 is a 400.
    const deep = await search({ page: 10_000 });
    expectProblem(deep, 400, 'searchProducts');
    expect(deep.body.detail).toContain('use cursor');
    await request(app.getHttpServer())
      .get('/api/products/P-10001/reviews')
      .query({ page: '1e300' })
      .expect(400);
  });

  it('rejects control characters in the query with a 400 problem, not a 500', async () => {
    const queries = [
      'q=%00',
      'function=%00',
      'region=a%00b',
      'applicationArea=Home%20Care,%07',
      'certifications=Halal&certifications=%1B',
    ];
    for (const query of queries) {
      const res = await request(app.getHttpServer()).get(`/api/products?${query}`);
      expect({ query, status: res.status }).toEqual({ query, status: 400 });
      expectProblem(res, 400, 'searchProducts');
    }
  });

  it('rejects a repeated q with a 400 problem, also with sort relevance or a cursor', async () => {
    // Express turns a repeated key into an array. A validator that called q.trim() gave a 500.
    const paths = [
      '/api/products?q=a&q=b',
      '/api/products?q=a&q=b&sort=relevance',
      '/api/products?q=a&q=b&cursor=abc',
      '/api/products?q=a&q=b&sort=name&cursor=abc',
      '/api/products/facets?q=a&q=b',
    ];
    for (const path of paths) {
      const res = await request(app.getHttpServer()).get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
      expectProblem(res, 400, path.includes('facets') ? 'getFacets' : 'searchProducts');
      expect(res.body.errors).toContain('q must be a string');
    }
  });
});

describe('hostile SKU in the path', () => {
  beforeAll(async () => {
    await resetReviews(prisma);
  });

  // %00 is NUL. %E2%80%AE is U+202E, a bidi override. %E2%80%8B is U+200B, a zero width space.
  // Both are format characters (Cf). A SKU has at most 64 characters.
  const badSkus = ['%00', '%E2%80%AE', 'P-1%E2%80%8B0001', `P-${'1'.repeat(63)}`, '%20%20'];

  it('rejects control and format characters, a blank SKU and a too long SKU with 400', async () => {
    for (const sku of badSkus) {
      const res = await request(app.getHttpServer()).get(`/api/products/${sku}`);
      expect({ sku, status: res.status }).toEqual({ sku, status: 400 });
      expectProblem(res, 400, 'getProduct');
    }
  });
});

describe('hostile review input', () => {
  beforeEach(async () => {
    await resetReviews(prisma);
  });

  it('rejects a NUL character with 400 (PostgreSQL text cannot store it)', async () => {
    await post('P-10001', { ...validReview, body: 'Nice product\u0000 really nice' }).expect(400);
    await post('P-10001', { ...validReview, authorName: 'An\u0000a' }).expect(400);
    expect(await prisma.review.count()).toBe(0);
  });

  it('counts length like the database does, so long emoji text gives 400 and not 500', async () => {
    // "❤️" is two code points (U+2764 U+FE0F). The varchar limits count code points.
    const heart = '❤️';
    await post('P-10001', { ...validReview, authorName: heart.repeat(40) }).expect(400);
    await post('P-10001', { ...validReview, title: heart.repeat(70) }).expect(400);
    await post('P-10001', { ...validReview, body: heart.repeat(1500) }).expect(400);
    expect(await prisma.review.count()).toBe(0);
  });

  it('rejects ratings that are not whole numbers from 1 to 5', async () => {
    for (const rating of [0, 6, 4.5, '5', true, null]) {
      await post('P-10001', { ...validReview, rating }).expect(400);
    }
    expect(await prisma.review.count()).toBe(0);
  });

  it('does not change aggregates when the review is rejected', async () => {
    await post('P-10001', { ...validReview, body: 'x' }).expect(400);
    await post('P-10151', validReview).expect(409);
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    expect(product).toMatchObject({ reviewCount: 0, ratingSum: 0, ratingAvg: null });
  });
});
