// Seed: import the catalogue, then add demo reviews when SEED_DEMO_REVIEWS=true. Safe to run again.
// Usage: pnpm seed (dev) or node main.js seed (in the catalog-import image). Exit codes as in cli.ts.
// Demo reviews are local demo data only. The nightly job runs the import, never the seed.
import {
  ConfigError,
  EXIT_CODES,
  exitCodeFor,
  type ImportLogger,
  resolveCatalogFile,
  runSeed,
} from '@product-finder/import';
import { type AppConfig, createPrismaClient, type PrismaClient } from '@product-finder/server/client';
import { printSummary } from './print-summary.js';

export async function seedCommand(config: AppConfig, logger?: ImportLogger): Promise<number> {
  let prisma: PrismaClient | undefined;
  try {
    prisma = createPrismaClient(config.DATABASE_URL);
    const { summary, demoReviews } = await runSeed(prisma, {
      file: resolveCatalogFile(undefined, config.CATALOG_FILE),
      transactionTimeoutMs: config.IMPORT_TX_TIMEOUT_MS,
      demoReviews: config.SEED_DEMO_REVIEWS,
      logger,
    });
    printSummary(summary);
    if (demoReviews) {
      console.log(
        `Demo reviews: ${demoReviews.inserted} inserted, ${demoReviews.skipped} already present or skipped.`,
      );
    } else if (summary.status === 'SUCCEEDED') {
      console.log('Demo reviews: off. Set SEED_DEMO_REVIEWS=true to add them (local demo data only).');
    }
    return exitCodeFor(summary.status);
  } catch (error) {
    console.error(`Seed failed: ${(error as Error).message}`);
    return error instanceof ConfigError ? EXIT_CODES.badArguments : EXIT_CODES.failed;
  } finally {
    await prisma?.$disconnect();
  }
}
