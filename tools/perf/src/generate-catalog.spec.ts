import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { parseCatalog } from '@product-finder/import';
import { generateCatalog, toCsv } from './generate-catalog.js';

// 5,000 rows keep the spec fast. The CLI run proves the 50,000-row file.
const ROWS = 5000;
const SEED = 42;
// The parser checks the launch year against the current year. A fixed year keeps the spec stable.
const YEAR = 2026;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const catalog = generateCatalog({ rows: ROWS, seed: SEED });
const csv = toCsv(catalog.rows);
const parsed = parseCatalog(csv, YEAR);

describe('generateCatalog', () => {
  it('gives the same files for the same seed', () => {
    const again = generateCatalog({ rows: ROWS, seed: SEED });

    expect(sha256(toCsv(again.rows))).toBe(sha256(csv));
    expect(sha256(toCsv(again.changedRows))).toBe(sha256(toCsv(catalog.changedRows)));
  });

  it('writes rows the import parser accepts, with 0 rejected and no issues', () => {
    expect(parsed.rowsRead).toBe(ROWS);
    expect(parsed.rejected).toBe(0);
    expect(parsed.duplicates).toBe(0);
    expect(parsed.issues).toEqual([]);
    expect(parsed.products).toHaveLength(ROWS);
  });

  it('quotes a value with a double quote or a comma so the real parser reads it back unchanged', () => {
    const row = {
      ...catalog.rows[0],
      name: 'Quorin "Pro", SF 470',
      description: 'Says "mild", then "gentle".',
    };

    const [product] = parseCatalog(toCsv([row]), YEAR).products;

    expect(toCsv([row]).split('\n')[1]).toContain('"Quorin ""Pro"", SF 470"');
    expect(product.name).toBe(row.name);
    expect(product.description).toBe(row.description);
  });
});

describe('the changed variant', () => {
  const changed = parseCatalog(toCsv(catalog.changedRows), YEAR);

  it('parses with 0 rejected rows', () => {
    expect(changed.rejected).toBe(0);
    expect(changed.issues).toEqual([]);
  });
});
