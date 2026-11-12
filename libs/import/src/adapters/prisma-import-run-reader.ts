import type { PrismaClient } from '@product-finder/server/client';
import type { ImportRunReader, ImportRunRow } from '../domain/format-runs.js';

/** The issues list stays out: it can be large. */
export class PrismaImportRunReader implements ImportRunReader {
  constructor(private readonly prisma: PrismaClient) {}

  lastRuns(limit: number): Promise<ImportRunRow[]> {
    return this.prisma.importRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        source: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        rowsRead: true,
        created: true,
        updated: true,
        unchanged: true,
        rejected: true,
        duplicates: true,
        markedMissing: true,
        error: true,
      },
    });
  }
}

/** The last `limit` import runs, newest first. */
export function listImportRuns(prisma: PrismaClient, limit: number): Promise<ImportRunRow[]> {
  return new PrismaImportRunReader(prisma).lastRuns(limit);
}
