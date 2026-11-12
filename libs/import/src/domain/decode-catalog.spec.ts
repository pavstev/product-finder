import { describe, expect, it } from '@jest/globals';
import { decodeCatalog } from './decode-catalog.js';
import { CsvFileError } from './types.js';

const NAME = 'file:/exports/pim.csv';
const BOM = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => new TextEncoder().encode(text);

/** The error decodeCatalog throws for the bytes, or null when it decodes them. */
function failure(bytes: Uint8Array): unknown {
  try {
    decodeCatalog(bytes, NAME);
    return null;
  } catch (error) {
    return error;
  }
}

describe('decodeCatalog', () => {
  it('strips a UTF-8 byte order mark', () => {
    const bytes = new Uint8Array([...BOM, ...utf8('sku,name\n')]);
    expect(decodeCatalog(bytes, NAME)).toEqual({ text: 'sku,name\n', encoding: 'utf-8' });
  });

  it('falls back to Windows-1252 when the bytes are not valid UTF-8 and hold no UTF-8 character', () => {
    // "Kräuterbasis 5 €" in Windows-1252: "ä" is 0xE4 and "€" is 0x80. Neither is valid UTF-8 here.
    const bytes = new Uint8Array([...utf8('P-1,Kr'), 0xe4, ...utf8('uterbasis 5 '), 0x80]);
    expect(decodeCatalog(bytes, NAME)).toEqual({ text: 'P-1,Kräuterbasis 5 €', encoding: 'windows-1252' });
  });

  it('fails on a file with a UTF-8 byte order mark and a bad byte, with no fallback', () => {
    // The BOM says UTF-8. Byte 5 is a stray Windows-1252 "ä".
    const bytes = new Uint8Array([...BOM, ...utf8('Kr'), 0xe4, ...utf8('uter')]);

    const error = failure(bytes);

    expect(error).toBeInstanceOf(CsvFileError);
    expect((error as Error).message).toBe(
      'file:/exports/pim.csv is broken UTF-8: it starts with a UTF-8 byte order mark, but byte 5 is not valid UTF-8.',
    );
  });

  it('fails on a UTF-8 file with one stray byte, because it holds more valid UTF-8 characters', () => {
    // "ä" and "ü" as C3 A4 and C3 BC in the first row, a stray 0xE4 in the second. Not a Windows-1252 file.
    const head = utf8('P-1,Kräuterbasis für Hautpflege\nP-2,Kr');
    const bytes = new Uint8Array([...head, 0xe4, ...utf8('uter')]);

    const error = failure(bytes);

    expect(error).toBeInstanceOf(CsvFileError);
    expect((error as Error).message).toBe(
      'file:/exports/pim.csv is broken UTF-8: it holds more valid UTF-8 characters (2) than bad bytes (1), ' +
        `and byte ${head.length} is not valid UTF-8.`,
    );
  });

  // In Windows-1252, a capital umlaut or "ß" (0xC2 to 0xDF) before a byte from 0x80 to 0xBF is a valid
  // 2-byte UTF-8 character by chance. One such pair must not turn a Windows-1252 file into an error.
  it('reads Windows-1252 with "ß“" (DF 93) next to an umlaut as Windows-1252', () => {
    // „weiß“ and "Hautgefühl": „ is 0x84 and ü is 0xFC, both bad UTF-8. ß“ is DF 93, valid UTF-8.
    const bytes = new Uint8Array([
      ...utf8('P-1,'),
      0x84,
      ...utf8('wei'),
      0xdf,
      0x93,
      ...utf8('\nP-2,Hautgef'),
      0xfc,
      ...utf8('hl'),
    ]);
    expect(decodeCatalog(bytes, NAME)).toEqual({
      text: 'P-1,„weiß“\nP-2,Hautgefühl',
      encoding: 'windows-1252',
    });
  });

  it('reads Windows-1252 with "ß" and a no-break space (DF A0) next to one umlaut as Windows-1252', () => {
    // "Fuß 5 m" with a no-break space, and "Hautgefühl". One valid pair, one bad byte: a tie is Windows-1252.
    const bytes = new Uint8Array([
      ...utf8('P-1,Fu'),
      0xdf,
      0xa0,
      ...utf8('5 m\nP-2,Hautgef'),
      0xfc,
      ...utf8('hl'),
    ]);
    expect(decodeCatalog(bytes, NAME)).toEqual({
      text: 'P-1,Fuß 5 m\nP-2,Hautgefühl',
      encoding: 'windows-1252',
    });
  });
});
