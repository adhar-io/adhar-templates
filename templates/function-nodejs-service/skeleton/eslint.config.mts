// ESLint: `npm run lint`, and the first thing `npm test` runs, so app-ci's
// test stage fails on what it finds. ESLint's recommended rules and
// typescript-eslint's type-checked ones: mistakes — an unused variable, a
// promise nobody awaits or catches, an `any` leaking into typed code — not
// style. ESLint loads this TypeScript file through jiti (a devDependency).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // dist/ is the compiler's output.
  globalIgnores(['dist/']),
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // The types come from tsconfig.json, the same program `npm run
        // typecheck` checks.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-only imports say so (`import type`): nothing is loaded at
      // runtime for them.
      '@typescript-eslint/consistent-type-imports': 'error',
      // node:test's test() returns a promise the runner itself awaits.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite'] }] },
      ],
    },
  },
]);
