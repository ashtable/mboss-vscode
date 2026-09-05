# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The mBoss VS Code extension ("Design Durable Apps with DBOS"). It contributes four
React webviews — the **workflow canvas** (a custom editor for
`**/.mboss/workflows/*.workflow.json`), the **agent sidebar** (an Agent Client
Protocol client that drives claude-code / codex / gemini / a custom command), the
**Runs** list (a project's DBOS run history read from the project's own Postgres)
and the **See** panel (one run in detail) — and it ships an MCP server bundle plus
an Agent Skill that it copies into every project it creates or refreshes.

Three nested git submodules, each pinned to a version branch in `.gitmodules`
(asserted by `src/pins.test.ts`):

- `mboss-core/` — imported as **source** through the `@mboss/core` path alias
  (IR + zod schemas, validation rules, ELK layout, ts-morph manifest scan, the
  apply engine and its lock, the compiler, the project scaffold).
- `mboss-mcp-server/`, `mboss-skills/` — build context only, never imported.
  `mboss-mcp-server/dist/{server.js,VERSION}` and `mboss-skills/skills/mboss`
  are copied into `dist/` and from there into projects.

## Commands

Fresh clone: `git submodule update --init --recursive && npm ci && npm run build:mcp`.
`build:mcp` runs `npm ci` inside the server submodule and builds its untracked
bundle; several unit specs, the Playwright global setup and every build need it
to exist (the failure message names the command). Rerun it whenever the
`mboss-mcp-server` pin moves — `dist/VERSION` embeds the checkout's sha and the
root build refuses a stamp that is not `mcp-server-vX.Y.Z+<sha>`.

| Task                                          | Command                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Full build (runs `build:mcp` first, slow)     | `npm run build`                                                              |
| Fast host + webview rebuild into `dist/`      | `node src/build.ts`                                                          |
| Package a `.vsix` (root, gitignored)          | `npm run package`                                                            |
| Typecheck + ESLint + Prettier check           | `npm run lint`                                                               |
| Typecheck only / format everything            | `npm run typecheck` / `npm run format`                                       |
| Unit tier                                     | `npm test` (`npm run test:watch` for watch mode)                             |
| One unit file / one test by name              | `npx vitest run src/watchers/debounce.test.ts -t "costs one run"`            |
| Webview tier (Playwright, builds first)       | `npm run test:webview`                                                       |
| One Playwright spec / test                    | `npx playwright test tests/webview/preview.spec.ts -g "says whose proposal"` |
| Postgres integration tier (opt-in, not in CI) | `npm run test:integration`                                                   |

- `npm test` and `npm run test:webview` both **rewrite the real `dist/`**
  (`src/vsix.test.ts` and `tests/webview/build.ts`). Never run them
  concurrently. `vsix.test.ts` also needs `unzip` on PATH. A single Playwright
  spec still runs the whole build in global setup.
- `node src/build.ts` relies on Node 24 type stripping: keep that file erasable
  TypeScript, and only `import type` from siblings (plain `node` will not
  follow a `.js` specifier to a `.ts` file). Path constants are therefore
  spelled twice on purpose (`build.ts` vs `src/vendor/assets.ts` /
  `src/webview/entry.ts`) and `build.test.ts` holds them together.
