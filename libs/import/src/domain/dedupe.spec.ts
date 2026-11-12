import { describe, expect, it } from '@jest/globals';
import { dedupe } from './dedupe.js';
import type { NormalizedProduct, ParsedRecord, ProductStatusValue } from './types.js';

function record(
  line: number,
  sku: string,
  status: ProductStatusValue = 'ACTIVE',
  name = 'Name',
): ParsedRecord {
  const product: NormalizedProduct = {
    sku,
    name,
    chemicalName: null,
    function: 'Polymer',
    applicationArea: 'Coatings',
    region: 'EMEA',
    certifications: [],
    status,
    launchYear: 2007,
    description: null,
  };
  return { line, record: product };
}

describe('dedupe', () => {
  it('keeps one of two identical rows without a warning (P-10013)', () => {
    const result = dedupe([record(14, 'P-10013'), record(99, 'P-10013')]);
    expect(result.records).toHaveLength(1);
    expect(result.duplicates).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('keeps the most restrictive status of conflicting rows and warns (P-10151)', () => {
    const result = dedupe([record(153, 'P-10151', 'ACTIVE'), record(203, 'P-10151', 'DISCONTINUED')]);
    expect(result.records).toEqual([record(203, 'P-10151', 'DISCONTINUED')]);
    expect(result.duplicates).toBe(1);
    expect(result.issues).toEqual([expect.objectContaining({ line: 203, sku: 'P-10151', level: 'warning' })]);
    expect(result.issues[0].message).toContain('line 153');
  });

  it('keeps the restrictive row even when it comes first', () => {
    const result = dedupe([record(2, 'P-1', 'PHASE_OUT'), record(3, 'P-1', 'ACTIVE')]);
    expect(result.records[0].record.status).toBe('PHASE_OUT');
  });
});
