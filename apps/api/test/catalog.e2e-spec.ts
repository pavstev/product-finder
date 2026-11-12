import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '@product-finder/server';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { expectMatchesContract } from './contract.js';
import { createTestApp, runImportCli, writeCsv } from './helpers.js';
import { resetDatabase } from './test-db.js';

let app: INestApplication<App>;
let prisma: PrismaService;

beforeAll(async () => {
  ({ app, prisma } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

describe('GET /api/catalog/status', () => {
  it('reports the last successful import, not an aborted one', async () => {
    await runImportCli();
    // Exit code 2: the 50% guard aborted the run.
    await runImportCli(
      writeCsv((_line, index) => index < 3),
      2,
    );
    const runs = await prisma.importRun.findMany({ orderBy: { startedAt: 'asc' } });
    expect(runs.map((r) => r.status)).toEqual(['SUCCEEDED', 'ABORTED']);

    const run = runs[0];
    const listed = await prisma.product.count({ where: { status: { in: ['ACTIVE', 'PHASE_OUT'] } } });
    const res = await request(app.getHttpServer()).get('/api/catalog/status').expect(200);
    expectMatchesContract(res, 'getCatalogStatus');
    expect(res.body).toEqual({
      lastImportAt: run.finishedAt?.toISOString(),
      lastSuccessfulImportAt: run.finishedAt?.toISOString(),
      listedProducts: listed,
      stale: false,
    });
  });

  it('reports stale once the last successful import is older than 36 hours', async () => {
    await runImportCli();
    const old = new Date(Date.now() - 37 * 3_600_000);
    await prisma.importRun.updateMany({ where: { status: 'SUCCEEDED' }, data: { finishedAt: old } });
    const res = await request(app.getHttpServer()).get('/api/catalog/status').expect(200);
    expectMatchesContract(res, 'getCatalogStatus');
    expect(res.body).toMatchObject({ lastSuccessfulImportAt: old.toISOString(), stale: true });
  });
});

describe('GET /api/catalog/status caching', () => {
  const status = () => request(app.getHttpServer()).get('/api/catalog/status');

  it('answers 304 to the ETag of the last answer, and gives a new ETag after an import', async () => {
    const empty = await status().expect(200);
    expect(empty.headers.etag).toMatch(/^W\/"none-[A-Za-z0-9_-]{16}"$/);
    expect(empty.headers['cache-control']).toBe('public, max-age=60');

    const same = await status().set('If-None-Match', empty.headers.etag).expect(304);
    expectMatchesContract(same, 'getCatalogStatus');
    expect((same.text as string | undefined) ?? '').toBe('');
    expect(same.headers.etag).toBe(empty.headers.etag);

    await runImportCli();
    const run = await prisma.importRun.findFirstOrThrow({ where: { status: 'SUCCEEDED' } });
    const after = await status().set('If-None-Match', empty.headers.etag).expect(200);
    expectMatchesContract(after, 'getCatalogStatus');
    expect(after.headers.etag).toMatch(new RegExp(`^W/"${run.id}-[A-Za-z0-9_-]{16}"$`));
    expect(after.body.listedProducts).toBeGreaterThan(0);
  });
});