- Integration tier: needs a Postgres — `docker compose up -d postgres` in the
  superproject `/Users/ash/code/mboss` publishes `127.0.0.1:5432`
  (user `postgres`, password `mboss`), or set `MBOSS_RUNS_TEST_SERVER`. The two
  integration files collide on port 5432 (the stack spec brings up a scaffolded
  project's own compose), so run one file at a time. It creates and drops only
  the database `mboss_vscode_runs_test`.
- `prettier --check .` covers Markdown, JSON, YAML and CSS too. After editing
  `l10n/bundle.l10n.json` or `package.nls.json`, run `npm run format`.
- There is no `launch.json`; the only way to see the extension in a real window
  is `npm run package` and installing `mboss-vscode-0.0.0.vsix`.
- CI (`.github/workflows/ci.yml`) runs on `pull_request` only: build:mcp, lint,
  test, test:webview, package. Pushing to a branch runs nothing until a PR exists.

## Architecture

### Host vs webview

`src/build.ts` makes two esbuild calls because `platform` is per build: the
host (`src/extension.ts` → `dist/extension.cjs`, CommonJS, `@mboss/core`
aliased, `vscode` + DBOS/elk optional requires external) and the four webviews
(`src/{canvas,sidebar,runs,see}/index.tsx` → `dist/webview/<name>.{js,css}`,
ESM, browser, **no alias, no externals but `*.woff2`**). `WEBVIEW_ENTRIES` is
typed against `WebviewName` in `src/webview/entry.ts`.

- `.tsx` means webview-side React, nothing else. `.ts` is host or isomorphic.
  No host `.ts` imports a `.tsx`.
- A webview may value-import only browser-safe modules: `src/core/rules.ts`,
  `src/webview/{client,fill,protocol}.ts`, `src/webview/mount.tsx`,
  `src/runs/queries.ts` (+ `rows.ts`) and the pure `src/canvas/**/*.ts`
  modules. It must never value-import
  `vscode`, `@mboss/core`, `src/messages.ts`, `src/webview/host.ts`, a `node:`
  builtin or `process.env`. Enforcement is the browser esbuild call failing to
  resolve, plus `src/build.test.ts` scanning the output.
- `dist/` also carries assets the host needs beside the bundle: `webview/fonts`
  (the CSP allows only self-hosted fonts), `app/` + `workflows/index.ts` (core's
  scaffold templates, read via `import.meta.dirname`), `node_modules/@types/node`
  (core's manifest scan resolves it at module load — without it the extension
  does not activate), `mcp/` and `skill/`. `.vscodeignore` excludes by
  directory, never by extension, because `dist/` ships `.ts` templates.

### The `vscode` boundary and the `host.ts` seams

The `vscode` module is not on disk; vitest aliases it to `test/doubles/vscode.ts`,
whose `window`, `commands` and most of `workspace` **throw** on access. So
behaviour modules take the editor as an argument:

- A narrow `XHost` type is declared beside its consumer (`ProjectHost` in
  `commands/newProject.ts`, `PanelHost` in `acp/agent.ts`, `RunsHost` in
  `runs/store.ts`, `WatchHost` in `watchers/host.ts`, `PreviewHost` in
  `preview/store.ts`, …) and a factory in the directory's `host.ts` closes over
  `workspace`/`window`, reading trust, folders and settings fresh on every call.
- `src/vscodeApi.ts` (`VsCodeApi`: info / run / pick / replaceDocument /
  onDocumentChanged) is the general-purpose seam used by `commands.ts` and the
  canvas editor.
- Only editor plumbing value-imports `vscode`: `extension.ts`, `messages.ts`,
  the three `words.ts`, `vscodeApi.ts`, `statusBar.ts`, the providers
  (`sidebar/view.ts`, `runs/panels.ts`, `canvas/editor.ts`),
  `webview/host.ts`, every `host.ts`, and `acp/fs.ts`. `import type { Disposable } from 'vscode'` is fine anywhere.
- `src/webview/host.ts` is a different kind of `host.ts`: the host side of the
  webview protocol (see below).
- A second stand-in exists: the `DRIVER` script in
  `src/commands/newProject.test.ts` enumerates every `vscode` API that
  `activate()` touches and runs the built bundle end to end. A new `vscode`
  call on the activation path fails that spec; extend `DRIVER` on purpose, the
  same way you extend the double.

### The core boundary

- `src/core/index.ts` is the **only** file that imports `@mboss/core`. It is
  host-only (the barrel pulls in elkjs and ts-morph) and wraps core's outcomes
  into this extension's own shapes (`readWorkflow`, `nextDocument`,
  `compileWorkflows`, `applyLiveProposal`, `undoWorkflow`, `scanCodeBehind`…).
- `src/core/rules.ts` is the **only** file that reaches into `mboss-core/src/`
  by relative path — the browser-safe slice (`ir`, `validate/handler-fit`,
  `layout/metrics`, types) a webview may load.
- `src/core/index.test.ts` enforces both with **regexes over file contents** of
  shipped `src/` (tests and `src/test-support` are exempt): the strings
  `from '@mboss/core'` and `mboss-core/src/` may not appear anywhere else,
  comments included. Everything else imports `../core/index.js` or
  `../core/rules.js`.
- The alias is spelled in three places that must agree: `tsconfig.json` paths,
  `vitest.aliases.ts`, `src/build.ts` `hostOptions().alias`.
