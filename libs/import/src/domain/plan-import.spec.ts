import { describe, expect, it } from '@jest/globals';
import { guardTrips, planImport } from './plan-import.js';
import type { PreparedProduct } from './types.js';

function product(sku: string, sourceHash = `hash-${sku}`): PreparedProduct {
  return {
    sku,
    name: sku,
    chemicalName: null,
    function: 'Polymer',
    applicationArea: 'Coatings',
    region: 'EMEA',
    certifications: [],
    status: 'ACTIVE',
    launchYear: null,
    description: null,
    searchText: sku.toLowerCase(),
    sourceHash,
  };
}

describe('planImport', () => {
  it('creates everything on an empty database', () => {
    const plan = planImport([], [product('A'), product('B')]);
    expect(plan.toCreate.map((p) => p.sku)).toEqual(['A', 'B']);
    expect(plan).toMatchObject({ toUpdate: [], unchanged: 0, missingSkus: [] });
  });

  it('skips unchanged products and updates changed ones', () => {
    const plan = planImport(
      [
        { sku: 'A', sourceHash: 'hash-A', inLatestExport: true },
        { sku: 'B', sourceHash: 'old', inLatestExport: true },
      ],
      [product('A'), product('B')],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpdate.map((p) => p.sku)).toEqual(['B']);
    expect(plan.toCreate).toEqual([]);
  });

  it('updates a product that comes back to the export with the same data', () => {
    const plan = planImport([{ sku: 'A', sourceHash: 'hash-A', inLatestExport: false }], [product('A')]);
    expect(plan.toUpdate.map((p) => p.sku)).toEqual(['A']);
  });

  it('marks listed products that are not in the file as missing', () => {
    const plan = planImport(
      [
        { sku: 'A', sourceHash: 'hash-A', inLatestExport: true },
        { sku: 'GONE', sourceHash: 'x', inLatestExport: true },
        { sku: 'ALREADY_GONE', sourceHash: 'x', inLatestExport: false },
      ],
      [product('A')],
    );
    expect(plan.missingSkus).toEqual(['GONE']);
  });

  it('does not mark a product missing when its row was rejected', () => {
    const plan = planImport(
      [
        { sku: 'A', sourceHash: 'hash-A', inLatestExport: true },
        { sku: 'P-10119', sourceHash: 'x', inLatestExport: true },
      ],
      [product('A')],
      ['P-10119'],
    );
    expect(plan.missingSkus).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
  });
});

describe('guardTrips', () => {
  it('trips when the file has fewer than half of the listed products', () => {
    expect(guardTrips(200, 99)).toBe(true);
    expect(guardTrips(200, 0)).toBe(true);
  });

  it('passes at exactly half or more', () => {
    expect(guardTrips(200, 100)).toBe(false);
    expect(guardTrips(200, 250)).toBe(false);
  });
});
