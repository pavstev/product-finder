import { decodeCatalog } from './decode-catalog.js';
import { type ParsedCatalog, parseCatalog } from './parse-catalog.js';
import { guardTrips, type ImportPlan, planImport } from './plan-import.js';
import type {
  CatalogSource,
  Clock,
  ImportDeps,
  ImportLogger,
  PhaseFields,
  RunId,
  UnitOfWork,
} from './ports.js';
import type { ExistingProduct, ImportOutcome, ImportSummary } from './types.js';

export interface RunImportOptions {
  /** Skip the safety guard against truncated files. */
  force?: boolean;
  /** Parse and plan only. Writes nothing, not even an import run, and takes no lock. */
  dryRun?: boolean;
  /** Test seam: runs inside the transaction right after the lock is taken. */
  afterLock?: () => Promise<void>;
}

export interface RunImportInput {
  source: CatalogSource;
  uow: UnitOfWork;
  options?: RunImportOptions;
  clock: Clock;
  logger: ImportLogger;
}

/** A run still RUNNING after this long belongs to a crashed process. Real runs are much shorter. */
export const STALE_RUN_MINUTES = 60;

export const LOCKED_MESSAGE =
  'Another import is running, so this run changed nothing. Try again when it has finished.';

/** The issue a Windows-1252 export gets in the summary and the run record. */
export const WINDOWS_1252_ISSUE =
  'The file is not valid UTF-8, so it was read as Windows-1252. Check umlauts and other special characters.';

/**
 * Import the PIM export. Three units: (1) sweep stale runs and start, (2) lock, guard, write and finish
 * in one transaction, (3) on an error only, mark the run FAILED. The file is read between (1) and (2).
 */
export async function runImport(input: RunImportInput): Promise<ImportSummary> {
  const { source, uow, options = {}, logger } = input;
  const timer = startTimer(input.clock);
  if (options.dryRun) {
    return dryRun(input, timer);
  }

  const runId = await uow.run(async ({ log }) => {
    await log.sweepStale(STALE_RUN_MINUTES);
    return log.start(source.describe());
  });

  try {
    const parsed = await readCatalog(input, timer);
    const summary = newSummary(runId, 'SUCCEEDED', source.describe(), parsed);
    const write: WriteContext = { runId, parsed, summary, options, logger, timer };
    const writtenFields = await uow.run((deps) => lockedWrite(deps, write));
    if (writtenFields) {
      logger.phase('written', writtenFields);
    }
    logger.phase('finished', finishedFields(summary, timer.total()));
    return summary;
  } catch (error) {
    await markFailed(uow, runId, error, logger);
    logger.phase('finished', failedFields(runId, error, timer.total()));
    throw error;
  }
}

interface WriteContext {
  runId: RunId;
  parsed: ParsedCatalog;
  summary: ImportSummary;
  options: RunImportOptions;
  logger: ImportLogger;
  timer: Timer;
}

/** The write unit of work. Returns the `written` fields, or undefined when the run was locked or aborted. */
async function lockedWrite(
  { writer, log, lock }: ImportDeps,
  { runId, parsed, summary, options, logger, timer }: WriteContext,
): Promise<PhaseFields | undefined> {
  // The first statement. The lock ends with the transaction, also when the process dies.
  if (!(await lock.tryAcquire())) {
    summary.status = 'LOCKED';
    summary.message = LOCKED_MESSAGE;
    await log.finish(runId, summary);
    return undefined;
  }
  await options.afterLock?.();

  // Read after the lock, so no other import can change the catalogue under the guard.
  const existing = await writer.existingProducts();
  const abort = guardMessage(existing, parsed.products.length, options.force);
  if (abort) {
    summary.status = 'ABORTED';
    summary.message = abort;
    await log.finish(runId, summary);
    return undefined;
  }

  const plan = planImport(existing, parsed.products, parsed.rejectedSkus);
  logger.phase('planned', { ...plannedFields(plan), durationMs: timer.lap() });
  const written = await writer.upsert([...plan.toCreate, ...plan.toUpdate]);
  const markedMissing = await writer.markMissing(seenSkus(parsed, existing));
  Object.assign(summary, {
    created: written.inserted,
    updated: written.updated,
    unchanged: plan.unchanged,
    markedMissing,
  });
  await log.finish(runId, summary);
  return { created: written.inserted, updated: written.updated, markedMissing, durationMs: timer.lap() };
}

/** Parse and plan, with no writes and no lock. Reports ABORTED when the real run would abort. */
async function dryRun(input: RunImportInput, timer: Timer): Promise<ImportSummary> {
  const { source, uow, options = {}, logger } = input;
  try {
    const parsed = await readCatalog(input, timer);
    const summary = newSummary(null, 'DRY_RUN', source.describe(), parsed);
    const existing = await uow.run(({ writer }) => writer.existingProducts());
    const abort = guardMessage(existing, parsed.products.length, options.force);
    if (abort) {
      summary.status = 'ABORTED';
      summary.message = abort;
    } else {
      const plan = planImport(existing, parsed.products, parsed.rejectedSkus);
      logger.phase('planned', { ...plannedFields(plan), durationMs: timer.lap() });
      Object.assign(summary, countPlan(plan));
    }
    logger.phase('finished', finishedFields(summary, timer.total()));
    return summary;
  } catch (error) {
    logger.phase('finished', failedFields(null, error, timer.total()));
    throw error;
  }
}

