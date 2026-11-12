import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { exitCodeFor, importCatalog, type ImportSummary, runSeed } from '@product-finder/import';
import { createPrismaClient, incrementRating, type PrismaClient } from '@product-finder/server/client';
import { skuProblem } from '@product-finder/shared';
import { addReview, CSV_FILE, writeCsv, writeRawCsv } from './helpers.js';
import { resetDatabase } from './test-db.js';

// The import against a real database. The HTTP side is in apps/api/test/reviews.e2e-spec.ts.

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

/** The products that get demo reviews (libs/import/src/adapters/demo-reviews.json). */
const DEMO_SKUS = ['P-10001', 'P-10002', 'P-10004', 'P-10005', 'P-10006'];

/**
 * updated_at and xmin of every product, by SKU. xmin changes on every write to a row, even one
 * that changes no value. Raw SQL never bumps updated_at, so xmin is what shows a rewrite.
 */
async function rowVersions(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ sku: string; version: string }[]>`
    SELECT sku, updated_at::text || ' xmin ' || xmin::text AS version FROM product`;
  return new Map(rows.map((row) => [row.sku, row.version]));
}

/** SKUs whose row was written between the two snapshots. */
function rewritten(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...before]
    .filter(([sku, version]) => after.get(sku) !== version)
    .map(([sku]) => sku)
    .sort();
}

/**
 * Wait until pg_locks shows a lock request that is not granted because of the given backend.
 * A session that waits for a row lock waits for the transaction that holds the row. Bounded.
 */
async function waitUntilBlockedBy(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE NOT granted AND ${pid}::int = ANY(pg_blocking_pids(pid))`;
    if (waiting > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No lock request waited for backend ${pid} within ${timeoutMs} ms`);
}

