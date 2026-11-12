// Shared flat config. Every project has a small eslint.config.mjs that extends it, and Nx infers `lint` from that file.
import eslint from '@eslint/js';
import nx from '@nx/eslint-plugin';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.ts', '**/*.cts', '**/*.mts'];
const scriptFiles = [...tsFiles, '**/*.js', '**/*.cjs', '**/*.mjs'];
// Tool configs are not part of any tsconfig, so they get no type information.
const toolConfigFiles = ['**/*.config.ts'];
const testFiles = ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts', '**/testing/**/*.ts'];

// Only libs/server/src/db and libs/server/prisma.config.ts may import Prisma (see libs/server/eslint.config.mjs).
const prismaImports = {
  paths: [
    { name: '@prisma/client', message: 'Prisma is only used inside libs/server/src/db.' },
    { name: '@prisma/adapter-pg', message: 'Prisma is only used inside libs/server/src/db.' },
    { name: 'prisma', message: 'Prisma is only used inside libs/server/src/db.' },
  ],
  patterns: [
    {
      group: ['@prisma/client/*', 'prisma/*', '**/generated/prisma/**', '**/db/generated/**'],
      message: 'Prisma and its generated client are only used inside libs/server/src/db.',
    },
  ],
};

// Raw SQL that assigns the rating counters is an easy way to break the totals, so one folder owns it.
const ratingWrite = /\b(review_count|rating_sum|rating_avg)\s*=[^=]/;
const ratingWriteMessage =
  'Only libs/server/src/ratings may write review_count, rating_sum or rating_avg. Call incrementRating or recomputeRatings.';

// Dependencies point downwards: web uses shared, api and import use server and shared, tools drive the import.
const depConstraints = [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:server', onlyDependOnLibsWithTags: ['scope:server', 'scope:shared'] },
  { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:server', 'scope:shared'] },
  { sourceTag: 'scope:import', onlyDependOnLibsWithTags: ['scope:import', 'scope:server', 'scope:shared'] },
  { sourceTag: 'scope:web', onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'] },
  { sourceTag: 'scope:tools', onlyDependOnLibsWithTags: ['scope:import', 'scope:server', 'scope:shared'] },
  // An e2e project talks HTTP only, so it may not import any project.
  { sourceTag: 'type:e2e', onlyDependOnLibsWithTags: [] },
];

export const base = defineConfig([
  globalIgnores(['**/dist', '**/coverage', '**/generated', '**/.angular', '**/tmp', '**/out-tsc']),
  ...nx.configs['flat/base'],
  {
    files: tsFiles,
    extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Nest modules and Angular components are decorated classes without members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: toolConfigFiles,
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
  },
  {
    files: scriptFiles,
    plugins: { 'import-x': importX, 'unused-imports': unusedImports },
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.cts', '.mts'] },
      // Sources import './x.js' for x.ts. Path aliases stay unresolved, Nx checks cycles between projects.
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs', '.json'],
          extensionAlias: {
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
            '.cjs': ['.cts', '.cjs'],
          },
        }),
      ],
    },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-cycle': 'error',
      // The unused-imports rules replace the typescript-eslint one so that imports are fixed automatically.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': ['error', prismaImports],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          // The web shell imports the web lib index statically and lazy-loads its page entries, which are one project.
          checkDynamicDependenciesExceptions: ['^@product-finder/web$'],
          depConstraints,
        },
      ],
    },
  },
  {
    files: scriptFiles,
    ignores: testFiles,
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `TemplateElement[value.raw=${ratingWrite}]`, message: ratingWriteMessage },
        { selector: `Literal[value=${ratingWrite}]`, message: ratingWriteMessage },
      ],
    },
  },
  {
    files: testFiles,
    rules: {
      // Mocks, expect.any() and partial fixtures trip these rules without finding bugs.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    // The boundary rule would resolve the config files themselves.
    files: ['**/eslint.config.mjs'],
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
]);

/** Angular rules for the TypeScript and the templates of scope:web, including inline templates. */
export const angularRules = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
]);

/** Last in every project config, so that style rules never fight Prettier. */
export const formatting = [prettier];

export default [...base, ...formatting];
