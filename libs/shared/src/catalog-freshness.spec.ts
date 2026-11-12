import { describe, expect, it } from '@jest/globals';
import { isCatalogStale } from './catalog-freshness.js';

const HOUR = 3_600_000;
const NOW = new Date('2026-11-12T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe('isCatalogStale', () => {
  it('is fresh after 35 hours', () => {
    expect(isCatalogStale(hoursAgo(35), NOW)).toBe(false);
  });

  it('is fresh at exactly 36 hours', () => {
    expect(isCatalogStale(hoursAgo(36), NOW)).toBe(false);
  });

  it('is stale after 37 hours', () => {
    expect(isCatalogStale(hoursAgo(37), NOW)).toBe(true);
  });

  it('is stale when there was never a successful import', () => {
    expect(isCatalogStale(null, NOW)).toBe(true);
  });
});