- A `*.workflow.json` on disk is core's `WorkflowIR` serialised. It is written
  by agents as well as the canvas, so always parse it (`readWorkflow`), never
  trust it. `nextDocument` bumps `revision` and serialises with 2-space JSON
  plus a trailing newline — byte-identical to what core's `applySpec` writes
  (tested).
- **Core's write lock** (`.mboss/.lock`) is not reentrant and breaks open after
  10 s. The extension never takes it: `src/watchers/lock.test.ts` greps shipped
  source for the word `withLock`, so it may not appear even in a comment. Core
  calls that take it (`applySpec`, `proposeSpec`, `applyProposal`, `undo`,
  `compileProject`) must run one after another, never one inside another
  (`src/preview/approve.ts` is the model; its spec asserts wall time below
  `STALE_LOCK_MS`). Contending callers — the watchers' run beside an
  approval's apply — are serialised by core's own lock, which polls; no host
  call nests. A host-side queue owning every lock-taking call was considered
  in the September 2026 architecture review and not built for that reason:
  the second generation an approval used to cost was the ledger's gap, not a
  sequencing one.

### Strings

- `src/messages.ts` and the three `words.ts` modules (`canvas/`, `sidebar/`,
  `runs/`) are the only files that call `l10n.t` (`l10n.test.ts` fences the
  list); every entry wraps a **literal**. `l10n/bundle.l10n.json` is key ===
  value and `src/l10n.test.ts` checks both directions over every `.ts`/`.tsx`
  under `src/` (tests included). `package.json` strings go through `%key%` +
  `package.nls.json` (`src/nls.test.ts`, both directions); the two mechanisms
  share nothing and neither falls back to the other.
- Webviews have no `l10n`: their words travel in the init message as bags
  built once by the view's `words.ts` (`canvasWords`, `inspectorWords`,
  `sidebarWords`, `runsWords`, `seeWords`), whose return types are the
  `<View>Strings` types `protocol.ts` derives through type-only imports, with
  `{0}` templates filled by `src/webview/fill.ts`. Nothing under a webview
  entry contains English a user sees.
- The unit double's `l10n.t` returns the English source, so unit specs pin
  English literals; Playwright specs send the bags in `tests/webview/words.ts`,
  which `src/words.test.ts` holds equal to the host's. Rewording a view's copy
  therefore touches its `words.ts`, the bundle and that fixture; a host
  sentence touches `messages.ts`, the bundle and whichever spec pinned it.

### Webview protocol

- `mountWebview` in `src/webview/host.ts` is the one mount path:
  `localResourceRoots` is `dist/` only (never the workspace), the page comes
  from `html.ts` with a nonce'd script CSP, every inbound message is parsed
  with that view's zod schema (`messageSchemaFor`, one union per view,
  failures dropped silently), every `ready` is answered with `init()`, and the
  rest goes to `heard`, typed to that view's kinds. The mount takes a `Frame`
  (a `WebviewView` or a `WebviewPanel`) and the `Source`s the provider follows
  — each given the repaint and answering with its subscription — repaints
  only while the frame is visible, lets every source go when the frame is
  disposed, and returns a `Mount` (`repaint`, `dispose`). The browser half is
  `mountView` in `src/webview/mount.tsx`.
- Host → webview is trusted and is always one whole `init` (the `HostMessage`
  union in `protocol.ts`), re-sent on every change. Views render from the last
  message and **hold nothing**: an activity-bar view is disposed the moment it
  is hidden, so all state lives in stores constructed once in `extension.ts`
  (`agentPanel`, `previewStore`, `runsStore`, `SeePanel`). Stores publish
  through `src/emitter.ts` (`fire`, `on` returning a `Disposable`, `dispose`).
- Every entry is `mountView('<name>', <Component>)` plus
  `import './<name>.css'`, and every per-view stylesheet starts with
  `@import '../webview/tokens.css'`.
- Every canvas editing message carries `baseRevision`; the host refuses a stale
  one. The JSON tab's `text` message is the one exception (written verbatim).

### Activation

`src/extension.ts` decides nothing: it constructs each long-lived object once,
hands it its collaborators (structural slices — the canvas takes `WatchHost`,
`Watchers` and `RunsStore` as `CanvasTrust`/`CanvasCode`/`CanvasRuns`), builds
the command table with `commandHandlers()` in `src/commands.ts` (a pure record;
`commands.test.ts` asserts its keys equal `contributes.commands`), registers
providers and holds the disposables. `activationEvents` is `[]`.