/** A damaged UTF-8 file is an error (CsvFileError). A Windows-1252 file only gets a warning. */
async function readCatalog({ source, clock, logger }: RunImportInput, timer: Timer): Promise<ParsedCatalog> {
  timer.lap(); // Whatever ran before, such as the run start, is not part of the read.
  const bytes = await source.read();
  const readMs = timer.lap();
  const { text, encoding } = decodeCatalog(bytes, source.describe());
  logger.phase('read', { file: source.describe(), bytes: bytes.length, encoding, durationMs: readMs });
  const parsed = parseCatalog(text, clock.now().getFullYear());
  if (encoding !== 'utf-8') {
    logger.warn(`${source.describe()} is not valid UTF-8, so it was read as Windows-1252.`);
    // First, so the run record and the printed summary show it at the top.
    parsed.issues.unshift({ line: 1, level: 'warning', message: WINDOWS_1252_ISSUE });
  }
  logger.phase('parsed', {
    rowsRead: parsed.rowsRead,
    valid: parsed.products.length,
    rejected: parsed.rejected,
    duplicates: parsed.duplicates,
    durationMs: timer.lap(),
  });
  return parsed;
}

/** Rejected SKUs count as seen, but only known ones: a rejected SKU can hold a NUL, which PostgreSQL refuses. */
function seenSkus(parsed: ParsedCatalog, existing: ExistingProduct[]): string[] {
  const known = new Set(existing.map((product) => product.sku));
  return [
    ...parsed.products.map((product) => product.sku),
    ...parsed.rejectedSkus.filter((sku) => known.has(sku)),
  ];
}

/** The 50% guard. Returns why the run must stop, or null when it may go on. */
function guardMessage(existing: ExistingProduct[], valid: number, force = false): string | null {
  if (force) {
    return null;
  }
  const listed = existing.filter((product) => product.inLatestExport).length;
  if (!guardTrips(listed, valid)) {
    return null;
  }
  return (
    `The file has ${valid} valid products but the catalogue lists ${listed}. ` +
    'This looks like a truncated export, so nothing was changed. Use --force to import anyway.'
  );
}

function newSummary(
  runId: RunId | null,
  status: ImportOutcome,
  file: string,
  parsed: ParsedCatalog,
): ImportSummary {
  return {
    runId,
    status,
    file,
    rowsRead: parsed.rowsRead,
    valid: parsed.products.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: parsed.rejected,
    duplicates: parsed.duplicates,
    markedMissing: 0,
    issues: parsed.issues,
  };
}

/** The summary counts that a plan predicts, for a dry run. */
function countPlan(plan: ImportPlan) {
  return {
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    unchanged: plan.unchanged,
    markedMissing: plan.missingSkus.length,
  };
}

/** The fields of the `planned` phase, without the duration. */
function plannedFields(plan: ImportPlan) {
  return {
    toCreate: plan.toCreate.length,
    toUpdate: plan.toUpdate.length,
    unchanged: plan.unchanged,
    missing: plan.missingSkus.length,
  };
}

/** Milliseconds from the clock port: `lap` since the last lap, `total` since the start. */
interface Timer {
  lap(): number;
  total(): number;
}

function startTimer(clock: Clock): Timer {
  const started = clock.now().getTime();
  let last = started;
  return {
    lap: () => {
      const now = clock.now().getTime();
      const elapsed = now - last;
      last = now;
      return elapsed;
    },
    total: () => clock.now().getTime() - started,
  };
}

function finishedFields(summary: ImportSummary, durationMs: number): PhaseFields {
  return {
    runId: summary.runId,
    status: summary.status,
    file: summary.file,
    rowsRead: summary.rowsRead,
    valid: summary.valid,
    created: summary.created,
    updated: summary.updated,
    unchanged: summary.unchanged,
    rejected: summary.rejected,
    duplicates: summary.duplicates,
    markedMissing: summary.markedMissing,
    ...(summary.message ? { message: summary.message } : {}),
    durationMs,
  };
}

function failedFields(runId: RunId | null, error: unknown, durationMs: number): PhaseFields {
  return { runId, status: 'FAILED', error: messageOf(error), durationMs };
}

/** Its own small unit of work, after the failed one rolled back. If it fails too, both errors are logged. */
async function markFailed(
  uow: UnitOfWork,
  runId: RunId,
  error: unknown,
  logger: ImportLogger,
): Promise<void> {
  try {
    await uow.run(({ log }) => log.fail(runId, messageOf(error)));
  } catch (writeError) {
    logger.error(`Import run ${runId} could not be marked FAILED: ${messageOf(writeError)}`);
    logger.error(`The import itself failed with: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
