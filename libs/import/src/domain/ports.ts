import type { ExistingProduct, ImportSummary, PreparedProduct } from './types.js';

// The ports of the import. runImport talks only to these interfaces. The adapters
// implement them with the file system and Prisma. The fakes in domain/testing
// do it in memory, so the whole flow runs in unit tests.

/** The id of one import_run row. */
export type RunId = string;

/** Where the export comes from. */
export interface CatalogSource {
  /** A name for logs and the run log, such as "file:/app/data/products.csv". */
  describe(): string;
  /** The raw bytes. runImport decodes them (decodeCatalog). */
  read(): Promise<Uint8Array>;
}

/** Writes the PIM columns of the product table. Never the rating columns. */
export interface CatalogWriter {
  /** Every product, listed or not, with the fields the plan needs. */
  existingProducts(): Promise<ExistingProduct[]>;
  /** Insert new products and rewrite changed ones. Rows whose hash and listing did not change are skipped. */
  upsert(rows: PreparedProduct[]): Promise<{ inserted: number; updated: number }>;
  /** Set inLatestExport = false on every listed product whose SKU is not in `seenSkus`. Returns the count. */
  markMissing(seenSkus: string[]): Promise<number>;
}

/** The import_run audit table. */
export interface ImportRunLog {
  /** Insert a RUNNING row. */
  start(source: string): Promise<RunId>;
  /** Close the run as SUCCEEDED, or as ABORTED for the guard and for LOCKED, with the counts and issues. */
  finish(id: RunId, summary: ImportSummary): Promise<void>;
  fail(id: RunId, error: string): Promise<void>;
  /** Mark runs FAILED that are still RUNNING after this many minutes (a crashed process). Returns the count. */
  sweepStale(olderThanMinutes: number): Promise<number>;
}

/** One import at a time. The lock ends with the unit of work, also when the process dies. */
export interface ImportLock {
  tryAcquire(): Promise<boolean>;
}

/** What one unit of work hands to its callback. */
export interface ImportDeps {
  writer: CatalogWriter;
  log: ImportRunLog;
  lock: ImportLock;
}

/** One database transaction. All writes inside `fn` commit together, or none do when `fn` throws. */
export interface UnitOfWork {
  run<T>(fn: (deps: ImportDeps) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

/** The steps of a run, in order. A dry run has no `written`. A guard abort or a lock has no `planned` or `written`. */
export type ImportPhase = 'read' | 'parsed' | 'planned' | 'written' | 'finished';

/** The counts and the duration of one phase. Plain values only, so an adapter can log them as they are. */
export type PhaseFields = Readonly<Record<string, string | number | null>>;

export interface ImportLogger {
  /** One structured line per phase. `fields` holds the counts and `durationMs`. */
  phase(phase: ImportPhase, fields: PhaseFields): void;
  warn(message: string): void;
  error(message: string): void;
}