Workspace **trust** is checked per call at every seam that executes or writes
into a folder (codegen, manifest scan, agent start, run history, docker, vendor
refresh, approve/undo) — never cached at activation. Trust granted mid-session
is an event every store subscribes to.

### Subsystems

- **`canvas/`** — `editor.ts` is the host side (`CustomTextEditorProvider`, one
  `CanvasSession` per panel in a static map, `active()` for the Arrange
  command). Every gesture is a message; every edit lands through
  `api.replaceDocument` so VS Code keeps undo/dirty/save. A **gesture** is
  what the panel sent; an **edit** is the pure function of the document it
  becomes, worked out in `edits.ts`: `editFor(gesture, context)` takes the
  document, its boxes, the manifest and the palette labels and answers
  `next` / `refused` / `nothing`; `waysOutOf` says which ports a wire may
  leave by. `CanvasSession` is gate, compute, write: it refuses a stale
  `baseRevision` first, asks the picker which way out a wire takes, calls
  `editFor`, then says the sentence, selects, notes and writes.
  `CanvasInit.editing` is the one place a view reads whether it may edit and
  against which revision (absent over an unreadable file or a live proposal),
  and `inspector.selected` is an id: the column reads a block's fields and
  where its outcomes lead off the document. The webview never
  repaints itself: it redraws when `onDocumentChanged` fires `reread` + post
  (tests simulate this with `livingDocument().saved()`). Layout: core `place()`
  runs ELK only when no node has a position; `onTheGrid` snaps unplaced boxes;
  the first hand move pins every position into the document; Arrange writes
  `withoutPositions`. `layoutKeyOf` (revision + hash of nodes/edges/boxes)
  decides whether the view keeps the positions it is holding. While a proposal
  is live the canvas is read-only (`heard()` ignores everything).
- **`preview/`** — an agent proposal is a **file** (`.mboss/proposals/*.proposal.json`,
  written by the MCP server through core's `proposeSpec`; core keeps one live
  proposal per workflow). The store reloads on watcher events; approve runs
  `applyLiveProposal` → `applied()` → `regenerate()` → `notify(agent)`, strictly
  in sequence because of the lock. `src/see/` is unrelated: it is the run
  flight recorder fed by `runs/`.
- **`acp/`** — `connection.ts` is the only importer of
  `@agentclientprotocol/sdk` (content-regex enforced; the version is pinned
  exactly by `sdk.test.ts`). `agent.ts` holds one session per window,
  `session.ts` is the pure state machine and says whether a prompt may go now
  (`sendingWhile`: spawn, queue or prompt; a start that fails drops what was
  waiting for it), `permissions.ts` remembers "always"
  answers in `workspaceState`, `fs.ts` serves `fs/read_text_file` and
  `fs/write_text_file` through `workspace.fs` (no terminal capability).
  `registry.ts` is the published contract for the `mboss.agent.*` settings.
  `test/fixtures/scripted-peer.mjs` is a hand-written JSON-RPC peer for
  `connection`/`capabilities`/`agent` specs only — do not grow it into an e2e agent.
- **`runs/`** — hand-composed parameterised `SELECT`s over
  `dbos.workflow_status` / `dbos.operation_outputs` via `pg` (`queries.test.ts`
  enforces SELECT-only, the `dbos.` prefix and `$n` binds); the one write is a
  fork through `DBOSClient` (`replay.ts`). `stack.ts` drives `docker compose`
  with `execFile`; `runner.ts` POSTs to the scaffolded app's `/runs` and
  `/events` with the secret from the project's `.env` (`env.ts` reads only that
  file); `watch.ts` polls a started run every 500 ms and goes quiet after 15 s.
  `queries.ts` and `rows.ts` are shared with the browser bundle: no Node
  imports there; `db.ts` is the only file that may import `pg`.
- **`watchers/`** — per folder: globs for workflow documents, `lib/**` and
  proposals, plus `onDidSaveTextDocument` (a watcher can be silenced by
  `files.watcherExclude`), coalesced by a 300 ms `Debouncer` keyed on the
  project into one `generate(project)`: scan `lib/` (core `loadOrScan`, ts-morph,
  cached in `.mboss/manifest.json` on a source hash), validate every document,
  **pre-parse before `compileProject`** (which throws on an unreadable document
  and would otherwise prune its generated code), publish `Problem`s to the
  PROBLEMS panel (anchored at 0,0), update the status bar. The proposal glob
  never triggers codegen; codegen follows a **save**, not a canvas edit. A run
  records the fingerprint of every document it reads and every file it writes
  in `Accounted`, and an event about bytes already accounted for is answered
  with nothing — asked when the event arrives and again when the debounced run
  fires — so an approval, an undo or the canvas's own write costs one
  generation (`approval.test.ts`).
