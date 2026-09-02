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
- `mboss-mcp-server/`, `mboss-skills/` — nested submodules that are build
  context, not imports. The MCP server bundle and the Agent Skill are copied
  out of them into `dist/` and from there into every new project.

## Scripts

- `npm run build:mcp` — installs the nested MCP server and builds its
  single-file bundle. Its `dist/` is not tracked, so a fresh checkout has the
  source and not the bundle, and everything that builds this extension needs
  it first. Run this once after cloning.
- `npm run build` — runs `build:mcp`, then bundles the extension host and every
  webview into `dist/` and copies the assets that have to sit beside the
  bundle.
- `npm run package` — builds, then produces a `.vsix`.
- `npm test` — the vitest suite. Some specs run the real build and package a
  VSIX, so a cold run is not instant, and they need `npm run build:mcp` to have
  run at least once.
- `npm run test:webview` — the Playwright specs. They drive the built webview
  bundles on a page with no VS Code behind them, and build first.
- `npm run lint` — `tsc --noEmit`, ESLint and a Prettier check.
