import { describe, expect, it } from '@jest/globals';
import type { PreparedProduct } from '../domain/types.js';
import { markMissingStatement, PIM_COLUMNS, upsertStatement } from './prisma-catalog-writer.js';

// The writer SQL, checked without a database: the text and the values of the built Prisma.sql.
// The catalog-import e2e tests run the same statements against PostgreSQL.

const RATING_COLUMNS = /review_count|rating_sum|rating_avg/;
/** The time of the run. The writer binds it as UTC, so the session time zone cannot shift updated_at. */
const AT = '2026-11-12T03:00:00.000Z';

function product(sku: string, sourceHash = `hash-${sku}`): PreparedProduct {
  return {
    sku,
    name: `Name ${sku}`,
    chemicalName: null,
    function: 'Emulsifier',
    applicationArea: 'Personal Care',
    region: 'EMEA',
    certifications: ['Halal', 'Vegan'],
    status: 'PHASE_OUT',
    launchYear: 2015,
    description: null,
    searchText: sku.toLowerCase(),
    sourceHash,
  };
}

/** The names in a comma separated list of quoted columns. */
function names(list: string): string[] {
  return list.split(',').map((name) => name.trim().replaceAll('"', ''));
}

describe('upsertStatement', () => {
  const sql = upsertStatement([product('P-1'), product('P-2')], AT).text.replace(/\s+/g, ' ');

  it('inserts only the PIM columns, plus the id and updated_at', () => {
    const [, columns] = sql.match(/^ ?INSERT INTO product \(([^)]*)\) VALUES/) ?? [];
    expect(names(columns)).toEqual([
      'id',
      'sku',
      'name',
      'chemical_name',
      'function',
      'application_area',
      'region',
      'certifications',
      'status',
      'launch_year',
      'description',
      'search_text',
      'source_hash',
      'in_latest_export',
      'updated_at',
    ]);
    expect(names(columns)).toEqual(['id', ...PIM_COLUMNS, 'updated_at']);
  });

  it('updates only the PIM columns on a conflict, never the SKU or the id', () => {
    const [, set] = sql.match(/ON CONFLICT \(sku\) DO UPDATE SET (.*) WHERE /) ?? [];
    const assignments = set.split(',').map((part) => part.trim());
    expect(assignments.map((part) => part.split(' = ')[0].replaceAll('"', ''))).toEqual([
      'name',
      'chemical_name',
      'function',
      'application_area',
      'region',
      'certifications',
      'status',
      'launch_year',
      'description',
      'search_text',
      'source_hash',
      'in_latest_export',
      'updated_at',
    ]);
    for (const part of assignments) {
      const [column, value] = part.split(' = ');
      expect(value).toBe(`EXCLUDED.${column}`);
    }
  });

  it('never names a rating column', () => {
    expect(sql).not.toMatch(RATING_COLUMNS);
  });

  it('skips rows whose hash and listing did not change, and tells inserts from updates', () => {
    expect(sql).toContain(
      'WHERE product.source_hash IS DISTINCT FROM EXCLUDED.source_hash OR NOT product.in_latest_export',
    );
    expect(sql).toMatch(/RETURNING \(xmax = 0\) AS inserted$/);
  });
});

describe('markMissingStatement', () => {
  it('hides every listed product that was not seen, in one statement', () => {
    const statement = markMissingStatement(['P-1', 'P-2'], AT);
    expect(statement.text.replace(/\s+/g, ' ').trim()).toBe(
      "UPDATE product SET in_latest_export = false, updated_at = ($1::timestamptz AT TIME ZONE 'UTC') WHERE in_latest_export AND sku <> ALL($2::text[])",
    );
    expect(statement.values).toEqual([AT, ['P-1', 'P-2']]);
    expect(statement.text).not.toMatch(RATING_COLUMNS);
  });
});
