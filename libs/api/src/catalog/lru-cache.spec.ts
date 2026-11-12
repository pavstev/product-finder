import { describe, expect, it } from '@jest/globals';
import { facetCacheKey } from './facets.query.js';
import { LruCache } from './lru-cache.js';

describe('LruCache', () => {
  it('misses after a new import: the facet key holds the catalog version', () => {
    const cache = new LruCache<string>({ maxEntries: 500, ttlMs: 60_000 });
    const search = { region: ['EMEA'] };
    cache.set(facetCacheKey('run-1', search), 'old counts');

    expect(cache.get(facetCacheKey('run-1', search))).toBe('old counts');
    expect(cache.get(facetCacheKey('run-2', search))).toBeUndefined();
  });
});
