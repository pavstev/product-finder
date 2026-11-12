// Twin: apps/api/test/test-db.ts has the same resetDatabase, plus resetReviews. Keep both in step.

import type { PrismaClient } from '@product-finder/server/client';

const GUARD_MESSAGE = 'TEST_DATABASE_URL must point to a database whose name ends in _test';

/** Empty every table. Call in beforeEach so each test starts from a known state. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // Last line of defence: never truncate a database that is not a test database.
  const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!rows[0]?.name.endsWith('_test')) {
    throw new Error(GUARD_MESSAGE);
  }
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "review", "product", "import_run" RESTART IDENTITY CASCADE');
}
