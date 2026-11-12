import { describe, expect, it } from '@jest/globals';
import { CERTIFICATIONS_MAX, FACET_VALUE_MAX, PRODUCT_NAME_MAX } from '@product-finder/shared';
import { normalizeRow, parseCertifications } from './normalize-row.js';
import type { CsvColumn, RawRow } from './types.js';

const base: Record<CsvColumn, string> = {
  sku: 'P-10001',
  name: 'Quorin SF 470',
  chemical_name: 'Sodium Laureth Sulfate',
  function: 'Surfactant',
  application_area: 'Home Care',
  region: 'EMEA',
  certifications: 'Kosher|RSPO Mass Balance',
  status: 'Active',
  launch_year: '2012',
  description: 'Surfactant for home care.',
};

function row(fields: Partial<Record<CsvColumn, string>>, line = 2): RawRow {
  return { line, fields: { ...base, ...fields } };
}

describe('parseCertifications', () => {
  it('splits, trims, drops empty items, de-duplicates and sorts', () => {
    expect(parseCertifications(' Vegan | Halal||Vegan ')).toEqual(['Halal', 'Vegan']);
  });

  it('drops the empty item after a trailing pipe (P-10067, "Halal|Vegan|")', () => {
    expect(parseCertifications('Halal|Vegan|')).toEqual(['Halal', 'Vegan']);
  });

  it('gives an empty list for an empty field', () => {
    expect(parseCertifications('')).toEqual([]);
  });
});

describe('normalizeRow', () => {
  it('trims fields and collapses inner whitespace (P-10059, " EMEA ")', () => {
    const result = normalizeRow(
      row({ name: '  Puraxin SF 120 ', region: ' EMEA ', description: 'a   b' }),
      2026,
    );
    expect(result.ok && result.record).toMatchObject({
      name: 'Puraxin SF 120',
      region: 'EMEA',
      description: 'a b',
    });
  });

  it('upper-cases and trims the SKU', () => {
    const result = normalizeRow(row({ sku: ' p-10001 ' }), 2026);
    expect(result.ok && result.record.sku).toBe('P-10001');
  });

  it('rejects a row without a name and keeps the SKU (P-10119)', () => {
    const result = normalizeRow(row({ sku: 'P-10119', name: '' }, 121), 2026);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ sku: 'P-10119', line: 121 });
    expect(result.issues).toEqual([
      { line: 121, sku: 'P-10119', level: 'error', message: 'Row rejected: missing name.' },
    ]);
  });

  it('rejects a name over PRODUCT_NAME_MAX characters, so its search cursor always fits', () => {
    expect(PRODUCT_NAME_MAX).toBe(200);
    expect(normalizeRow(row({ name: 'ü'.repeat(PRODUCT_NAME_MAX) }), 2026).ok).toBe(true);
    // Code points, like the API: an emoji counts as one.
    expect(normalizeRow(row({ name: '\u{1F9EA}'.repeat(PRODUCT_NAME_MAX) }), 2026).ok).toBe(true);
    const result = normalizeRow(row({ name: `  ${'a'.repeat(PRODUCT_NAME_MAX)}b ` }, 9), 2026);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ sku: 'P-10001', line: 9 });
    expect(result.issues).toEqual([
      {
        line: 9,
        sku: 'P-10001',
        level: 'error',
        message: 'Row rejected: the name must be at most 200 characters long.',
      },
    ]);
  });

  it('rejects a row with any empty required field', () => {
    for (const column of ['function', 'application_area', 'region', 'status'] as const) {
      expect(normalizeRow(row({ [column]: '  ' }), 2026).ok).toBe(false);
    }
  });

  it('rejects a row without SKU and reports no SKU', () => {
    const result = normalizeRow(row({ sku: '' }), 2026);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.sku).toBeUndefined();
  });

  it('rejects a SKU that the API would refuse (control, format, too long)', () => {
    const bad = [
      'P-1\u{200B}2',
      'P-1\u{AD}2',
      'P-1\u00072',
      'P-1\u{200E}2',
      `P-${'1'.repeat(63)}`,
      '😀'.repeat(65),
    ];
    for (const sku of bad) {
      const result = normalizeRow(row({ sku }, 7), 2026);
      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ line: 7, level: 'error' });
      expect(result.issues[0].message).toMatch(/^Row rejected: the SKU /);
    }
  });

  it('keeps a rejected SKU as seen, but writes only a safe form into the issue', () => {
    const result = normalizeRow(row({ sku: 'p-1\u0000\u{200B}2' }), 2026);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.sku).toBe('P-1\u0000\u{200B}2');
    expect(result.issues[0].sku).toBe('P-1\\u{0}\\u{200B}2');
  });

  it('accepts a SKU of exactly 64 code points', () => {
    const sku = `P-${'1'.repeat(62)}`;
    expect(normalizeRow(row({ sku }), 2026).ok).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = normalizeRow(row({ status: 'Retired' }), 2026);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('unknown status "Retired"');
  });

  it('rejects a row with the wrong number of fields', () => {
    const result = normalizeRow({ ...row({}), problem: 'Expected 10 fields but found 9.' }, 2026);
    expect(result.ok).toBe(false);
    expect(result.issues[0].level).toBe('error');
  });

  it('stores null with a warning for an empty or n/a launch year (P-10105)', () => {
    for (const value of ['', 'n/a']) {
      const result = normalizeRow(row({ sku: 'P-10105', launch_year: value }), 2026);
      expect(result.ok && result.record.launchYear).toBeNull();
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ level: 'warning', sku: 'P-10105' });
    }
  });

  it('gives an empty certification list for an empty field', () => {
    const result = normalizeRow(row({ certifications: '' }), 2026);
    expect(result.ok && result.record.certifications).toEqual([]);
  });
});

