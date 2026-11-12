import type { ImportIssue, ParsedRecord, ProductStatusValue } from './types.js';

const RESTRICTION: Record<ProductStatusValue, number> = { ACTIVE: 0, PHASE_OUT: 1, DISCONTINUED: 2 };

export interface DedupeResult {
  records: ParsedRecord[];
  duplicates: number;
  issues: ImportIssue[];
}

function sameRecord(a: ParsedRecord, b: ParsedRecord): boolean {
  return JSON.stringify(a.record) === JSON.stringify(b.record);
}

/**
 * Keep one record per SKU. Exact duplicates are counted and dropped. For conflicts the most restrictive status
 * wins (DISCONTINUED > PHASE_OUT > ACTIVE), so we never advertise a product we may not sell. A tie: last row wins.
 */
export function dedupe(input: ParsedRecord[]): DedupeResult {
  const bySku = new Map<string, ParsedRecord>();
  const issues: ImportIssue[] = [];
  let duplicates = 0;

  for (const current of input) {
    const sku = current.record.sku;
    const kept = bySku.get(sku);
    if (!kept) {
      bySku.set(sku, current);
      continue;
    }
    duplicates += 1;
    if (sameRecord(kept, current)) {
      continue;
    }
    const winner = RESTRICTION[current.record.status] >= RESTRICTION[kept.record.status] ? current : kept;
    bySku.set(sku, winner);
    issues.push({
      line: current.line,
      sku,
      level: 'warning',
      message: `Conflicting duplicate of line ${kept.line}. Kept line ${winner.line} (status ${winner.record.status}).`,
    });
  }

  return { records: [...bySku.values()], duplicates, issues };
}
