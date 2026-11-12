// Status: print the last 10 import runs. `main.js status [--json]`.
// Reads the import_run table only. Exit codes as in EXIT_CODE_TABLE.
import {
  ConfigError,
  EXIT_CODES,
  formatRunsJson,
  formatRunsTable,
  type ImportRunRow,
  listImportRuns,
  parseStatusArgs,
} from '@product-finder/import';
import { type AppConfig, createPrismaClient } from '@product-finder/server/client';

export const STATUS_RUN_LIMIT = 10;

type LoadRuns = (limit: number, databaseUrl: string) => Promise<ImportRunRow[]>;

/** Read the runs from the database, and close the connection. */
async function loadRunsFromDatabase(limit: number, databaseUrl: string): Promise<ImportRunRow[]> {
  const prisma = createPrismaClient(databaseUrl);
  try {
    return await listImportRuns(prisma, limit);
  } finally {
    await prisma.$disconnect();
  }
}

export async function statusCommand(
  argv: readonly string[],
  config: Pick<AppConfig, 'DATABASE_URL'>,
  loadRuns: LoadRuns = loadRunsFromDatabase,
): Promise<number> {
  let json: boolean;
  try {
    ({ json } = parseStatusArgs(argv));
  } catch (error) {
    console.error((error as Error).message);
    return EXIT_CODES.badArguments;
  }
  try {
    const runs = await loadRuns(STATUS_RUN_LIMIT, config.DATABASE_URL);
    console.log(json ? formatRunsJson(runs) : formatRunsTable(runs));
    return EXIT_CODES.ok;
  } catch (error) {
    console.error(`Status failed: ${(error as Error).message}`);
    return error instanceof ConfigError ? EXIT_CODES.badArguments : EXIT_CODES.failed;
  }
}
