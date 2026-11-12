import type { Config } from 'jest';

const config: Config = {
  displayName: 'perf',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Resolves the path aliases in tsconfig.base.json. The spec runs the real import parser.
  resolver: '@nx/jest/plugins/resolver',
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
};

export default config;
