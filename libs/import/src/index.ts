// Public API of the import lib: the pure import rules behind ports (domain) and the adapters that
// read the export file and write the PIM columns of a product (the only code that does).
export {
  type CliArgs,
  ConfigError,
  EXIT_CODE_TABLE,
  EXIT_CODES,
  type ExitCodeRow,
  type ExitOutcome,
  exitCodeFor,
  parseCliArgs,
  parseStatusArgs,
  type StatusArgs,
} from './domain/cli-args.js';
export { type CatalogEncoding, decodeCatalog } from './domain/decode-catalog.js';
export {
  formatRunsJson,
  formatRunsTable,
  type ImportRunReader,
  type ImportRunRow,
  type ImportRunStatusValue,
} from './domain/format-runs.js';
export { formatSummary } from './domain/format-summary.js';
export { type ParsedCatalog, parseCatalog } from './domain/parse-catalog.js';
export { guardTrips, planImport } from './domain/plan-import.js';
export type {
  CatalogSource,
  CatalogWriter,
  Clock,
  ImportDeps,
  ImportLock,
  ImportLogger,
  ImportPhase,
  ImportRunLog,
  PhaseFields,
  RunId,
  UnitOfWork,
} from './domain/ports.js';
export {
  LOCKED_MESSAGE,
  type RunImportInput,
  type RunImportOptions,
  runImport,
  STALE_RUN_MINUTES,
} from './domain/run-import.js';
export type { ExistingProduct, ImportOutcome, ImportSummary, PreparedProduct } from './domain/types.js';
export { resolveCatalogFile } from './adapters/catalog-file.js';
export { runSeed, seedDemoReviews } from './adapters/demo-reviews.js';
export { importCatalog } from './adapters/import-catalog.js';
export { listImportRuns, PrismaImportRunReader } from './adapters/prisma-import-run-reader.js';
