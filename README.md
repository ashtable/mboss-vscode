# mboss-vscode

mBoss: Design Durable Apps with DBOS - VS Code Extension

## Layout

- `src/` — extension host code and the webview entries. Host modules end in
  `.ts`, webview entries in `.tsx`. Unit tests sit beside what they test.
- `media/` — static assets `package.json` points at.
- `l10n/` — the English strings for `vscode.l10n.t()` calls. `package.nls.json`,
  at the root, covers `package.json` instead; the two mechanisms are separate
  and neither falls back to the other.
- `mboss-core/` — nested submodule, imported as `@mboss/core` through a
  tsconfig path alias.

## Scripts

- `npm run build` — bundles the extension host and every webview into `dist/`,
  and copies the assets that have to sit beside the bundle.
- `npm run package` — builds, then produces a `.vsix`.
- `npm test` — the vitest suite. Some specs run the real build and package a
  VSIX, so a cold run is not instant.
- `npm run lint` — `tsc --noEmit`, ESLint and a Prettier check.
