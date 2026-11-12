import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../config/config.js';
import { poolConfig } from './database-pool.js';
import { PrismaClient } from './generated/client.js';

/** A PrismaClient for the import CLI and tests. The Nest app uses PrismaService instead. */
export function createPrismaClient(databaseUrl: string = loadConfig().DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(poolConfig(databaseUrl)) });
}
