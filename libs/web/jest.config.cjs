// Jest for the web lib (jest-preset-angular). Zoneless setup in src/test-setup.ts.
const { createCjsPreset } = require('jest-preset-angular/presets');

/** @type {import('jest').Config} */
module.exports = {
  ...createCjsPreset(),
  displayName: 'web-lib',
  // Resolves the path aliases in tsconfig.base.json, such as @product-finder/shared.
  resolver: '@nx/jest/plugins/resolver',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
