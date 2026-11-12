import { base, formatting } from '../../eslint.config.mjs';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      // Playwright specs assert on locators and fixtures with non-null values.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  ...formatting,
];
