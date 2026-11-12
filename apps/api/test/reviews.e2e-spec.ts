import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ReviewsService } from '@product-finder/api';
import type { PrismaService } from '@product-finder/server';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { expectMatchesContract } from './contract.js';
import { createTestApp, expectProblem, nextIp, runImportCli, validReview, writeCsv } from './helpers.js';
import { resetDatabase, resetReviews } from './test-db.js';

let app: INestApplication<App>;
let prisma: PrismaService;

/** A fresh catalogue. The import runs in a child process (about a second), so only where needed. */
async function freshCatalog(): Promise<void> {
  await resetDatabase(prisma);
  await runImportCli();
}

// One import for the file. Each test starts without reviews. Tests that change a product
// put the catalogue back afterwards (freshCatalog in afterEach).
beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
  await freshCatalog();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetReviews(prisma);
});

const post = (sku: string, body: object, ip = nextIp()) =>
  request(app.getHttpServer()).post(`/api/products/${sku}/reviews`).set('X-Forwarded-For', ip).send(body);

describe('POST /api/products/:sku/reviews', () => {
  it('creates a review and updates the aggregates', async () => {
    const res = await post('p-10001', { ...validReview, authorName: '  Ana  ' }).expect(201);
    expectMatchesContract(res, 'createReview');
    expect(res.body).toEqual({
      id: expect.any(String),
      rating: 4,
      title: 'Works well',
      body: validReview.body,
      authorName: 'Ana',
      createdAt: expect.any(String),
    });
    // No title: the review comes back with a null title, which the contract allows.
    const untitled = await post('P-10001', { ...validReview, rating: 5, title: undefined }).expect(201);
    expectMatchesContract(untitled, 'createReview');

    const detail = await request(app.getHttpServer()).get('/api/products/P-10001').expect(200);
    expectMatchesContract(detail, 'getProduct');
    expect(detail.body).toMatchObject({ reviewCount: 2, ratingAvg: 4.5 });
  });

  it('keeps the aggregates right under concurrent writes', async () => {
    const ratings = [1, 2, 3, 4, 5, 5, 4, 3];
    await Promise.all(ratings.map((rating) => post('P-10002', { ...validReview, rating }).expect(201)));
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10002' } });
    expect(product.reviewCount).toBe(ratings.length);
    expect(product.ratingSum).toBe(27);
    expect(product.ratingAvg).toBeCloseTo(27 / 8);
  });

  it('rejects invalid input with a 400 problem that lists the errors', async () => {
    const res = await post('P-10001', { rating: 6, body: 'short', authorName: 'A' });
    expectProblem(res, 400, 'createReview');
    expect(res.body).toMatchObject({ title: 'Bad Request', instance: '/api/products/P-10001/reviews' });
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('rating')]));
    expect(res.body).not.toHaveProperty('message');
    expectProblem(await post('P-10001', { ...validReview, extra: 'x' }), 400, 'createReview');
    expect(await prisma.review.count()).toBe(0);
  });

  it('returns 404 for an unknown product', async () => {
    expectProblem(await post('NOPE-1', validReview), 404, 'createReview');
  });

  it('returns 409 for a discontinued product', async () => {
    const res = await post('P-10151', validReview);
    expect(expectProblem(res, 409, 'createReview')).toMatchObject({ title: 'Conflict' });
    expect(res.body.detail).toContain('no longer sold');
  });
});

// Moved here from the import e2e tests, which check the same case in the database.
describe('a product that left the export', () => {
  afterEach(freshCatalog);

  it('is hidden from search, but its page and reviews still work, and it takes no new review', async () => {
    await post('P-10001', validReview).expect(201);
    await runImportCli(writeCsv((line) => !line.startsWith('P-10001,')));

    const server = app.getHttpServer();
    const search = await request(server).get('/api/products').query({ q: 'P-10001' }).expect(200);
    expectMatchesContract(search, 'searchProducts');
    expect(search.body.total).toBe(0);
    const withDiscontinued = await request(server)
      .get('/api/products')
      .query({ q: 'P-10001', status: 'ACTIVE,PHASE_OUT,DISCONTINUED' })
      .expect(200);
    expectMatchesContract(withDiscontinued, 'searchProducts');
    expect(withDiscontinued.body.total).toBe(0);

    const detail = await request(server).get('/api/products/P-10001').expect(200);
    expectMatchesContract(detail, 'getProduct');
    expect(detail.body).toMatchObject({
      sku: 'P-10001',
      inLatestExport: false,
      reviewable: false,
      reviewCount: 1,
    });
    const reviews = await request(server).get('/api/products/P-10001/reviews').expect(200);
    expectMatchesContract(reviews, 'listReviews');
    expect(reviews.body.total).toBe(1);
    expectProblem(await post('P-10001', validReview), 409, 'createReview');

    // It comes back when the export lists it again.
    await runImportCli();
    const back = await request(server).get('/api/products/P-10001').expect(200);
    expectMatchesContract(back, 'getProduct');
    expect(back.body.inLatestExport).toBe(true);
  });
});

