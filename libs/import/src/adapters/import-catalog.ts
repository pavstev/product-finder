import { CONFIG_DEFAULTS, type PrismaClient } from '@product-finder/server/client';
import type { Clock, ImportDeps, ImportLogger, UnitOfWork } from '../domain/ports.js';
import { type RunImportOptions, runImport } from '../domain/run-import.js';
import type { ImportSummary } from '../domain/types.js';
import { FileCatalogSource } from './file-catalog-source.js';
import { observeImport } from './import-telemetry.js';
import { PgImportLock } from './pg-import-lock.js';
import { PrismaCatalogWriter } from './prisma-catalog-writer.js';
import { PrismaImportRunLog } from './prisma-import-run-log.js';

export interface ImportOptions extends RunImportOptions {
  file: string;
  /** How long the write transaction may take. The caller passes IMPORT_TX_TIMEOUT_MS from the config. */
  transactionTimeoutMs?: number;
  /** The default prints warnings and errors on the console. */
  logger?: ImportLogger;
}

const MAX_WAIT_MS = 10_000;

/** One Prisma interactive transaction. The writer stamps rows with the clock. */
class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
    private readonly timeoutMs: number = CONFIG_DEFAULTS.IMPORT_TX_TIMEOUT_MS,
  ) {}

  run<T>(fn: (deps: ImportDeps) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) =>
        fn({
          writer: new PrismaCatalogWriter(tx, this.clock),
          log: new PrismaImportRunLog(tx),
          lock: new PgImportLock(tx),
        }),
      { timeout: this.timeoutMs, maxWait: MAX_WAIT_MS },
    );
  }
}

// Looks up console on each call, so a test can spy on it. Phase lines go nowhere: the CLI logs them.
const consoleLogger: ImportLogger = {
  phase: () => undefined,
  warn: (message) => {
    console.warn(message);
  },
  error: (message) => {
    console.error(message);
  },
};

/** Import the PIM export file with the Prisma adapters. Safe to run again. The run gets a span and metrics. */
export function importCatalog(
  prisma: PrismaClient,
  { file, transactionTimeoutMs, logger = consoleLogger, ...options }: ImportOptions,
): Promise<ImportSummary> {
  // One clock for the use case and the writer, so updated_at is the time of this run.
  const clock: Clock = { now: () => new Date() };
  return observeImport(() =>
    runImport({
      source: new FileCatalogSource(file),
      uow: new PrismaUnitOfWork(prisma, clock, transactionTimeoutMs),
      options,
      clock,
      logger,
    }),
  );
}
