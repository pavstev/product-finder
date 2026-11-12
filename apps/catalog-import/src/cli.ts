// Import the nightly PIM export: `main.js import [--file <path>] [--force] [--dry-run]`.
// Usage through Nx: pnpm import:products [--file <path>] [--force] [--dry-run]
//
// Exit codes, so a scheduler can alert (EXIT_CODE_TABLE in @product-finder/import):
//   0  success or no-op (nothing to change, or a dry run)
//   1  failed (a broken file or a database error, rolled back)
//   2  aborted by the 50% guard (the file looks truncated, nothing changed)
//   3  locked (another import is running, nothing changed)
//   4  bad arguments or config (an unknown flag, a bad or missing DATABASE_URL)
// A scheduler should run the bundle directly (node dist/apps/catalog-import/main.js import).
// Through pnpm, a failed script can show up as 1.
import {
  type CliArgs,
  ConfigError,
  EXIT_CODES,
  exitCodeFor,
  importCatalog,
  type ImportLogger,
  parseCliArgs,
  resolveCatalogFile,
} from '@product-finder/import';
import { type AppConfig, createPrismaClient, type PrismaClient } from '@product-finder/server/client';
import { printSummary } from './print-summary.js';

/** Without a logger, only warnings and errors reach the console. */
export async function importCommand(
  argv: readonly string[],
  config: AppConfig,
  logger?: ImportLogger,
): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return exitCodeFor('BAD_ARGUMENTS');
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = createPrismaClient(config.DATABASE_URL);
    const summary = await importCatalog(prisma, {
      file: resolveCatalogFile(args.file, config.CATALOG_FILE),
      force: args.force,
      dryRun: args.dryRun,
      transactionTimeoutMs: config.IMPORT_TX_TIMEOUT_MS,
      logger,
    });
    printSummary(summary);
    return exitCodeFor(summary.status);
  } catch (error) {
    console.error(`Import failed: ${(error as Error).message}`);
    return error instanceof ConfigError ? EXIT_CODES.badArguments : EXIT_CODES.failed;
  } finally {
    await prisma?.$disconnect();
  }
}
