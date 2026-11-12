import { CsvFileError } from './types.js';

export type CatalogEncoding = 'utf-8' | 'windows-1252';

const BOM = [0xef, 0xbb, 0xbf];

/**
 * Bytes of the export in, text out. Strict UTF-8 first. Damaged UTF-8 (a BOM, or more valid multi-byte characters
 * than bad bytes) throws, as a fallback would garble every umlaut. Otherwise Windows-1252; a tie counts as that.
 */
export function decodeCatalog(bytes: Uint8Array, name: string): { text: string; encoding: CatalogEncoding } {
  const hasBom = BOM.every((byte, i) => bytes[i] === byte);
  const body = hasBom ? bytes.subarray(BOM.length) : bytes;
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body),
      encoding: 'utf-8',
    };
  } catch {
    const { firstInvalid, multiByte, invalid } = scanUtf8(body);
    const at = `byte ${firstInvalid + (hasBom ? BOM.length : 0)} is not valid UTF-8`;
    if (hasBom) {
      throw new CsvFileError(`${name} is broken UTF-8: it starts with a UTF-8 byte order mark, but ${at}.`);
    }
    if (multiByte > invalid) {
      throw new CsvFileError(
        `${name} is broken UTF-8: it holds more valid UTF-8 characters (${multiByte}) than bad bytes ` +
          `(${invalid}), and ${at}.`,
      );
    }
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
  }
}

/** UTF-8 lead bytes: [first lead, last lead, length, second byte range]. The ranges rule out overlongs and surrogates. */
const LEADS: readonly [number, number, number, number, number][] = [
  [0xc2, 0xdf, 2, 0x80, 0xbf],
  [0xe0, 0xe0, 3, 0xa0, 0xbf],
  [0xe1, 0xec, 3, 0x80, 0xbf],
  [0xed, 0xed, 3, 0x80, 0x9f],
  [0xee, 0xef, 3, 0x80, 0xbf],
  [0xf0, 0xf0, 4, 0x90, 0xbf],
  [0xf1, 0xf3, 4, 0x80, 0xbf],
  [0xf4, 0xf4, 4, 0x80, 0x8f],
];

/** The length of the valid UTF-8 multi-byte character at `i`, or 0 when none starts there. */
function multiByteLength(bytes: Uint8Array, i: number): number {
  const lead = LEADS.find(([first, last]) => bytes[i] >= first && bytes[i] <= last);
  if (!lead || i + lead[2] > bytes.length) {
    return 0;
  }
  const [, , length, min, max] = lead;
  if (bytes[i + 1] < min || bytes[i + 1] > max) {
    return 0;
  }
  for (let k = 2; k < length; k += 1) {
    if (bytes[i + k] < 0x80 || bytes[i + k] > 0xbf) {
      return 0;
    }
  }
  return length;
}

/** Walk the bytes as UTF-8: the first invalid offset, the valid multi-byte characters and the bad bytes. */
function scanUtf8(bytes: Uint8Array): { firstInvalid: number; multiByte: number; invalid: number } {
  let firstInvalid = -1;
  let multiByte = 0;
  let invalid = 0;
  let i = 0;
  while (i < bytes.length) {
    const length = bytes[i] < 0x80 ? 1 : multiByteLength(bytes, i);
    if (length > 1) {
      multiByte += 1;
    }
    if (length === 0) {
      invalid += 1;
      if (firstInvalid < 0) {
        firstInvalid = i;
      }
    }
    i += Math.max(length, 1);
  }
  return { firstInvalid, multiByte, invalid };
}
