import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      // Nested submodules lint in their own repos.
      'mboss-core/**',
      'mboss-mcp-server/**',
      'mboss-skills/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain JavaScript here is a Node script — a
    // test fixture run as a child process. The
    // TypeScript half gets its globals from
    // `@types/node`, which this half has no
    // compiler to read.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  prettier, // last — turns off rules that fight Prettier
);