// One long facet value used to fail the whole import: the B-tree product_facets_idx refuses an entry
// over 2,704 bytes. Now such a row is rejected on its own.
describe('normalizeRow facet limits', () => {
  /** The single error issue of a rejected row, or the row when it passed. */
  function rejection(fields: Partial<Record<CsvColumn, string>>) {
    const result = normalizeRow(row(fields, 5), 2026);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ sku: 'P-10001', line: 5 });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ line: 5, sku: 'P-10001', level: 'error' });
    return result.issues[0].message;
  }

  /** `count` different certifications of `length` characters each. */
  const certifications = (count: number, length: number) =>
    Array.from({ length: count }, (_, i) => `${i}`.padStart(length, 'c')).join('|');

  it('rejects a function, application area or region over FACET_VALUE_MAX characters', () => {
    const columns = [
      ['function', 'function'],
      ['application_area', 'application area'],
      ['region', 'region'],
    ] as const;
    for (const [column, label] of columns) {
      expect(normalizeRow(row({ [column]: 'ü'.repeat(FACET_VALUE_MAX) }), 2026).ok).toBe(true);
      expect(rejection({ [column]: 'x'.repeat(FACET_VALUE_MAX + 1) })).toBe(
        `Row rejected: the ${label} must be at most 100 characters long.`,
      );
    }
  });

  it('rejects a certification over FACET_VALUE_MAX characters', () => {
    expect(normalizeRow(row({ certifications: `Halal|${'c'.repeat(FACET_VALUE_MAX)}` }), 2026).ok).toBe(true);
    expect(rejection({ certifications: `Halal|${'c'.repeat(FACET_VALUE_MAX + 1)}` })).toBe(
      'Row rejected: each certification must be at most 100 characters long.',
    );
  });

  it('rejects more than CERTIFICATIONS_MAX certifications, counted without duplicates', () => {
    const twenty = certifications(CERTIFICATIONS_MAX, 10);
    expect(normalizeRow(row({ certifications: twenty }), 2026).ok).toBe(true);
    expect(normalizeRow(row({ certifications: `${twenty}|${twenty.split('|')[0]}` }), 2026).ok).toBe(true);
    expect(rejection({ certifications: certifications(CERTIFICATIONS_MAX + 1, 10) })).toBe(
      'Row rejected: a product can have at most 20 certifications, this row has 21.',
    );
  });

  it('rejects a row whose facet values together have more than FACET_BYTES_MAX bytes of UTF-8', () => {
    // Surfactant, Home Care and EMEA are 23 bytes. Nineteen certifications of 100 characters fit.
    expect(normalizeRow(row({ certifications: certifications(19, FACET_VALUE_MAX) }), 2026).ok).toBe(true);
    expect(rejection({ certifications: certifications(20, FACET_VALUE_MAX) })).toBe(
      'Row rejected: function, application area, region and certifications together must be at most 2000 bytes, this row has 2023.',
    );
    // Bytes, not characters: three values of 100 umlauts are 600 bytes.
    const umlauts = 'ü'.repeat(FACET_VALUE_MAX);
    const wide = { function: umlauts, application_area: umlauts, region: umlauts };
    expect(normalizeRow(row({ ...wide, certifications: certifications(14, FACET_VALUE_MAX) }), 2026).ok).toBe(
      true,
    );
    expect(rejection({ ...wide, certifications: certifications(15, FACET_VALUE_MAX) })).toMatch(
      /this row has 2100\.$/,
    );
  });
});
