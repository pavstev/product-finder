import { describe, expect, it } from '@jest/globals';
import { SEARCH_TEXT_VERSION, sourceHash } from './hash.js';
import type { NormalizedProduct } from './types.js';

const row: NormalizedProduct = {
  sku: 'P-1',
  name: 'Name',
  chemicalName: 'Chem',
  function: 'Polymer',
  applicationArea: 'Coatings',
  region: 'EMEA',
  certifications: ['Halal'],
  status: 'ACTIVE',
  launchYear: 2020,
  description: 'Text',
};

describe('sourceHash', () => {
  it('changes when SEARCH_TEXT_VERSION changes, for the same row', () => {
    expect(sourceHash(row, SEARCH_TEXT_VERSION + 1)).not.toBe(sourceHash(row, SEARCH_TEXT_VERSION));
  });
});
