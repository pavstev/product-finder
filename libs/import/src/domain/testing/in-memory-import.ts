import type {
  CatalogSource,
  Clock,
  ImportDeps,
  ImportLogger,
  ImportPhase,
  PhaseFields,
  RunId,
  UnitOfWork,
} from '../ports.js';
import type { ImportSummary, PreparedProduct } from '../types.js';

// In-memory fakes of the import ports, for unit tests of runImport. They follow the SQL of the
// Prisma adapters: upsert skips rows whose hash and listing did not change, markMissing hides
// listed products that were not seen, and a unit of work commits all or nothing.

export interface StoredProduct extends PreparedProduct {
  inLatestExport: boolean;
  /** Owned by the reviews flow. The fake writer never changes it, like the real one. */
  reviewCount: number;
  /** How often the row was written. */
  writes: number;
}

export interface StoredRun {
  id: RunId;
  source: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
  startedAt: Date;
  error: string | null;
  summary: ImportSummary | null;
}

/** A port method that throws when it is in `InMemoryImportStore.failing`. */
export type FailPoint = 'upsert' | 'markMissing' | 'finish' | 'fail';

interface Tables {
  products: Map<string, StoredProduct>;
  runs: Map<RunId, StoredRun>;
}

// Runs fn and turns a throw into a rejection, like an async method does, without a needless await.
function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(fn());
  });
}

function copy<T>(map: Map<string, T>): Map<string, T> {
  return new Map([...map].map(([key, value]) => [key, structuredClone(value)]));
}

/** The database of the fakes. It is the UnitOfWork too: each run works on a copy and commits it. */
export class InMemoryImportStore implements UnitOfWork {
  products = new Map<string, StoredProduct>();
  runs = new Map<RunId, StoredRun>();
  /** True while another import holds the lock. */
  lockHeldElsewhere = false;
  readonly failing = new Set<FailPoint>();
  readonly sweeps: number[] = [];
  /** The SKUs of each upsert call. */
  readonly upsertCalls: string[][] = [];
  /** The `seenSkus` of each markMissing call. */
  readonly markMissingCalls: string[][] = [];
  commits = 0;
  rollbacks = 0;
  private runCounter = 0;

  constructor(private readonly clock: Clock) {}

  async run<T>(fn: (deps: ImportDeps) => Promise<T>): Promise<T> {
    const draft: Tables = { products: copy(this.products), runs: copy(this.runs) };
    try {
      const result = await fn(this.deps(draft));
      this.products = draft.products;
      this.runs = draft.runs;
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }

  /** Store products as a previous import would have left them. */
  seed(products: PreparedProduct[], inLatestExport = true): void {
    for (const product of products) {
      this.products.set(product.sku, { ...product, inLatestExport, reviewCount: 0, writes: 0 });
    }
  }

  /** A run row with the given status and start time, such as one left behind by a crash. */
  addRun(status: StoredRun['status'], startedAt: Date): RunId {
    const id = this.nextRunId();
    this.runs.set(id, { id, source: 'earlier', status, startedAt, error: null, summary: null });
    return id;
  }

  listedSkus(): string[] {
    return [...this.products.values()].filter((p) => p.inLatestExport).map((p) => p.sku);
  }

  private nextRunId(): RunId {
    this.runCounter += 1;
    return `run-${this.runCounter}`;
  }

  private check(point: FailPoint): void {
    if (this.failing.has(point)) {
      throw new Error(`${point} failed`);
    }
  }

  private deps({ products, runs }: Tables): ImportDeps {
    return {
      lock: { tryAcquire: () => Promise.resolve(!this.lockHeldElsewhere) },
      writer: {
        existingProducts: () =>
          Promise.resolve(
            [...products.values()].map(({ sku, sourceHash, inLatestExport }) => ({
              sku,
              sourceHash,
              inLatestExport,
            })),
          ),
        upsert: (rows) =>
          settle(() => {
            this.upsertCalls.push(rows.map((row) => row.sku));
            let inserted = 0;
            let updated = 0;
            for (const row of rows) {
              const current = products.get(row.sku);
              if (!current) {
                products.set(row.sku, { ...row, inLatestExport: true, reviewCount: 0, writes: 1 });
                inserted += 1;
              } else if (current.sourceHash !== row.sourceHash || !current.inLatestExport) {
                products.set(row.sku, {
                  ...current,
                  ...row,
                  inLatestExport: true,
                  writes: current.writes + 1,
                });
                updated += 1;
              }
            }
            // After the writes, so a failure leaves a half-written draft for the rollback to discard.
            this.check('upsert');
            return { inserted, updated };
          }),
        markMissing: (seenSkus) =>
          settle(() => {
            this.markMissingCalls.push([...seenSkus]);
            this.check('markMissing');
            const seen = new Set(seenSkus);
            let count = 0;
            for (const product of products.values()) {
              if (product.inLatestExport && !seen.has(product.sku)) {
                product.inLatestExport = false;
                product.writes += 1;
                count += 1;
              }
            }
            return count;
          }),
      },
      log: {
        start: (source) =>
          settle(() => {
            const id = this.nextRunId();
            runs.set(id, {
              id,
              source,
              status: 'RUNNING',
              startedAt: this.clock.now(),
              error: null,
              summary: null,
            });
            return id;
          }),
        finish: (id, summary) =>
          settle(() => {
            this.check('finish');
            const run = runs.get(id) as StoredRun;
            run.status = summary.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'ABORTED';
            run.error = summary.message ?? null;
            run.summary = structuredClone(summary);
          }),
        fail: (id, error) =>
          settle(() => {
            this.check('fail');
            const run = runs.get(id) as StoredRun;
            run.status = 'FAILED';
            run.error = error;
          }),
        sweepStale: (olderThanMinutes) =>
          settle(() => {
            this.sweeps.push(olderThanMinutes);
            const limit = this.clock.now().getTime() - olderThanMinutes * 60_000;
            let count = 0;
            for (const run of runs.values()) {
              if (run.status === 'RUNNING' && run.startedAt.getTime() < limit) {
                run.status = 'FAILED';
                run.error = 'Marked failed: stale';
                count += 1;
              }
            }
            return count;
          }),
      },
    };
  }
}

/** A source that returns fixed bytes. A string is encoded as UTF-8. */
export function memorySource(content: string | Uint8Array, name = 'memory:products.csv'): CatalogSource {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { describe: () => name, read: () => Promise.resolve(bytes) };
}

export function fixedClock(iso = '2026-11-12T03:00:00Z'): Clock {
  return { now: () => new Date(iso) };
}

export function recordingLogger(): ImportLogger & {
  warnings: string[];
  errors: string[];
  phases: { phase: ImportPhase; fields: PhaseFields }[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const phases: { phase: ImportPhase; fields: PhaseFields }[] = [];
  return {
    warnings,
    errors,
    phases,
    phase: (phase, fields) => phases.push({ phase, fields }),
    warn: (message) => warnings.push(message),
    error: (message) => errors.push(message),
  };
}

const CSV_HEADER =
  'sku,name,chemical_name,function,application_area,region,certifications,status,launch_year,description';

/** One valid CSV line. */
export function csvLine(sku: string, name = `Product ${sku}`): string {
  return `${sku},${name},,Emulsifier,Personal Care,EMEA,Vegan,Active,2015,Description of ${sku}`;
}

/** A whole export: the header and the given lines. */
export function catalogCsv(lines: string[]): string {
  return `${[CSV_HEADER, ...lines].join('\n')}\n`;
}
