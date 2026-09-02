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
  prettier, // last — turns off rules that fight Prettier
);