- **`vendor/`** — `shippedVendor` reads `dist/mcp` + `dist/skill`; `newProject`
  scaffolds through core with the bundle and copies the skill to both
  `.mboss/skills/mboss` and `.claude/skills/mboss`; `offerVendorRefresh` at
  activation compares the VERSION stamp, then byte-compares skill files.

## Tests

Three tiers, three configs, and placement decides which runs:

- **Unit**: `src/**/*.test.ts` only — a spec under `test/` or `tests/` never
  runs under `npm test`. Real filesystems (`mkdtemp` scratch dirs), real child
  processes, no `vi.mock`, no snapshots. Specs that run the real build:
  `build.test.ts`, `commands/newProject.test.ts` (into tmp), `vsix.test.ts`
  (into the real `dist/`), `watchers/lock.test.ts` (esbuilds `applyChild.ts`).
- **Integration**: `test/integration/*.integration.test.ts` — real Postgres +
  DBOS, `fileParallelism: false` (DBOS is a process singleton).
- **Playwright**: `tests/webview/*.spec.ts` — the built bundles on a page with
  no VS Code; `harness.ts` serves `dist/` through `page.route` and stubs
  `acquireVsCodeApi`. `retries: 0`. Colour assertions are literal Chromium
  serialisations on purpose (reading the token back would pass any value).
  Never measure the graph before a locator expectation or `graphAtRest()` has
  settled it. A spec may import only `src` modules whose transitive graph never
  touches `vscode` or `@mboss/core` (no alias is configured).

Doubles and helpers: `test/doubles/vscode.ts` (fails loudly for anything not
added on purpose), `watchHost.ts`, `webview.ts`; `src/test-support/` (exempt
from the boundary greps): `project.ts` scaffolds a real project with core and
copies fixtures from `mboss-core/fixtures/` (the submodule worktree must be at
the pinned commit — bump commits move it together with the gitlink), `vendor.ts`,
`peer.ts`, `proposals.ts`, `applyChild.ts`.

Manifest-as-data specs pin `package.json`: `contributes.test.ts` (exact palette
id/title list and order, side-bar commands named `_mboss.<x>#sideBar` with an
icon and `commandPalette when: 'false'`, views, settings, custom editor),
`commands.test.ts`, `nls.test.ts`, `l10n.test.ts`, `pins.test.ts`. Specs that
cite "the design" refer to no document in this repo or the superproject — the
pinned expectation is the record; edit the test.

Other content-regex fences: `@agentclientprotocol/sdk` may appear only in
`acp/connection.ts` and `acp/sdk.test.ts` (tests are not exempt); no
`from 'node:fs'` in files directly under `src/acp`; `canvas/edits.ts`
value-imports only `core/rules` and `canvas/wiring` and never names `vscode`,
`messages` or `core/index` (`canvas/edits.test.ts`).

## Conventions

- ESM throughout: every relative import ends in `.js` (even for `.tsx`
  targets). `verbatimModuleSyntax` — use `import type` for types, or a value
  import of a `vscode`/Node module leaks into the graph. Import groups in order:
  `node:` builtins, `vscode`, packages, `../`, `./`, blank line between.
