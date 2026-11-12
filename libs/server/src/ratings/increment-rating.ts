import { DEFAULT_VISIBLE_STATUSES } from '@product-finder/shared';
import type { Prisma } from '../db/prisma-types.js';

/**
 * Adds one rating to the product's counters in one atomic statement, inside the review insert transaction.
 * It checks the reviewable rule again on the locked row: false means the caller must roll back.
 */
export async function incrementRating(
  tx: Prisma.TransactionClient,
  productId: string,
  rating: number,
): Promise<boolean> {
  // The WHERE repeats isReviewable() from shared, because SQL cannot call it.
  const updated = await tx.$executeRaw`
    UPDATE product
    SET review_count = review_count + 1,
        rating_sum = rating_sum + ${rating},
        rating_avg = (rating_sum + ${rating})::float8 / (review_count + 1)
    WHERE id = ${productId}::uuid AND in_latest_export
      AND status = ANY(${[...DEFAULT_VISIBLE_STATUSES]}::"ProductStatus"[])`;
  return updated > 0;
}
