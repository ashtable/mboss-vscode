import { fileURLToPath } from 'node:url';

/**
 * Vitest resolves neither tsconfig `paths` nor a
 * package `main` field, so the nested submodule
 * alias is restated here. Keep it in step with
 * tsconfig.json's `paths`.
 *
 * The `vscode` entry has no tsconfig counterpart:
 * that module is not on disk at all. VS Code
 * creates it when the extension host requires it,
 * so a test that loads a module importing `vscode`
 * gets this stand-in instead. Most modules take
 * what they need through `src/vscodeApi.ts` and
 * never touch either one.
 */
export const aliases = {
  '@mboss/core': fileURLToPath(
    new URL('./mboss-core/src/index.ts', import.meta.url),
  ),
  vscode: fileURLToPath(new URL('./test/doubles/vscode.ts', import.meta.url)),
};
