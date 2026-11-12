import { describe, expect, it } from '@jest/globals';
import { FACET_BYTES_MAX } from './product-limits.js';

/** PostgreSQL refuses a B-tree index entry over this many bytes. */
const BTREE_ENTRY_MAX = 2704;

describe('product limits', () => {
  it('keep the facet values of one row inside one B-tree entry of product_facets_idx, with a margin', () => {
    // About 200 bytes of the entry go to the other columns and the tuple and array headers.
    expect(FACET_BYTES_MAX + 200).toBeLessThan(BTREE_ENTRY_MAX);
  });
});
