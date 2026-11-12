// Twin: apps/catalog-import/test/helpers.ts has the same writeCsv and spawns the same CLI (runCli). Keep both in step.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildOpenApiDocument, configureApp } from '@product-finder/api';
import { loadConfig, PrismaService } from '@product-finder/server';
import { Logger } from 'nestjs-pino';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { expectMatchesContract, setContractDocument } from './contract.js';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const CSV_FILE = path.join(WORKSPACE_ROOT, 'data/products.csv');
// The catalog-import bundle. api:e2e builds it first.
const IMPORT_CLI = path.join(WORKSPACE_ROOT, 'dist/apps/catalog-import/main.js');

/**
 * Loads an export into the test database with the built catalog-import CLI, in a child process, as the nightly job does.
 * Throws with the CLI output unless it exits with `expectedExitCode` (2: the guard aborted).
 */
export async function runImportCli(file = CSV_FILE, expectedExitCode = 0): Promise<void> {
  if (!existsSync(IMPORT_CLI)) {
    throw new Error(`${IMPORT_CLI} is missing. Run pnpm nx run catalog-import:build first.`);
  }
  const { code, output } = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [IMPORT_CLI, 'import', '--file', file], {
      cwd: WORKSPACE_ROOT,
      // setup-env.ts has pointed DATABASE_URL at the test database, and the child inherits it.
      env: process.env,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ code: exitCode, output });
    });
  });
  if (code !== expectedExitCode) {
    throw new Error(`The import CLI exited with ${code}, expected ${expectedExitCode}:\n${output}`);
  }
}

/**
 * The real app with the real prefix, pipes and guards, on the test database.
 * With `databaseUrl` the app uses that URL while it is built, so it does not leak into other tests.
 */
export async function createTestApp(
  databaseUrl?: string,
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const saved = process.env.DATABASE_URL;
  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    // The same logger as main.ts. setup-env.ts sets LOG_LEVEL=silent, so the tests print no log lines.
    app.useLogger(app.get(Logger));
    configureApp(app, loadConfig());
    await app.init();
    setContractDocument(buildOpenApiDocument(app));
    return { app, prisma: app.get(PrismaService) };
  } finally {
    if (saved === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved;
    }
  }
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'product-finder-'));
let fileCounter = 0;

/** Writes a variant of the real export. `keep` decides per data line. The header is always kept. */
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

let ipCounter = 0;
/** A fresh client IP per call, so per-IP rate limits do not leak between tests (TRUST_PROXY=1). */
export function nextIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/**
 * Checks that a response is an RFC 9457 problem with the given status and returns the body.
 * With an operation id, the body must also fit the schema of the OpenAPI document. Leave it out where no operation answers.
 */
export function expectProblem(res: Response, status: number, operationId?: string): Record<string, unknown> {
  expect({ status: res.status, contentType: res.headers['content-type'] }).toEqual({
    status,
    contentType: expect.stringMatching(/^application\/problem\+json/),
  });
  expect(res.body).toEqual(
    expect.objectContaining({
      type: expect.any(String),
      title: expect.any(String),
      status,
      detail: expect.any(String),
      instance: expect.any(String),
    }),
  );
  if (operationId) {
    expectMatchesContract(res, operationId);
  }
  return res.body as Record<string, unknown>;
}

export const validReview = {
  rating: 4,
  title: 'Works well',
  body: 'Good emulsifier for our cold process lotion.',
  authorName: 'Ana',
};
