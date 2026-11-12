// Twin: apps/api/test/helpers.ts has the same writeCsv and spawns the same CLI (runImportCli). Keep both in step.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { incrementRating, type PrismaClient } from '@product-finder/server/client';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
export const CSV_FILE = path.join(WORKSPACE_ROOT, 'data/products.csv');
/** The bundle that Nx builds. The e2e target depends on catalog-import:build. */
const CLI_BUNDLE = path.join(WORKSPACE_ROOT, 'dist/apps/catalog-import/main.js');

const tempDir = mkdtempSync(path.join(tmpdir(), 'product-finder-import-'));
let fileCounter = 0;

/** Write a variant of the real export. `keep` decides per data line; the header is always kept. */
export function writeCsv(
  keep: (line: string, index: number) => boolean,
  map: (line: string) => string = (l) => l,
) {
  const [header, ...rows] = readFileSync(CSV_FILE, 'utf8').trimEnd().split(/\r?\n/);
  const content = [header, ...rows.filter(keep).map(map)].join('\n');
  fileCounter += 1;
  const file = path.join(tempDir, `export-${fileCounter}.csv`);
  writeFileSync(file, `${content}\n`);
  return file;
}

export function writeRawCsv(content: string): string {
  fileCounter += 1;
  const file = path.join(tempDir, `raw-${fileCounter}.csv`);
  writeFileSync(file, content);
  return file;
}

/**
 * A user review, written the way the review service writes it: the row and the aggregate update
 * (incrementRating) in one transaction. The import tests may not start the API.
 */
export async function addReview(prisma: PrismaClient, sku: string, rating = 4): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { id: productId } = await tx.product.findUniqueOrThrow({ where: { sku }, select: { id: true } });
    await tx.review.create({
      data: { productId, rating, body: 'Good emulsifier for our cold process lotion.', authorName: 'Ana' },
    });
    if (!(await incrementRating(tx, productId, rating))) {
      throw new Error(`${sku} is not reviewable`);
    }
  });
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the built CLI in a child process against the test database, from the workspace root,
 * the way Nx and a scheduler run it. Resolves with the exit code and the output.
 */
export function runCli(args: string[]): Promise<CliResult> {
  if (!existsSync(CLI_BUNDLE)) {
    throw new Error(`${CLI_BUNDLE} is missing. Run pnpm nx run catalog-import:build first.`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BUNDLE, ...args], {
      cwd: WORKSPACE_ROOT,
      // setup-env.ts has pointed DATABASE_URL at the test database, and the child inherits it.
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
