import { benchImport } from './bench-import.js';
import { benchQueries } from './bench-queries.js';
import { UsageError } from './options.js';

// Imports the generated 50k files into product_finder_perf, then times the queries against the built API.
// Run perf:generate-catalog first. Results go to tmp/perf/results.

async function main(): Promise<void> {
  await benchImport([], process.env);
  await benchQueries([], process.env);
}

main().catch((error: unknown) => {
  console.error(error instanceof UsageError ? error.message : error);
  process.exitCode = 1;
});
