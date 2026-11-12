// Runs before every e2e test file: point Prisma at the test database, never at dev data.
// Twin: apps/api/test/setup-env.ts has the same _test guard. Keep both in step.
// The local env file is apps/api/.env, by explicit path, as for the Nx targets. Real env vars win.
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../api/.env'), quiet: true });

const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://product_finder:product_finder@localhost:5432/product_finder_test';
// Never let a test run against a database that could hold real data.
if (!new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
}
process.env.DATABASE_URL = url;
