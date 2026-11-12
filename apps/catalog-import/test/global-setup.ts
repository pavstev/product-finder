// Twin: apps/api/test/global-setup.ts does the same for the api e2e. Keep both in step.

import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

// Create the test database when it is missing, then apply all migrations once per e2e run.
// The same steps as the api e2e setup: both suites use one test database.
// Jest loads this file without the moduleNameMapper, so it has no relative imports.
export default async function globalSetup(): Promise<void> {
  // The local env file is apps/api/.env, by explicit path. Real env vars win. A missing file is fine.
  dotenv.config({ path: path.resolve(__dirname, '../../api/.env'), quiet: true });
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://product_finder:product_finder@localhost:5432/product_finder_test';
  const target = new URL(url);
  // Checked before anything is touched, so a wrong URL changes nothing.
  if (!target.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
  }
  const dbName = decodeURIComponent(target.pathname.slice(1));

  // Connect to the maintenance database on the same server to create the test database.
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }

  // pnpm exec runs from the workspace root, so the CLI gets the server lib config by path.
  execSync('pnpm exec prisma migrate deploy --config libs/server/prisma.config.ts', {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
