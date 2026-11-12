import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  formatMs,
  IMPORT_CLI,
  type LoadSnapshot,
  loadSnapshot,
  machineInfo,
  markdownTable,
  type ProcessResult,
  type ProductCounts,
  productCounts,
  productTable,
  runNode,
  withClient,
  writeJson,
} from './harness.js';
import { type ImportCounts, parseImportSummary } from './import-summary.js';
import { type ImportOptions, type PerfDatabase, perfDatabase, readImportOptions } from './options.js';

// Drops and creates the perf database, migrates it with the built catalog-import CLI, then times
// four imports of the generated files: a first import, the same file again (no-op), the changed file
// (5% renamed or new status, 1% left out), and the first file again, so the query benchmark reads it.
// Writes <out>/import.json.

interface Step {
  id: string;
  title: string;
  file: string;
}

interface StepResult extends Step {
  load: LoadSnapshot;
  /** Spawn to exit of the CLI process: Node start, reading the file, the database work. */
  wallMs: number;
  /** started_at to finished_at of the import_run row: the work inside the process. */
  runMs: number;
  summary: ImportCounts;
  products: ProductCounts;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function recreateAndMigrate(db: PerfDatabase, childEnv: NodeJS.ProcessEnv): Promise<ProcessResult> {
  console.log(`Recreating database ${db.name}.`);
  await withClient(db.adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${db.name}"`);
  });
  const migrate = await runNode([IMPORT_CLI, 'migrate'], childEnv);
  if (migrate.code !== 0) {
    throw new Error(`migrate exited with ${migrate.code}:\n${migrate.output}`);
  }
  return migrate;
}

function lastRunMs(url: string): Promise<number> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ ms: number }>(
      `SELECT EXTRACT(EPOCH FROM finished_at - started_at)::float * 1000 AS ms
       FROM import_run ORDER BY started_at DESC LIMIT 1`,
    );
    return rows[0].ms;
  });
}

async function runStep(
  step: Step,
  options: ImportOptions,
  db: PerfDatabase,
  childEnv: NodeJS.ProcessEnv,
): Promise<StepResult> {
  const load = await loadSnapshot(options.container);
  const run = await runNode([IMPORT_CLI, 'import', '--file', step.file], childEnv);
  if (run.code !== 0) {
    throw new Error(`Import ${step.id} exited with ${run.code}:\n${run.output}`);
  }
  const summary = parseImportSummary(run.output);
  const runMs = await lastRunMs(db.url);
  const products = await productCounts(db.url);
  console.log(`${step.id}: ${formatMs(run.ms)} ms wall, ${summary.status}.`);
  return { ...step, load, wallMs: run.ms, runMs, summary, products };
}

function printReport(migrate: ProcessResult, results: StepResult[]): void {
  console.log(`\nMigrate on the empty database: ${formatMs(migrate.ms)} ms wall.\n`);
  console.log(
    markdownTable(
      [
        'Run',
        'File',
        'Wall (s)',
        'In process (s)',
        'Created',
        'Updated',
        'Unchanged',
        'Marked missing',
        'Listed after',
      ],
      results.map((result) => [
        `${result.id}: ${result.title}`,
        path.basename(result.file),
        (result.wallMs / 1000).toFixed(2),
        (result.runMs / 1000).toFixed(2),
        result.summary.created,
        result.summary.updated,
        result.summary.unchanged,
        result.summary.markedMissing,
        `${result.products.listed} of ${result.products.total}`,
      ]),
    ),
  );
  for (const result of results) {
    console.log(
      `Load before ${result.id}: host CPU ${result.load.hostCpuBusyPercent}%, db ${result.load.dbContainer}`,
    );
  }
}

export async function benchImport(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const options = readImportOptions(args, env);
  const db = perfDatabase(options.databaseUrl);
  const files = [options.file, options.changedFile].map((file) => ({ file, sha256: sha256(file) }));
  const childEnv = { ...env, DATABASE_URL: db.url };

  const migrate = await recreateAndMigrate(db, childEnv);
  const machine = await machineInfo(db.url);

  const steps: Step[] = [
    { id: 'a', title: 'first import, empty catalogue', file: options.file },
    { id: 'b', title: 'same file again (no-op)', file: options.file },
    { id: 'c', title: 'changed file', file: options.changedFile },
    { id: 'd', title: 'first file again (restores the 50k state)', file: options.file },
  ];
  const results: StepResult[] = [];
  for (const step of steps) {
    results.push(await runStep(step, options, db, childEnv));
  }

  writeJson(path.join(options.out, 'import.json'), {
    benchmark: 'import',
    machine,
    database: db.name,
    files,
    migrate: { wallMs: migrate.ms },
    steps: results,
    productTable: await productTable(db.url),
  });
  printReport(migrate, results);
}
