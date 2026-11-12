import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { readCsv } from './csv-reader.js';
import { parseCatalog } from './parse-catalog.js';
import { CsvFileError } from './types.js';

const HEADER =
  'sku,name,chemical_name,function,application_area,region,certifications,status,launch_year,description';
const ROW = 'P-1,Name,Chem,Polymer,Coatings,EMEA,Halal,Active,2010,Text';

describe('readCsv', () => {
  it('accepts a BOM, CRLF and any column order', () => {
    const reordered =
      'name,sku,chemical_name,function,application_area,region,certifications,status,launch_year,description';
    const { rows } = readCsv(
      `\u{FEFF}${reordered}\r\nName,P-1,Chem,Polymer,Coatings,EMEA,,Active,2010,Text\r\n`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, fields: { sku: 'P-1', name: 'Name' } });
  });

  it('fails when a column is missing', () => {
    expect(() => readCsv('sku,name\nP-1,Name\n')).toThrow(CsvFileError);
    expect(() => readCsv('sku,name\nP-1,Name\n')).toThrow(/chemical_name/);
  });

  it('flags a row with the wrong number of fields', () => {
    const { rows } = readCsv(`${HEADER}\nP-1,Name\n`);
    expect(rows[0].problem).toContain('found 2');
  });

  it('reports CSV line numbers with the header as line 1', () => {
    const { rows } = readCsv(`${HEADER}\n${ROW}\n\n${ROW.replace('P-1', 'P-2')}\n`);
    expect(rows.map((row) => row.line)).toEqual([2, 4]);
  });

  it('reports the first line of a record with line breaks inside a quoted field', () => {
    const multi = (sku: string) => ROW.replace('P-1', sku).replace('Text', '"one\ntwo\nthree"');
    for (const nl of ['\n', '\r\n']) {
      const content = [HEADER, multi('P-1'), '', ROW.replace('P-1', 'P-2'), multi('P-3'), 'P-4,short'].join(
        nl,
      );
      const { rows } = readCsv(content);
      // Header 1, P-1 on 2..4, empty line 5, P-2 on 6, P-3 on 7..9, P-4 on 10.
      expect({ nl, lines: rows.map((row) => row.line) }).toEqual({ nl, lines: [2, 6, 7, 10] });
    }
  });

  it('fails on an empty file', () => {
    expect(() => readCsv('')).toThrow(CsvFileError);
  });
});

describe('parseCatalog on the real export (data/products.csv)', () => {
  const file = path.resolve(__dirname, '../../../../data/products.csv');
  const result = parseCatalog(readFileSync(file, 'utf8'), 2026);

  it('reads 202 rows and keeps 199 products', () => {
    expect(result.rowsRead).toBe(202);
    expect(result.products).toHaveLength(199);
    expect(result.rejected).toBe(1);
    expect(result.duplicates).toBe(2);
    expect(result.rejectedSkus).toEqual(['P-10119']);
  });

  it('applies the defect rules to the known rows', () => {
    const bySku = new Map(result.products.map((product) => [product.sku, product]));
    expect(bySku.get('P-10151')?.status).toBe('DISCONTINUED');
    expect(bySku.get('P-10059')?.name).toBe('Puraxin SF 120');
    expect(bySku.get('P-10105')?.launchYear).toBeNull();
    expect(new Set(result.products.map((product) => product.region))).toEqual(
      new Set(['Asia Pacific', 'EMEA', 'Global', 'Latin America', 'North America']),
    );
  });

  it('reports the rejected row as an error', () => {
    expect(result.issues.filter((issue) => issue.level === 'error')).toEqual([
      expect.objectContaining({ line: 121, sku: 'P-10119' }),
    ]);
  });
});
