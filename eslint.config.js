// @ts-check
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const domainIsPure = 'The domain package does no I/O: pass time, randomness and data in (CODE-5).';

/**
 * Which layer may import which (CODE-4, ADR-0008 §3, ADR-0023 §2). Exported for its test.
 */
export const boundaries = defineConfig(
  {
    files: ['packages/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@householdr/*'],
              message: 'The domain package depends on nothing (CODE-4).',
            },
            { group: ['node:*'], message: domainIsPure },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['process', 'fetch', 'crypto', 'setTimeout', 'setInterval'].map((name) => ({
          name,
          message: domainIsPure,
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: domainIsPure },
        { object: 'Math', property: 'random', message: domainIsPure },
        { object: 'Temporal', property: 'Now', message: domainIsPure },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: ":matches(NewExpression, CallExpression)[callee.name='Date']",
          message:
            'Use Temporal, with the time passed in; Date only at the edges (CODE-5, CODE-18).',
        },
      ],
    },
  },
  {
    files: ['packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@householdr/*', '!@householdr/domain'],
              message: 'The db package depends only on domain (CODE-4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/application/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@householdr/*', '!@householdr/domain', '!@householdr/db'],
              message: 'The application package depends only on domain and db (CODE-4).',
            },
            {
              group: ['svelte', 'svelte/*', '@sveltejs/*', '$app/*', '$env/*'],
              message: "Use cases don't know their caller (CODE-26).",
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message:
            "Use cases don't read the environment; it comes in through the context (CODE-26).",
        },
      ],
    },
  },
  {
    files: ['packages/adapters/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@householdr/*', '!@householdr/domain', '!@householdr/application'],
              message:
                'Adapters implement the ports of the application package and depend on nothing else (CODE-4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/worker/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@householdr/*', '!@householdr/application', '!@householdr/adapters'],
              message:
                'Jobs call use cases from the application package, with adapters for their ports (CODE-4, CODE-10).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@householdr/*',
                '!@householdr/application',
                '!@householdr/adapters',
                '!@householdr/domain',
              ],
              message:
                'Routes call use cases from the application package, with adapters for their ports; domain only for previews (CODE-4, CODE-10).',
            },
          ],
        },
      ],
    },
  },
);

export default defineConfig(
  globalIgnores(['**/dist/', '**/build/', '**/coverage/', '**/.svelte-kit/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  // Disabling a rule inline needs a reason (CODE-24).
  comments.recommended,
  { rules: { '@eslint-community/eslint-comments/require-description': 'error' } },
  // Non-null assertions are allowed in tests only (CODE-1).
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  boundaries,
  prettier,
);