describe('catalogue import', () => {
  it('imports the real export into an empty database', async () => {
    const summary = await importCatalog(prisma, { file: CSV_FILE });
    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      rowsRead: 202,
      created: 199,
      updated: 0,
      unchanged: 0,
      rejected: 1,
      duplicates: 2,
      markedMissing: 0,
    });
    expect(await prisma.product.count()).toBe(199);
    expect(await prisma.product.findUnique({ where: { sku: 'P-10119' } })).toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10151' } })).status).toBe(
      'DISCONTINUED',
    );

    const run = await prisma.importRun.findUniqueOrThrow({ where: { id: summary.runId as string } });
    expect(run).toMatchObject({ status: 'SUCCEEDED', created: 199, rejected: 1, duplicates: 2 });
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ sku: 'P-10119', level: 'error' })]),
    );
  });

  it('changes nothing on a second run of the same file', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    const before = await prisma.product.findMany({ orderBy: { sku: 'asc' } });

    const summary = await importCatalog(prisma, { file: CSV_FILE });
    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 199, markedMissing: 0 });
    expect(await prisma.product.findMany({ orderBy: { sku: 'asc' } })).toEqual(before);
  });

  it('keeps reviews and rating aggregates when the import runs again', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    await addReview(prisma, 'P-10001', 4);
    await addReview(prisma, 'P-10001', 2);

    // Change the product in the export, so the import really updates the row.
    const changed = writeCsv(
      () => true,
      (line) => line.replace('P-10001,Quorin SF 470', 'P-10001,Quorin SF 470 New'),
    );
    const summary = await importCatalog(prisma, { file: changed });
    expect(summary.updated).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    expect(product).toMatchObject({ name: 'Quorin SF 470 New', reviewCount: 2, ratingSum: 6, ratingAvg: 3 });
    expect(await prisma.review.count({ where: { productId: product.id } })).toBe(2);
  });

  it('hides a product that left the export but keeps its row and reviews', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    await addReview(prisma, 'P-10001');

    const summary = await importCatalog(prisma, { file: writeCsv((line) => !line.startsWith('P-10001,')) });
    expect(summary.markedMissing).toBe(1);

    // Kept, so its page still opens. Out of the export, so not listed and not reviewable.
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    expect(product).toMatchObject({ inLatestExport: false, reviewCount: 1 });
    expect(await prisma.review.count({ where: { productId: product.id } })).toBe(1);
    await expect(addReview(prisma, 'P-10001')).rejects.toThrow('P-10001 is not reviewable');

    // It comes back when the export lists it again.
    expect((await importCatalog(prisma, { file: CSV_FILE })).updated).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } })).inLatestExport).toBe(true);
  });

  it('does not hide a product whose row is rejected', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    const broken = writeCsv(
      () => true,
      (line) => line.replace('P-10001,Quorin SF 470,', 'P-10001,,'),
    );
    const summary = await importCatalog(prisma, { file: broken });
    expect(summary).toMatchObject({ rejected: 2, markedMissing: 0 });
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    expect(product).toMatchObject({ name: 'Quorin SF 470', inLatestExport: true });
  });

  it('aborts on a truncated file and changes nothing', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    const tiny = writeCsv((_line, index) => index < 10);

    const summary = await importCatalog(prisma, { file: tiny });
    expect(summary.status).toBe('ABORTED');
    expect(await prisma.product.count({ where: { inLatestExport: true } })).toBe(199);
    const run = await prisma.importRun.findUniqueOrThrow({ where: { id: summary.runId as string } });
    expect(run.status).toBe('ABORTED');

    const forced = await importCatalog(prisma, { file: tiny, force: true });
    expect(forced.status).toBe('SUCCEEDED');
    expect(await prisma.product.count({ where: { inLatestExport: true } })).toBe(10);
    expect(await prisma.product.count()).toBe(199);
  });

  it('rejects rows whose SKU breaks the shared SKU rule, so no listed product is unreachable', async () => {
    const [header, first] = readFileSync(CSV_FILE, 'utf8').split(/\r?\n/);
    const withSku = (sku: string) => first.replace(/^[^,]+/, sku);
    const bad = ['P-9\u{200B}1', 'P-9\u{AD}2', 'P-9\u00073', 'P-9\u00004', `P-${'9'.repeat(70)}`];
    // The API's ParseSkuPipe answers 400 for every SKU that breaks this rule.
    expect(bad.filter((sku) => skuProblem(sku) === null)).toEqual([]);
    const file = writeRawCsv([header, first, ...bad.map(withSku)].join('\n'));

    const summary = await importCatalog(prisma, { file });
    expect(summary).toMatchObject({ status: 'SUCCEEDED', created: 1, rejected: 5 });
    const stored = await prisma.product.findMany({ select: { sku: true } });
    expect(stored).toHaveLength(1);
    expect(stored.filter(({ sku }) => skuProblem(sku) !== null)).toEqual([]);

    // A raw NUL in the stored issues would make PostgreSQL refuse the jsonb value.
    const run = await prisma.importRun.findUniqueOrThrow({ where: { id: summary.runId as string } });
    expect(run.status).toBe('SUCCEEDED');
  });

  it('keeps an already listed product when its row is rejected for the SKU rule', async () => {
    await prisma.product.create({
      data: {
        sku: 'P-9\u{200B}1',
        name: 'Legacy',
        function: 'f',
        applicationArea: 'a',
        region: 'r',
        status: 'ACTIVE',
        searchText: 'legacy',
        sourceHash: 'x',
        inLatestExport: true,
      },
    });
    const [header, first] = readFileSync(CSV_FILE, 'utf8').split(/\r?\n/);
    const file = writeRawCsv([header, first, first.replace(/^[^,]+/, 'P-9\u{200B}1')].join('\n'));
    await importCatalog(prisma, { file, force: true });
    const legacy = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-9\u{200B}1' } });
    expect(legacy.inLatestExport).toBe(true);
  });

  it('fails without writing products when a column is missing', async () => {
    const file = writeRawCsv('sku,name\nP-1,Name\n');
    await expect(importCatalog(prisma, { file })).rejects.toThrow(/Missing column/);
    expect(await prisma.product.count()).toBe(0);
    const run = await prisma.importRun.findFirstOrThrow();
    expect(run.status).toBe('FAILED');
    expect(run.error).toMatch(/chemical_name/);
  });
});

