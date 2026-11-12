import type { Config } from 'jest';

// End-to-end tests hit a real PostgreSQL (TEST_DATABASE_URL), so they run in band.
const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Resolves the path aliases in tsconfig.base.json, such as @product-finder/server/db.
  resolver: '@nx/jest/plugins/resolver',
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
};

export default config;
