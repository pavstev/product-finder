import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createPrismaClient, type PrismaClient } from '@product-finder/server/client';
import pg from 'pg';
import { CSV_FILE, runCli, writeCsv } from './helpers.js';
import { resetDatabase } from './test-db.js';

// The built bundle in a child process, from the workspace root, as Nx and a scheduler run it.
// The exit codes 0 to 4 must reach the shell unchanged.

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

describe('main.js import', () => {
  it('exits 0 and prints the summary, with --file relative to the working directory', async () => {
    const res = await runCli(['import', '--file', 'data/products.csv']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Import SUCCEEDED');
    expect(res.stdout).toContain('rows read 202, valid products 199');
    expect(await prisma.product.count()).toBe(199);
  });

  it('exits 2 when the 50% guard aborts', async () => {
    expect((await runCli(['import', '--file', CSV_FILE])).code).toBe(0);
    const res = await runCli(['import', '--file', writeCsv((_line, index) => index < 10)]);
    expect(res.code).toBe(2);
    expect(res.stdout).toContain('Import ABORTED');
    expect(await prisma.product.count({ where: { inLatestExport: true } })).toBe(199);
  });

  it('exits 3 when another import holds the lock', async () => {
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT pg_advisory_xact_lock(hashtext('catalog-import'))");
      const res = await runCli(['import', '--file', CSV_FILE]);
      expect(res.code).toBe(3);
      expect(res.stdout).toContain('Import LOCKED');
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
    expect(await prisma.product.count()).toBe(0);
  });
});
