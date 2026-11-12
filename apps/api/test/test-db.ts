// Twin: apps/catalog-import/test/test-db.ts has the same resetDatabase. Keep both in step.

import { type PrismaClient, recomputeRatings } from '@product-finder/server';

const GUARD_MESSAGE = 'TEST_DATABASE_URL must point to a database whose name ends in _test';

/** Last line of defence: never empty a database that is not a test database. */
async function assertTestDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!rows[0]?.name.endsWith('_test')) {
    throw new Error(GUARD_MESSAGE);
  }
}

/** Empties every table. Call it in beforeEach. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await assertTestDatabase(prisma);
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "review", "product", "import_run" RESTART IDENTITY CASCADE');
}

/** Deletes every review and rebuilds the rating aggregates, but keeps the catalogue. Much cheaper than a new import. */
export async function resetReviews(prisma: PrismaClient): Promise<void> {
  await assertTestDatabase(prisma);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('TRUNCATE TABLE "review"');
    await recomputeRatings(tx);
  });
}
