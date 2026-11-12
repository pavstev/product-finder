import type { Config } from 'jest';

// The rules live in libs/. The app is covered by its e2e tests. The only spec in src/ is
// contract-helper.spec.ts, a database-free test of the e2e helper. A spec for app code goes in src/.
const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Resolves the path aliases in tsconfig.base.json, such as @product-finder/server.
  resolver: '@nx/jest/plugins/resolver',
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
  setupFiles: ['<rootDir>/test/setup-unit-env.ts'],
  passWithNoTests: true,
};

export default config;
