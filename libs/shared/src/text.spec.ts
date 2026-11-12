import { describe, expect, it } from '@jest/globals';
import { codePointLength, hasControlCharacters } from './text.js';

describe('codePointLength', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('😀')).toBe(1);
    expect('😀'.length).toBe(2);
  });
});

describe('hasControlCharacters', () => {
  it('finds other control characters (Cc)', () => {
    for (const text of ['a\u0000b', '\u0007', 'a\u001Bb', 'a\u007Fb', 'a\u0085b']) {
      expect(hasControlCharacters(text)).toBe(true);
    }
  });
});
