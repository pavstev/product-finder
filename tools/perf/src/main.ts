import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateCatalog, toCsv } from './generate-catalog.js';
import { UsageError } from './options.js';

// Writes products-<rows>.csv and products-<rows>-changed.csv into --out, relative to the working directory.

const USAGE = 'Usage: pnpm nx run perf:generate-catalog --args="--rows=50000 --seed=42 --out=tmp/perf"';
const MAX_SEED = 0xffffffff;

interface Options {
  rows: number;
  seed: number;
  out: string;
}

function readOptions(args: string[]): Options {
  let values: { rows: string; seed: string; out: string };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        rows: { type: 'string', default: '50000' },
        seed: { type: 'string', default: '42' },
        out: { type: 'string', default: 'tmp/perf' },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  const rows = Number(values.rows);
  if (!/^\d+$/.test(values.rows) || rows < 1) {
    throw new UsageError(`--rows must be a whole number above 0, not "${values.rows}".`);
  }
  const seed = Number(values.seed);
  if (!/^\d+$/.test(values.seed) || seed > MAX_SEED) {
    throw new UsageError(`--seed must be a whole number from 0 to ${MAX_SEED}, not "${values.seed}".`);
  }
  if (values.out.trim() === '') {
    throw new UsageError('--out must name a folder.');
  }
  return { rows, seed, out: values.out };
}

function main(): void {
  const started = performance.now();
  const options = readOptions(process.argv.slice(2));
  const catalog = generateCatalog(options);

  mkdirSync(options.out, { recursive: true });
  const files = [
    { name: `products-${options.rows}.csv`, rows: catalog.rows },
    { name: `products-${options.rows}-changed.csv`, rows: catalog.changedRows },
  ];
  console.log(`Seed ${options.seed}, ${options.rows} rows.`);
  for (const file of files) {
    const target = path.join(options.out, file.name);
    const content = toCsv(file.rows);
    writeFileSync(target, content);
    const hash = createHash('sha256').update(content).digest('hex');
    console.log(`${target}: ${file.rows.length} rows, sha256 ${hash}`);
  }
  console.log(`Changed file: ${catalog.changed} products renamed or with a new status.`);
  console.log(`Changed file: ${catalog.missing} products left out.`);
  console.log(`Done in ${Math.round(performance.now() - started)} ms.`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  console.error(error.message);
  console.error(USAGE);
  process.exitCode = 1;
}
