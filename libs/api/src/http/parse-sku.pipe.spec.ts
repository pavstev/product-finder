import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { MAX_SKU_LENGTH } from '@product-finder/shared';
import { ParseSkuPipe } from './parse-sku.pipe.js';

describe('ParseSkuPipe', () => {
  const pipe = new ParseSkuPipe();
  const rejects = (value: unknown) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  };

  it('accepts other SKU formats, not only P- (other business units)', () => {
    for (const sku of ['ABC-123', '10001', 'x', 'p-10001', 'ÄÖ-1', 'P_1.2']) {
      expect(pipe.transform(sku)).toBe(sku);
    }
  });

  it('accepts 1 to 64 characters', () => {
    expect(MAX_SKU_LENGTH).toBe(64);
    expect(pipe.transform('a'.repeat(64))).toBe('a'.repeat(64));
    rejects('a'.repeat(65));
    rejects('');
    rejects('   ');
  });

  it('counts code points, like the database', () => {
    // Each emoji is one code point but two UTF-16 units.
    expect(pipe.transform('😀'.repeat(64))).toBe('😀'.repeat(64));
    rejects('😀'.repeat(65));
  });

  it('rejects control characters (Unicode Cc)', () => {
    for (const sku of ['P-1\u0000', '\u0007P-1', 'P-\u007F1', 'P-\u00851', 'P-1\n2', 'P-\t1', 'P-\u001B1']) {
      rejects(sku);
    }
  });

  it('rejects format characters (Unicode Cf) such as bidi controls', () => {
    for (const sku of [
      'P-1\u{202E}',
      'P-\u{200B}1',
      'P-\u{2066}1',
      'P-\u{FEFF}1',
      'P\u{AD}1',
      'P-\u{E0001}1',
    ]) {
      rejects(sku);
    }
  });
});
