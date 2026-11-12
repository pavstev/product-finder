import { base, formatting } from '../../eslint.config.mjs';

export default [
  ...base,
  {
    // The db folder and the Prisma CLI config are the only Prisma users.
    files: ['src/db/**', 'prisma.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The ratings folder is the only writer of the rating counters.
    files: ['src/ratings/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  ...formatting,
];
