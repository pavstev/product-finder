import { describe, expect, it } from '@jest/globals';
import { DEFAULT_VISIBLE_STATUSES, effectiveStatuses, isReviewable, regionsToMatch } from './visibility.js';

describe('isReviewable', () => {
  it('allows active and phase-out products in the export', () => {
    expect(isReviewable({ inLatestExport: true, status: 'ACTIVE' })).toBe(true);
    expect(isReviewable({ inLatestExport: true, status: 'PHASE_OUT' })).toBe(true);
  });

  it('refuses discontinued products and products outside the export', () => {
    expect(isReviewable({ inLatestExport: true, status: 'DISCONTINUED' })).toBe(false);
    expect(isReviewable({ inLatestExport: false, status: 'ACTIVE' })).toBe(false);
  });
});

describe('effectiveStatuses', () => {
  it('defaults to active and phase-out', () => {
    expect(effectiveStatuses(undefined)).toEqual(DEFAULT_VISIBLE_STATUSES);
    expect(effectiveStatuses([])).toEqual(DEFAULT_VISIBLE_STATUSES);
  });

  it('keeps the requested statuses', () => {
    expect(effectiveStatuses(['DISCONTINUED'])).toEqual(['DISCONTINUED']);
  });
});

describe('regions', () => {
  it('adds Global to every region filter', () => {
    expect(regionsToMatch(['EMEA'])).toEqual(['EMEA', 'Global']);
    expect(regionsToMatch(['EMEA', 'Global'])).toEqual(['EMEA', 'Global']);
  });
});
