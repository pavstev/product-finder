import { describe, expect, it } from '@jest/globals';
import { DEFAULT_VISIBLE_STATUSES } from '@product-finder/shared';
import type { Prisma } from '../db/prisma-types.js';
import { incrementRating } from './increment-rating.js';

/** A transaction client that records each raw statement and reports `rows` changed rows. */
function fakeTx(rows: number) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return Promise.resolve(rows);
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

describe('incrementRating', () => {
  it('returns true when the product row counted the rating', async () => {
    await expect(incrementRating(fakeTx(1).tx, 'product-1', 4)).resolves.toBe(true);
  });

  it('returns false when no reviewable product row matched, so the caller can roll back', async () => {
    await expect(incrementRating(fakeTx(0).tx, 'product-1', 4)).resolves.toBe(false);
  });

  it('adds the rating in one statement that repeats the reviewable rule', async () => {
    const { tx, calls } = fakeTx(1);
    await incrementRating(tx, 'product-1', 4);
    expect(calls).toHaveLength(1);
    const [{ sql, values }] = calls;
    expect(sql).toMatch(/SET review_count = review_count \+ 1,/);
    expect(sql).toMatch(
      /WHERE id = \?::uuid AND in_latest_export\s+AND status = ANY\(\?::"ProductStatus"\[\]\)/,
    );
    expect(values).toEqual([4, 4, 'product-1', [...DEFAULT_VISIBLE_STATUSES]]);
  });
});
