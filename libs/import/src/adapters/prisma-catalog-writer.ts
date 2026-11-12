import { Prisma } from '@product-finder/server/client';
import type { CatalogWriter, Clock } from '../domain/ports.js';
import type { ExistingProduct, PreparedProduct } from '../domain/types.js';

/** Rows per INSERT. 1,000 rows of 13 values stay far below the PostgreSQL limit of 65,535 parameters. */
export const UPSERT_CHUNK = 1000;

/** The product columns the import writes. Never review_count, rating_sum or rating_avg: reviews own those. */
export const PIM_COLUMNS = [
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
] as const;

const quote = (column: string) => `"${column}"`;
const INSERT_COLUMNS = Prisma.raw(['id', ...PIM_COLUMNS, 'updated_at'].map(quote).join(', '));
const UPDATE_SET = Prisma.raw(
  [...PIM_COLUMNS.filter((column) => column !== 'sku'), 'updated_at']
    .map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`)
    .join(', '),
);

// updated_at has no time zone and Prisma reads it as UTC. now() would store the session wall time.
const utc = (iso: string) => Prisma.sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`;

/** A known SKU is rewritten only when its hash changed or it was not listed. In RETURNING, xmax = 0 marks an insert. */
export function upsertStatement(rows: readonly PreparedProduct[], writtenAt: string): Prisma.Sql {
  const values = rows.map(
    (p) => Prisma.sql`(gen_random_uuid(), ${p.sku}, ${p.name}, ${p.chemicalName}, ${p.function},
      ${p.applicationArea}, ${p.region}, ${p.certifications}::text[], ${p.status}::"ProductStatus",
      ${p.launchYear}::int, ${p.description}, ${p.searchText}, ${p.sourceHash}, true, ${utc(writtenAt)})`,
  );
  return Prisma.sql`
    INSERT INTO product (${INSERT_COLUMNS})
    VALUES ${Prisma.join(values)}
    ON CONFLICT (sku) DO UPDATE SET ${UPDATE_SET}
    WHERE product.source_hash IS DISTINCT FROM EXCLUDED.source_hash OR NOT product.in_latest_export
    RETURNING (xmax = 0) AS inserted`;
}

/** Hide every listed product that the file did not contain, in one statement. */
export function markMissingStatement(seenSkus: readonly string[], writtenAt: string): Prisma.Sql {
  return Prisma.sql`
    UPDATE product SET in_latest_export = false, updated_at = ${utc(writtenAt)}
    WHERE in_latest_export AND sku <> ALL(${[...seenSkus]}::text[])`;
}

/** Set-based: a few statements per run. It reads the clock once, so every written row gets the same updated_at. */
export class PrismaCatalogWriter implements CatalogWriter {
  private readonly writtenAt: string;

  constructor(
    private readonly tx: Prisma.TransactionClient,
    clock: Clock,
  ) {
    this.writtenAt = clock.now().toISOString();
  }

  existingProducts(): Promise<ExistingProduct[]> {
    return this.tx.product.findMany({ select: { sku: true, sourceHash: true, inLatestExport: true } });
  }

  async upsert(rows: PreparedProduct[]): Promise<{ inserted: number; updated: number }> {
    const result = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const written = await this.tx.$queryRaw<{ inserted: boolean }[]>(
        upsertStatement(rows.slice(i, i + UPSERT_CHUNK), this.writtenAt),
      );
      for (const row of written) {
        result[row.inserted ? 'inserted' : 'updated'] += 1;
      }
    }
    return result;
  }

  markMissing(seenSkus: string[]): Promise<number> {
    return this.tx.$executeRaw(markMissingStatement(seenSkus, this.writtenAt));
  }
}
