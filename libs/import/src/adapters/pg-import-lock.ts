import type { Prisma } from '@product-finder/server/client';
import type { ImportLock } from '../domain/ports.js';

/** A PostgreSQL advisory lock for the transaction. It ends with the transaction, also when the process dies. */
export class PgImportLock implements ImportLock {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async tryAcquire(): Promise<boolean> {
    const [{ acquired }] = await this.tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('catalog-import')) AS acquired`;
    return acquired;
  }
}