- `type` aliases, never `interface`; no `enum`; no default exports (except
  Playwright's `globalSetup`). Classes only for VS Code provider objects, the
  `AgentStartError` exception and two small helpers; everything else stateful is
  a factory returning closures. Expected failures are values — discriminated
  unions on `at` / `ok` / `ran` / `because` — not thrown. User-facing failures become a `messages.*`
  sentence through the seam; project findings become `Problem` records
  (`src/problem.ts`, message verbatim from whoever found it). No `console.*`;
  the only log surface is the "mBoss Stack" output channel.
- Every module opens with a `/** … */` header stating the decision and why,
  wrapped at ~50 columns; inline comments justify, they do not restate. No
  TODO/FIXME, no `eslint-disable`, no `@ts-ignore`, no `any`.
- Specs read as sentences: `describe('a debouncer that has been disposed')` +
  `it('ignores …')`. Prefer computed expectations (`validateWorkflow`,
  `layoutKeyOf`, core goldens) over hard-coded wording unless the wording is
  the thing pinned.
- Naming: webview entries are `src/<name>/index.tsx` + `src/<name>/<name>.css`;
  `index.ts` is never a barrel; `host.ts` always means "the editor as this
  directory reaches for it"; `view.ts` is a provider in `sidebar/` but a pure
  init builder in `preview/` and `runs/`. Data crossing `postMessage` is plain
  JSON (no `Map`, no class instances).
- Prettier: single quotes, semicolons, width 80. ESLint has no import rules —
  the boundaries above are enforced by tests and the build, not lint.
- Submodules lint in their own repos (ignored here). `mboss-core/` is a detached
  checkout with no `node_modules`; core's own gate (`erasableSyntaxOnly`,
  `lib: ES2023`) is stricter than this repo's tsconfig, so run core's lint in
  core before pushing a core change made from here.
- `.claude/skills/` holds vendored dev-time skills for working **on** this
  repo (byte-identical to the superproject's copies; prettier-ignored; excluded
  from the VSIX). It is not the mboss skill and holds no JS/TS.
- Git: work lands on a version branch `vscode-vX.Y.Z`; `main` only receives
  merged PRs. Commit subjects are one imperative sentence naming what the
  product now does or refuses, no `type:` prefix, prose body. `package.json`
  `version` stays `0.0.0` — the version lives in the branch name.

## Recipes

- **Add a command**: a `contributes.commands` entry with
  `%commands.<x>.title%` plus a `package.nls.json` key; a key in the record
  returned by `commandHandlers()` with its thunk wired in `extension.ts`; the
  pinned id and title lists in `contributes.test.ts`. A title-bar button is a
  separate `_mboss.<x>#sideBar` twin that carries an `icon`, is hidden from the
  palette with `when: 'false'`, and has a `view/title` entry whose `when`
  starts with `view == mboss.`.
- **Add a webview**: name in `WebviewName` and `WEBVIEW_ENTRIES`; its message
  union in `SCHEMAS` in `webview/host.ts`; `src/<name>/index.tsx` calling
  `mountView` + `<name>.css`; `<Name>Init` + `<Name>Strings` in the
  `HostMessage` union; a `messages.<name>Strings()` builder; a host caller of
  `mountWebview`; `build.test.ts` / `vsix.test.ts` expect one js+css per entry.
- **Add a string**: a host sentence is a `messages.ts` entry + identical
  key=value line in `l10n/bundle.l10n.json`; a word a webview shows is a line
  in that view's `words.ts`, the bundle line, and the same line in
  `tests/webview/words.ts`. Some copy is duplicated
  across the two systems on purpose (agent names in `package.nls.json`
  enum descriptions and `messages.agents()`).
- **Add an Inspector field**: `canvas/inspector/forms.ts` lens + entries in
  `inspectorFields()`/`inspectorOptions()` in `messages.ts` + bundle lines;
  `forms.test.ts` asserts every field and option has a word.
- **Add a canvas gesture**: a zod schema in `webview/host.ts` and its member
  in `WebviewMessageSchema`; a `Gesture` member and a case in `editFor` in
  `canvas/edits.ts`, with the rule pinned in `edits.test.ts`; the
  `postToHost` in `Canvas.tsx`; a Playwright case in
  `tests/webview/canvas.spec.ts`. `CanvasSession` changes only when the
  gesture asks a question first, as `connect` does.
- **Bump a submodule**: `git -C <sub> fetch && git -C <sub> checkout <sha>`,
  `git add <sub>`; if the branch changed, edit `.gitmodules` and the regex in
  `src/pins.test.ts`; if `mboss-mcp-server` moved at all, `npm run build:mcp`;
  then `npm test`. The server's tool count is pinned in
  `src/vendor/serverSmoke.test.ts` and its SKILL.md frontmatter is checked
  against `tools.manifest.json` in `src/vendor/assets.test.ts`.
- **Add a bundled dependency, font or inlined icon set**: add a `## <name>`
  heading to `THIRD_PARTY_NOTICES.md` (`vsix.test.ts` checks every non-external
  dependency). A guarded `require` esbuild cannot resolve goes in
  `OPTIONAL_AT_RUNTIME` in `src/build.ts`.
