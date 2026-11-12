import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_SORT,
  defaultSortFor,
  lastPageFor,
  PAGE_DEPTH_MAX,
  PAGE_MAX,
  RELEVANCE_SORT,
  SORT_KEYS,
} from './search.js';

describe('sort keys', () => {
  it('has relevance as a sort key, and name as the default without a search text', () => {
    expect(SORT_KEYS).toContain(RELEVANCE_SORT);
    expect(RELEVANCE_SORT).toBe('relevance');
    expect(DEFAULT_SORT).toBe('name');
  });
});

describe('defaultSortFor', () => {
  it('ranks by relevance when there is a search text', () => {
    expect(defaultSortFor('glucos')).toBe('relevance');
  });
});

describe('page depth', () => {
  it('lets page numbers reach row 10,000 at most: page * pageSize <= 10,000', () => {
    expect(PAGE_DEPTH_MAX).toBe(10_000);
    expect(lastPageFor(20)).toBe(500);
    expect(lastPageFor(50)).toBe(200);
    expect(lastPageFor(3)).toBe(3333);
    expect(lastPageFor(1)).toBe(PAGE_MAX);
  });
});
