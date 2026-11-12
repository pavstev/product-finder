import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '@product-finder/server';
import { CatalogVersion, catalogEtag } from './catalog-version.js';

describe('catalogEtag', () => {
  it('changes with the catalog version, so a new import gives a new ETag', () => {
    const before = catalogEtag('run-1', 'a');
    const after = catalogEtag('run-2', 'a');

    expect(after).not.toBe(before);
    expect(after.slice(-18)).toBe(before.slice(-18));
  });
});

describe('CatalogVersion', () => {
  const END = new Date('2026-11-10T02:30:00.000Z');

  function versionWith(run: { id: string; finishedAt: Date } | null) {
    const findFirst = jest.fn((_query: unknown) => Promise.resolve(run));
    const prisma = { importRun: { findFirst } } as unknown as PrismaService;
    return { version: new CatalogVersion(prisma), findFirst };
  }

  it('is the id of the newest succeeded import run, read with one indexed query', async () => {
    const { version, findFirst } = versionWith({
      id: '18bc8725-0af7-4ffd-94b8-12384e7b59e5',
      finishedAt: END,
    });

    await expect(version.current()).resolves.toBe('18bc8725-0af7-4ffd-94b8-12384e7b59e5');
    // import_run_status_finished_at_idx is (status, finished_at DESC).
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: 'SUCCEEDED' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, finishedAt: true },
    });
  });
});
