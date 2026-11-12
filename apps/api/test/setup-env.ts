// Runs before every e2e test file: point Prisma at the test database, never at dev data.
// Twin: apps/catalog-import/test/setup-env.ts has the same _test guard. Keep both in step.
import 'dotenv/config';

const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://product_finder:product_finder@localhost:5432/product_finder_test';
// Never let a test run against a database that could hold real data.
if (!new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
}
process.env.DATABASE_URL = url;
// Tests send X-Forwarded-For to get a fresh client IP, so rate limits stay per test.
process.env.TRUST_PROXY = '1';
// The logger stays quiet in the tests. The request id header does not depend on the level.
process.env.LOG_LEVEL = 'silent';
