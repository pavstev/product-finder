import type { Config } from 'jest';

// Unit test configs only. The e2e configs need a database, so they are not listed.
const config: Config = {
  projects: [
    '<rootDir>/apps/api/jest.config.ts',
    '<rootDir>/apps/catalog-import/jest.config.ts',
    '<rootDir>/libs/api/jest.config.ts',
    '<rootDir>/libs/import/jest.config.ts',
    '<rootDir>/libs/server/jest.config.ts',
    '<rootDir>/libs/shared/jest.config.ts',
    '<rootDir>/libs/web/jest.config.cjs',
    '<rootDir>/tools/perf/jest.config.ts',
  ],
};

export default config;
