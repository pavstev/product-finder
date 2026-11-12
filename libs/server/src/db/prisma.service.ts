import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, QueryConfig } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createApiPool } from './database-pool.js';
import { PrismaClient } from './generated/client.js';

/** pg reads `query_timeout` per query too. @types/pg lists it only on the client config. */
type TimedQuery = QueryConfig & { query_timeout: number };

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  // The pool that Prisma queries on. ping() uses it too.
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'DATABASE_URL'>) {
    const pool = createApiPool(config.DATABASE_URL);
    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
  }

  /** SELECT 1 for the readiness probe. On timeout pg drops the connection, so a hung one is not handed out again. */
  async ping(timeoutMs: number): Promise<void> {
    const query: TimedQuery = { text: 'SELECT 1', query_timeout: timeoutMs };
    await this.pool.query(query);
  }

  // Not onModuleDestroy: that runs before the server closes, and a request in flight would find an ended pool.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    // The adapter does not end a pool that it was given.
    await this.pool.end();
  }
}
