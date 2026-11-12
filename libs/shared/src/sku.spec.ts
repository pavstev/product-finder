import { describe, expect, it } from '@jest/globals';
import { MAX_SKU_LENGTH, normalizeSku, skuProblem } from './sku.js';

describe('normalizeSku', () => {
  it('trims and upper-cases, the form the import stores', () => {
    expect(normalizeSku('  p-10001 ')).toBe('P-10001');
    expect(normalizeSku('P-10001')).toBe('P-10001');
  });
});

describe('skuProblem', () => {
  it('accepts ordinary SKUs of other formats too', () => {
    for (const sku of ['P-10001', 'ABC-123', '10001', 'x', 'ÄÖ-1', 'P_1.2', 'P 1']) {
      expect(skuProblem(sku)).toBeNull();
    }
  });

  it('accepts 1 to 64 code points', () => {
    expect(MAX_SKU_LENGTH).toBe(64);
    expect(skuProblem('a'.repeat(64))).toBeNull();
    expect(skuProblem('😀'.repeat(64))).toBeNull();
    expect(skuProblem('a'.repeat(65))).toBe('length');
    expect(skuProblem('😀'.repeat(65))).toBe('length');
    expect(skuProblem('')).toBe('length');
  });

  it('rejects control characters (Cc)', () => {
    for (const sku of ['P-1\u0000', '\u0007P-1', 'P-\u007F1', 'P-\u00851', 'P-1\n2', 'P-\t1']) {
      expect(skuProblem(sku)).toBe('characters');
    }
  });

  it('rejects format characters (Cf)', () => {
    for (const sku of ['P-1\u{202E}', 'P-\u{200B}1', 'P\u{AD}1', 'P-\u{200E}1', 'P-\u{FEFF}1']) {
      expect(skuProblem(sku)).toBe('characters');
    }
  });

  it('checks the length first', () => {
    expect(skuProblem(`${'a'.repeat(65)}\u{200B}`)).toBe('length');
  });
});
