// The catalog-import app. One entry with four sub-commands:
//   main.js migrate                                      apply the Prisma migrations
//   main.js import [--file <path>] [--force] [--dry-run]   import the PIM export (cli.ts)
//   main.js seed                                         import, plus demo reviews when SEED_DEMO_REVIEWS=true
//   main.js status [--json]                              the last 10 import runs, as a table or JSON
// The exit code of the sub-command is the exit code of the process.
import '@product-finder/server/client';
import { importCommand } from './cli.js';
import { loadImportConfig } from './config.js';
import { createImportLogger } from './import-logger.js';
import { migrateCommand } from './migrate.js';
import { runCommand } from './run-command.js';
import { seedCommand } from './seed.js';
import { statusCommand } from './status.js';

// CommonJS has no top-level await.
void runCommand(
  process.argv.slice(2),
  {
    migrate: () => migrateCommand(),
    import: (args, config) => importCommand(args, config, createImportLogger(config)),
    seed: (_args, config) => seedCommand(config, createImportLogger(config)),
    status: statusCommand,
  },
  loadImportConfig,
).then((code) => {
  process.exitCode = code;
});
