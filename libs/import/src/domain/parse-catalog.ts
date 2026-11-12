import { readCsv } from './csv-reader.js';
import { dedupe } from './dedupe.js';
import { prepareProduct } from './hash.js';
import { normalizeRow } from './normalize-row.js';
import type { ImportIssue, ParsedRecord, PreparedProduct } from './types.js';

export interface ParsedCatalog {
  products: PreparedProduct[];
  /** Readable SKUs of rejected rows. The import treats them as seen. */
  rejectedSkus: string[];
  issues: ImportIssue[];
  rowsRead: number;
  rejected: number;
  duplicates: number;
}

/** File content in, clean products out. Pure: no database, no file system. */
export function parseCatalog(content: string, currentYear = new Date().getFullYear()): ParsedCatalog {
  const { rows, issues } = readCsv(content);
  const valid: ParsedRecord[] = [];
  const rejectedSkus: string[] = [];
  let rejected = 0;

  for (const row of rows) {
    const result = normalizeRow(row, currentYear);
    issues.push(...result.issues);
    if (result.ok) {
      valid.push({ line: result.line, record: result.record });
    } else {
      rejected += 1;
      if (result.sku) {
        rejectedSkus.push(result.sku);
      }
    }
  }

  const deduped = dedupe(valid);
  issues.push(...deduped.issues);
  issues.sort((a, b) => a.line - b.line);

  return {
    products: deduped.records.map((entry) => prepareProduct(entry.record)),
    rejectedSkus,
    issues,
    rowsRead: rows.length,
    rejected,
    duplicates: deduped.duplicates,
  };
}
