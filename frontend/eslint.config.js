// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config (eslint@9). Two tiers:
//   1. js/ts "recommended" (non-type-checked) over every source + test file
//      — fast, no project resolution needed.
//   2. A type-aware block (projectService) over app source only, enabling
//      the two rules that actually need type info: no-floating-promises
//      (async bugs that silently swallow rejections) and no-explicit-any.
// Type-aware linting is intentionally NOT applied to tests-unit/ or
// tests-e2e/ — vitest/playwright fixtures lean on `any` and fire-and-forget
// promises in ways that would make the type-aware tier mostly noise there.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-tsc/**',
      'node_modules/**',
      'test-results/**',
      'tests-e2e/screenshots/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Type-aware tier: app source only.
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
