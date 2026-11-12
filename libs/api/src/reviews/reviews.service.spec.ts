import { describe, expect, it } from '@jest/globals';
import { loadConfig, type PrismaService } from '@product-finder/server';
import { lockTimeoutStatement, ReviewsService } from './reviews.service.js';

function build(env: Record<string, string>): ReviewsService {
  const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/test', ...env });
  return new ReviewsService({} as PrismaService, config);
}

describe('ReviewsService transaction limits', () => {
  it('takes REVIEW_TX_MAX_WAIT_MS and REVIEW_TX_TIMEOUT_MS from the config', () => {
    const service = build({ REVIEW_TX_MAX_WAIT_MS: '500', REVIEW_TX_TIMEOUT_MS: '1000' });
    expect(service.transactionLimits).toEqual({ maxWait: 500, timeout: 1000 });
  });
});

describe('lockTimeoutStatement', () => {
  it('writes the milliseconds into SET LOCAL, which takes no bind parameters', () => {
    expect(lockTimeoutStatement(1000)).toBe("SET LOCAL lock_timeout = '1000ms'");
    expect(lockTimeoutStatement(2147483647)).toBe("SET LOCAL lock_timeout = '2147483647ms'");
  });

  it('refuses anything that is not a whole number from 1 to 2^31 - 1', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648]) {
      expect(() => lockTimeoutStatement(value)).toThrow(
        /^The lock timeout must be a whole number of milliseconds from 1 to 2147483647\.$/,
      );
    }
  });
});
