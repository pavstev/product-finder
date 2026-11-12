import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '@product-finder/server';
import { CatalogVersion } from './catalog-version.js';
import { CatalogService } from './catalog.service.js';

const HOUR = 3_600_000;
const NOW = new Date('2026-11-12T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

function serviceWith(lastFinishedAt: Date | null, listed = 7) {
  const prisma = {
    importRun: {
      findFirst: jest.fn((_args: unknown) =>
        Promise.resolve(lastFinishedAt ? { finishedAt: lastFinishedAt } : null),
      ),
    },
    product: { count: jest.fn(() => Promise.resolve(listed)) },
  };
  const client = prisma as unknown as PrismaService;
  return { service: new CatalogService(client, new CatalogVersion(client)), prisma };
}

describe('CatalogService.status', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is not stale 35 hours after the last successful import', async () => {
    const { service } = serviceWith(hoursAgo(35));
    expect(await service.status()).toEqual({
      lastImportAt: hoursAgo(35),
      lastSuccessfulImportAt: hoursAgo(35),
      listedProducts: 7,
      stale: false,
    });
  });

  it('is stale 37 hours after the last successful import', async () => {
    const { service } = serviceWith(hoursAgo(37));
    expect(await service.status()).toMatchObject({ lastSuccessfulImportAt: hoursAgo(37), stale: true });
  });
});