describe('POST review while the import changes the product', () => {
  let reviews: ReviewsService;

  beforeAll(() => {
    reviews = app.get(ReviewsService);
  });

  afterEach(async () => {
    reviews.beforeAggregateUpdate = undefined;
    await freshCatalog();
  });

  it('answers 409 and stores nothing when the product leaves the export during the write', async () => {
    // The early check passes. Then, before the aggregate update, the "import" hides the product
    // in its own transaction.
    reviews.beforeAggregateUpdate = async () => {
      await prisma.product.update({ where: { sku: 'P-10001' }, data: { inLatestExport: false } });
    };
    const res = await post('P-10001', validReview);
    expectProblem(res, 409, 'createReview');
    expect(res.body.detail).toContain('no longer sold');
    expect(await prisma.review.count()).toBe(0);
    expect(await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } })).toMatchObject({
      inLatestExport: false,
      reviewCount: 0,
      ratingSum: 0,
      ratingAvg: null,
    });
  });

  it('answers 409 when the product becomes discontinued during the write', async () => {
    reviews.beforeAggregateUpdate = async () => {
      await prisma.product.update({ where: { sku: 'P-10002' }, data: { status: 'DISCONTINUED' } });
    };
    expectProblem(await post('P-10002', validReview), 409, 'createReview');
    expect(await prisma.review.count()).toBe(0);
  });
});

describe('POST review while another transaction locks the product row', () => {
  let limitedApp: INestApplication<App>;

  // The service reads the limits when it is built, so this app gets its own instance.
  beforeAll(async () => {
    const saved = { maxWait: process.env.REVIEW_TX_MAX_WAIT_MS, timeout: process.env.REVIEW_TX_TIMEOUT_MS };
    process.env.REVIEW_TX_MAX_WAIT_MS = '500';
    process.env.REVIEW_TX_TIMEOUT_MS = '1000';
    try {
      ({ app: limitedApp } = await createTestApp());
    } finally {
      restoreEnv('REVIEW_TX_MAX_WAIT_MS', saved.maxWait);
      restoreEnv('REVIEW_TX_TIMEOUT_MS', saved.timeout);
    }
  });

  afterAll(async () => {
    await limitedApp.close();
  });

  // FOR UPDATE blocks the foreign key check of the review insert.
  // FOR NO KEY UPDATE (what the import's UPDATE takes) blocks only the aggregate update.
  it.each(['FOR UPDATE', 'FOR NO KEY UPDATE'])(
    'answers 503 with Retry-After long before a %s lock ends',
    async (lock) => {
      const postLimited = (sku: string) =>
        request(limitedApp.getHttpServer())
          .post(`/api/products/${sku}/reviews`)
          .set('X-Forwarded-For', nextIp())
          .send(validReview);
      // The limits allow a normal write. This also opens the app's first database connection.
      await postLimited('P-10002').expect(201);

      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT id FROM product WHERE sku = 'P-10001' ${lock}`);
        // Hold the row lock for 3 s. The 1 s limit must end the wait long before that.
        const started = Date.now();
        const [{ res, elapsed }] = await Promise.all([
          postLimited('P-10001').then((answer) => ({ res: answer, elapsed: Date.now() - started })),
          sleep(3000).then(() => holder.query('ROLLBACK')),
        ]);

        expectProblem(res, 503, 'createReview');
        expect(res.headers['retry-after']).toBe('5');
        expect(elapsed).toBeLessThan(2000);
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|P20\d\d|55P03|lock|transaction|timeout|stack/i);
      } finally {
        await holder.end();
      }
      const product = await prisma.product.findUniqueOrThrow({
        where: { sku: 'P-10001' },
        include: { reviews: true },
      });
      expect(product).toMatchObject({ reviewCount: 0, ratingSum: 0, reviews: [] });
    },
    15_000,
  );
});

describe('GET /api/products/:sku/reviews', () => {
  it('lists newest first with paging', async () => {
    for (const title of ['first', 'second', 'third']) {
      await post('P-10001', { ...validReview, title }).expect(201);
    }
    const res = await request(app.getHttpServer())
      .get('/api/products/P-10001/reviews')
      .query({ pageSize: 2 })
      .expect(200);
    expectMatchesContract(res, 'listReviews');
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['third', 'second']);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}
