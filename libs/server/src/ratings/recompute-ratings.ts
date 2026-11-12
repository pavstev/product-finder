import { Prisma } from '../db/prisma-types.js';

/** Recomputes the rating counters from the review table. With `skus` it locks those products first, else no lock. */
export async function recomputeRatings(
  tx: Prisma.TransactionClient,
  skus?: readonly string[],
): Promise<void> {
  if (skus) {
    // A separate statement, so the UPDATE below takes its snapshot after these locks.
    // NO KEY UPDATE, so the foreign key check of a new review does not wait.
    await tx.$queryRaw`
      SELECT id FROM product WHERE sku = ANY(${[...skus]}::text[]) ORDER BY id FOR NO KEY UPDATE`;
  }
  const onlySkus = skus ? Prisma.sql`WHERE q.sku = ANY(${[...skus]}::text[])` : Prisma.empty;
  await tx.$executeRaw`
    UPDATE product AS p
    SET review_count = s.count,
        rating_sum = s.sum,
        rating_avg = s.avg
    FROM (
      SELECT q.id,
             count(r.id)::int AS count,
             COALESCE(sum(r.rating), 0)::int AS sum,
             avg(r.rating)::float8 AS avg
      FROM product AS q
      LEFT JOIN review AS r ON r.product_id = q.id
      ${onlySkus}
      GROUP BY q.id
    ) AS s
    WHERE p.id = s.id
      AND (p.review_count IS DISTINCT FROM s.count OR p.rating_sum IS DISTINCT FROM s.sum)`;
}
