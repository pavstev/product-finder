import type { Prisma } from '@product-finder/server/client';
import type { ImportRunLog, RunId } from '../domain/ports.js';
import type { ImportSummary } from '../domain/types.js';

/** The audit row keeps at most this many issues, so a broken file cannot create a huge row. */
const MAX_STORED_ISSUES = 1000;

/** "1 hour", "2 hours", "90 minutes". */
function span(minutes: number): string {
  const [count, unit] = minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export class PrismaImportRunLog implements ImportRunLog {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async start(source: string): Promise<RunId> {
    const run = await this.tx.importRun.create({ data: { source }, select: { id: true } });
    return run.id;
  }

  async finish(id: RunId, summary: ImportSummary): Promise<void> {
    await this.tx.importRun.update({
      where: { id },
      data: {
        // The run status enum has no LOCKED. ABORTED says it best: stopped, nothing changed.
        status: summary.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'ABORTED',
        finishedAt: new Date(),
        rowsRead: summary.rowsRead,
        created: summary.created,
        updated: summary.updated,
        unchanged: summary.unchanged,
        rejected: summary.rejected,
        duplicates: summary.duplicates,
        markedMissing: summary.markedMissing,
        issues: summary.issues.slice(0, MAX_STORED_ISSUES) as unknown as Prisma.InputJsonValue,
        error: summary.message ?? null,
      },
    });
  }

  async fail(id: RunId, error: string): Promise<void> {
    await this.tx.importRun.update({
      where: { id },
      data: { status: 'FAILED', finishedAt: new Date(), error },
    });
  }

  /** A crash can leave a run RUNNING for ever. Real runs end within the transaction timeout. */
  sweepStale(olderThanMinutes: number): Promise<number> {
    return this.tx.$executeRaw`
      UPDATE import_run
      SET status = 'FAILED', finished_at = now(),
          error = ${`Marked failed: still RUNNING after ${span(olderThanMinutes)}`}
      WHERE status = 'RUNNING' AND started_at < now() - make_interval(mins => ${olderThanMinutes}::int)`;
  }
}
