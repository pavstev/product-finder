import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { decodeCatalog } from '../domain/decode-catalog.js';
import { FileCatalogSource } from './file-catalog-source.js';

const dir = mkdtempSync(path.join(tmpdir(), 'file-catalog-source-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, bytes: Uint8Array): string {
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

describe('FileCatalogSource', () => {
  it('reads the bytes unchanged, so a Windows-1252 export keeps its "ä"', async () => {
    // A Windows-1252 export: "ä" is the single byte 0xE4, which is not valid UTF-8.
    const bytes = new Uint8Array(Buffer.from('sku,name\nP-1,Kräuterbasis\n', 'latin1'));
    const source = new FileCatalogSource(fixture('windows-1252.csv', bytes));

    const read = await source.read();

    expect([...read]).toEqual([...bytes]);
    expect(read).toContain(0xe4);
    expect(decodeCatalog(read, source.describe())).toEqual({
      text: 'sku,name\nP-1,Kräuterbasis\n',
      encoding: 'windows-1252',
    });
  });
});
