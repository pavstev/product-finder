import { describe, expect, it } from '@jest/globals';
import { PRODUCT_STATUSES } from '@product-finder/shared';
import { ProductStatus } from './client.js';

// The schema owns the database enum, and shared owns the rules. They must list the same values.
// A status added to schema.prisma without PRODUCT_STATUSES (or the other way round) fails here.
describe('ProductStatus parity', () => {
  it('has the same values in the Prisma enum and in shared', () => {
    expect(Object.values(ProductStatus).sort()).toEqual([...PRODUCT_STATUSES].sort());
  });
});
