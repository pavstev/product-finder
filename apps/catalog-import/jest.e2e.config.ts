import type { Config } from 'jest';

// End-to-end tests of the import against a real PostgreSQL (TEST_DATABASE_URL), so they run in band.
// The api e2e tests use the same database, so the root test:e2e runs the two one after the other.
const config: Config = {
  displayName: 'catalog-import-e2e',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Resolves the path aliases in tsconfig.base.json, such as @product-finder/import/adapters.
  resolver: '@nx/jest/plugins/resolver',
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
};

export default config;
