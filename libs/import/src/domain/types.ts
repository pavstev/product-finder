import type { ProductStatus } from '@product-finder/shared';

export const REQUIRED_COLUMNS = [
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
] as const;

export type CsvColumn = (typeof REQUIRED_COLUMNS)[number];

/** The status values come from shared, so the pure modules stay DB free. */
export type ProductStatusValue = ProductStatus;

type IssueLevel = 'error' | 'warning';

export interface ImportIssue {
  /** CSV line number (the header is line 1). */
  line: number;
  sku?: string;
  level: IssueLevel;
  message: string;
}

/** One data row as read from the file, before any cleaning. */
export interface RawRow {
  line: number;
  fields: Record<CsvColumn, string>;
  /** Set when the row has the wrong number of fields. The row is then rejected. */
  problem?: string;
}

/** A cleaned row, ready for the database. */
export interface NormalizedProduct {
  sku: string;
  name: string;
  chemicalName: string | null;
  function: string;
  applicationArea: string;
  region: string;
  certifications: string[];
  status: ProductStatusValue;
  launchYear: number | null;
  description: string | null;
}

/** A normalized row with the two derived columns. */
export interface PreparedProduct extends NormalizedProduct {
  sourceHash: string;
  searchText: string;
}

export interface ParsedRecord {
  line: number;
  record: NormalizedProduct;
}

export type NormalizeResult =
  | { ok: true; line: number; record: NormalizedProduct; issues: ImportIssue[] }
  | { ok: false; line: number; sku?: string; issues: ImportIssue[] };

export interface ExistingProduct {
  sku: string;
  sourceHash: string;
  inLatestExport: boolean;
}

/** LOCKED: another import held the lock, so this run changed nothing. */
export type ImportOutcome = 'SUCCEEDED' | 'ABORTED' | 'LOCKED' | 'DRY_RUN';

/** What one import run did. Here, not next to importCatalog, so the pure CLI and summary code stay DB free. */
export interface ImportSummary {
  runId: string | null;
  status: ImportOutcome;
  file: string;
  rowsRead: number;
  valid: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  duplicates: number;
  markedMissing: number;
  issues: ImportIssue[];
  /** Set when the guard aborted the run or the lock was taken. */
  message?: string;
}

/** Thrown when the file cannot be used at all (bad header, broken CSV). Nothing is written. */
export class CsvFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvFileError';
  }
}