describe('import runs', () => {
  it('runs two imports at once: one succeeds, the other finds the lock taken', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    const changed = writeCsv(
      () => true,
      (line) => line.replace('P-10001,Quorin SF 470', 'P-10001,Quorin SF 470 New'),
    );

    // The import that gets the lock waits until the other one has finished, so the two really overlap.
    let release!: () => void;
    const otherFinished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = () =>
      importCatalog(prisma, { file: changed, afterLock: () => otherFinished }).finally(release);

    const results = await Promise.allSettled([start(), start()]);
    const summaries = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
    expect(summaries.map((summary) => summary?.status ?? 'REJECTED').sort()).toEqual(['LOCKED', 'SUCCEEDED']);

    const winner = summaries.find((summary) => summary?.status === 'SUCCEEDED') as ImportSummary;
    const locked = summaries.find((summary) => summary?.status === 'LOCKED') as ImportSummary;
    expect(winner.updated).toBe(1);
    expect(locked).toMatchObject({ created: 0, updated: 0, unchanged: 0, markedMissing: 0 });
    expect(exitCodeFor(locked.status)).toBe(3);
    expect(await prisma.product.count()).toBe(199);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } })).name).toBe(
      'Quorin SF 470 New',
    );
    const lockedRun = await prisma.importRun.findUniqueOrThrow({ where: { id: locked.runId as string } });
    expect(lockedRun).toMatchObject({ status: 'ABORTED', updated: 0 });
    expect(lockedRun.error).toMatch(/Another import is running/);
  });
});

describe('seed', () => {
  const withDemoReviews = { file: CSV_FILE, demoReviews: true };

  it('keeps a user review in the aggregates and rewrites no other product', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    await addReview(prisma, 'P-10001', 2);
    const before = await rowVersions();

    await runSeed(prisma, withDemoReviews);
    const afterFirst = await rowVersions();
    await runSeed(prisma, withDemoReviews);
    const afterSecond = await rowVersions();

    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    const real = await prisma.review.aggregate({
      where: { productId: product.id },
      _count: true,
      _sum: { rating: true },
    });
    // The user's 2 plus the demo reviews 5, 4 and 5.
    expect(real).toMatchObject({ _count: 4, _sum: { rating: 16 } });
    expect(product).toMatchObject({ reviewCount: real._count, ratingSum: real._sum.rating });

    // The first seed writes only the products that got demo reviews. The second writes nothing.
    const writtenByFirst = rewritten(before, afterFirst);
    expect(writtenByFirst.length).toBe(DEMO_SKUS.length);
    expect(writtenByFirst).toEqual(DEMO_SKUS);
    expect(rewritten(afterFirst, afterSecond)).toEqual([]);
  });

  it('loses no review that commits while the seed recomputes the ratings', async () => {
    await importCatalog(prisma, { file: CSV_FILE });
    const { id: productId } = await prisma.product.findUniqueOrThrow({
      where: { sku: 'P-10001' },
      select: { id: true },
    });

    // A review in flight in its own transaction: stored and counted the way the review service
    // does it (incrementRating), but not committed yet. It holds the row lock on P-10001.
    let seed: Promise<unknown> | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.review.create({
            data: { productId, rating: 2, body: 'Written while the seed runs.', authorName: 'Ana' },
          });
          expect(await incrementRating(tx, productId, 2)).toBe(true);
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

          seed = runSeed(prisma, withDemoReviews);
          seed.catch(() => {});
          // Commit only once the seed waits for the row lock. Returning from the callback commits.
          await waitUntilBlockedBy(pid);
        },
        // Longer than the bound of waitUntilBlockedBy. A failed wait rolls back and frees the row.
        { timeout: 10_000 },
      );
      await seed;
    } finally {
      await seed?.catch(() => {});
    }

    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'P-10001' } });
    const real = await prisma.review.aggregate({
      where: { productId },
      _count: true,
      _sum: { rating: true },
    });
    // The review in flight (2) plus the demo reviews 5, 4 and 5.
    expect(real).toMatchObject({ _count: 4, _sum: { rating: 16 } });
    expect(product).toMatchObject({ reviewCount: real._count, ratingSum: real._sum.rating });
  }, 15_000);
});
