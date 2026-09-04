import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { build, type BuildOptions } from 'esbuild';

import type { WebviewName } from './webview/entry.js';

/**
 * Building what ships.
 *
 * `npm run build` runs this file, which is why
 * nothing in it is imported from a sibling at run
 * time: plain `node` reads the TypeScript here,
 * but it will not follow a `.js` specifier to a
 * `.ts` file. The one import above is type-only
 * and is erased before that matters.
 *
 * Two esbuild calls, not one. `platform` is a
 * per-build option rather than a per-entry-point
 * one, and the host runs on Node while every
 * webview runs in a browser frame — so a single
 * call genuinely cannot cover both. All the
 * webviews still share one call and one set of
 * options.
 */

const repoRoot = resolve(import.meta.dirname, '..');

/** Where the build leaves everything by default. */
export const DIST = join(repoRoot, 'dist');

/**
 * The host bundle's name. CommonJS, because the
 * extension host `require`s the entry point, and
 * `.cjs` because this package is otherwise ESM.
 */
export const HOST_BUNDLE = 'extension.cjs';

/**
 * Every webview built. Typed against the names the
 * host can ask for, so an entry nothing can load
 * does not compile.
 *
 * Adding one is a name here and a file beside the
 * others. The run list and the run detail are two
 * of them rather than one: they are a 300px panel
 * in the activity bar and a page in the editor,
 * with no markup in common, and a bundle serving
 * both would ship each surface into the frame
 * showing the other.
 */
export const WEBVIEW_ENTRIES: readonly WebviewName[] = [
  'canvas',
  'sidebar',
  'runs',
  'see',
];

/**
 * The two faces the webviews are set in, and where
 * a stylesheet expects to find them.
 *
 * A webview may only load a font the extension
 * itself ships — `font-src` is its own origin and
 * nothing else — so the faces are vendored rather
 * than fetched. `tokens.css` asks for them with a
 * relative `url()`, which resolves against the
 * stylesheet's own webview URI, so they have to
 * land in this directory beside the built
 * stylesheets under exactly the names it spells.
 */
export const WEBVIEW_FONTS = {
  from: 'media/fonts',
  to: 'webview/fonts',
} as const;

/**
 * Core's runtime templates, and where they have to
 * land.
 *
 * Core reads `scaffold/app/**` and the registry
 * seed off disk with `import.meta.dirname` on
 * purpose, so that express, the DBOS SDK and the
 * Prisma client stay out of the import graph of a
 * library the cloud services nest as source. Once
 * that code is bundled, `import.meta.dirname` is
 * wherever the bundle sits — so the templates have
 * to sit there too, under exactly these names.
 */
export const SCAFFOLD_TEMPLATES = [
  { from: 'src/scaffold/app', to: 'app' },
  { from: 'src/scaffold/workflows/index.ts', to: 'workflows/index.ts' },
] as const;

/**
 * Packages that have to stay resolvable from
 * beside the bundle.
 *
 * Core's manifest scan type-checks a project's
 * code-behind, and it hands the type checker Node's
 * own declarations so that `process.env` in an
 * ordinary handler does not scan as an error. It
 * finds them with `createRequire(...).resolve`,
 * from core's own location, deliberately — the
 * scan has to mean the same thing on every machine,
 * including in a project whose dependencies are not
 * installed.
 *
 * Bundled, "core's own location" becomes the
 * bundle's, and an installed extension has no
 * dependency tree around it. The resolve then
 * throws while the module is still loading, which
 * is to say the extension does not activate at all.
 * So the declarations travel with it, in the one
 * directory Node's resolver will look in.
 */
export const SHIPPED_PACKAGES = ['@types/node'] as const;

/**
 * Modules nothing here installs, behind requires
 * nothing here reaches.
 *
 * `web-worker` is elkjs asking for a real worker,
 * and only when a caller asks for one — which
 * nothing does. The rest are DBOS's telemetry: its
 * client `require`s OpenTelemetry and Winston
 * inside functions that return early unless tracing
 * or OTLP logging was switched on, and this
 * extension switches on neither.
 *
 * Left external, each stays a caught failure at run
 * time instead of an error at build time — and
 * installing eight packages to satisfy a branch
 * that never runs would put them in every VSIX.
 * A new one appearing here fails the build loudly,
 * which is the right place to be asked again.
 */
export const OPTIONAL_AT_RUNTIME = [
  'web-worker',
  'winston',
  'winston-transport',
  '@opentelemetry/api',
  '@opentelemetry/context-async-hooks',
  '@opentelemetry/core',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/sdk-logs',
  '@opentelemetry/sdk-trace-base',
] as const;

/**
 * The control plane a new project is given, and
 * where it is found.
 *
 * Each comes from its own released pin. The server
 * repository nests the skill too, and reaching
 * through it would have been one submodule fewer —
 * but its gitlink is behind the skill's own
 * released branch, so that route ships a skill with
 * a reference file missing and two rules unfixed.
 * Two pins, and a spec here holds the pair to one
 * tool surface.
 *
 * The server's `dist/` is not tracked anywhere — a
 * checkout gives you its source, not its bundle —
 * so this copies rather than builds, and the build
 * that produces it is a separate script that
 * installs and runs another repository's own.
 *
 * These paths are spelled here and read back
 * through `src/vendor/assets.ts`. Plain `node` runs
 * this file and will not follow a `.js` specifier
 * to a `.ts` sibling, so the two spellings cannot
 * be shared; `src/build.test.ts` asserts they agree.
 */
export const VENDORED_ASSETS = [
  { from: 'mboss-mcp-server/dist/server.js', to: 'mcp/server.js' },
  { from: 'mboss-mcp-server/dist/VERSION', to: 'mcp/VERSION' },
  { from: 'mboss-skills/skills/mboss', to: 'skill' },
] as const;

/** What makes them, named in the failure that wants
 *  them. */
export const MCP_BUILD_COMMAND = 'npm run build:mcp';

/**
 * What a build of the server calls itself.
 *
 * The stamp is bytes from another repository, and
 * it is also what a project ends up carrying: the
 * extension compares the two for exact equality to
 * decide whether somebody's vendored copy has
 * drifted. A stamp naming a different repository is
 * therefore not cosmetic — it is a refresh offered
 * over no drift at all, and a refresh rewrites
 * files in somebody's project.
 *
 * Which repository built it is the one thing about
 * those bytes this build can check, so it does.
 */
const MCP_VERSION_STAMP = /^mcp-server-v\d+\.\d+\.\d+\+[0-9a-f]+$/;

/**
 * A CommonJS module has no `import.meta`, and
 * esbuild leaves an empty one behind rather than
 * failing the build. Core reads its scaffold
 * templates from `import.meta.dirname` and
 * resolves the Node type declarations from
 * `import.meta.url`, so an empty one means paths
 * of `undefined/app` at run time, from a packaged
 * extension, with every test short of a real
 * install passing.
 *
 * The two that have a CommonJS spelling are
 * defined as it; the URL is made once at the top
 * of the bundle, where every inlined module can
 * see it.
 */
const IMPORT_META_URL = '__mbossImportMetaUrl';

const importMetaShim = [
  `var ${IMPORT_META_URL} =`,
  " require('node:url').pathToFileURL(__filename).href;",
].join('');

/**
 * The extension host build.
 *
 * Exported whole so a test can build a probe with
 * the same options rather than a guess at them.
 */
export function hostOptions(outdir: string): BuildOptions {
  return {
    entryPoints: [
      { in: join(repoRoot, 'src', 'extension.ts'), out: 'extension' },
    ],
    outdir,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    // `vscode` is not on disk anywhere: VS Code
    // creates it when the extension host requires
    // it. The rest are guarded requires nothing
    // here reaches — see the list.
    external: ['vscode', ...OPTIONAL_AT_RUNTIME],
    // Off on purpose. A source map's `sources` are
    // written relative to where the build left
    // them, which from anywhere but the source tree
    // spells out the directory tree of the machine
    // that built it — and this is built centrally
    // and installed elsewhere. Turn it on locally
    // while working on a webview.
    sourcemap: false,
    alias: { '@mboss/core': join(repoRoot, 'mboss-core', 'src', 'index.ts') },
    banner: { js: importMetaShim },
    define: {
      'import.meta.dirname': '__dirname',
      'import.meta.filename': '__filename',
      'import.meta.url': IMPORT_META_URL,
    },
    logLevel: 'warning',
  };
}

/** Every webview, in one browser-platform build. */
export function webviewOptions(outdir: string): BuildOptions {
  return {
    entryPoints: WEBVIEW_ENTRIES.map((name) => ({
      in: join(repoRoot, 'src', name, 'index.tsx'),
      out: `webview/${name}`,
    })),
    outdir,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    // The faces are copied in whole, under the
    // names `tokens.css` spells, so the `url()`s
    // that name them are left exactly as written.
    // Bundled instead, each would arrive under a
    // content hash — a name no stylesheet a person
    // reads could ever contain.
    external: ['*.woff2'],
    // React branches on this. Left undefined it
    // survives into the bundle as a reference to a
    // `process` no browser frame has.
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  };
}

/** Builds the host, the webviews and the assets. */
export async function buildExtension(outdir: string = DIST): Promise<void> {
  mkdirSync(outdir, { recursive: true });

  await build(hostOptions(outdir));
  await build(webviewOptions(outdir));

  copyWebviewFonts(outdir);
  copyScaffoldTemplates(outdir);
  copyShippedPackages(outdir);
  copyVendoredAssets(outdir);
}

/**
 * The licences travel in the package beside the
 * sources they are terms for, and are named again
 * in `THIRD_PARTY_NOTICES.md`. Only the faces
 * themselves have to be loadable, so only they go
 * where a stylesheet can reach them.
 */
function copyWebviewFonts(outdir: string): void {
  cpSync(join(repoRoot, WEBVIEW_FONTS.from), join(outdir, WEBVIEW_FONTS.to), {
    recursive: true,
    filter: (source) => !source.endsWith('.txt'),
  });
}

/**
 * The MCP bundle and the skill, copied in as they
 * are.
 *
 * Missing is a hard failure rather than a smaller
 * package. A build that quietly shipped without
 * these packages, installs, activates, and then
 * fails at the one moment it was asked to make a
 * project — which is the most expensive place to
 * find out.
 */
export function copyVendoredAssets(
  outdir: string,
  root: string = repoRoot,
): void {
  mkdirSync(outdir, { recursive: true });

  for (const asset of VENDORED_ASSETS) {
    const from = join(root, asset.from);
    const to = join(outdir, asset.to);

    if (!existsSync(from)) {
      throw new Error(
        `the vendored control plane is not built at ${from} — ` +
          `run \`${MCP_BUILD_COMMAND}\``,
      );
    }

    if (asset.to.endsWith('VERSION')) checkVersionStamp(from);

    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
}

/** Refuses to package a server built by anything
 *  but the server's own repository. */
function checkVersionStamp(path: string): void {
  const stamp = readFileSync(path, 'utf8').trim();

  if (MCP_VERSION_STAMP.test(stamp)) return;

  throw new Error(
    `${path} is stamped \`${stamp}\`, which is not a build of ` +
      `mboss-mcp-server — run \`${MCP_BUILD_COMMAND}\``,
  );
}

/**
 * Core's own walker skips tests and snapshots when
 * it reads these, so shipping them would only make
 * the package bigger.
 */
function copyScaffoldTemplates(outdir: string): void {
  for (const template of SCAFFOLD_TEMPLATES) {
    cpSync(
      join(repoRoot, 'mboss-core', template.from),
      join(outdir, template.to),
      {
        recursive: true,
        filter: (source) =>
          basename(source) !== '__snapshots__' && !source.endsWith('.test.ts'),
      },
    );
  }
}

/** `node_modules` because that is where Node's
 *  resolver looks, not because anything is
 *  installed here. */
function copyShippedPackages(outdir: string): void {
  for (const name of SHIPPED_PACKAGES) {
    cpSync(
      join(repoRoot, 'node_modules', name),
      join(outdir, 'node_modules', name),
      { recursive: true },
    );
  }
}

/** Building is what this file does when it is run
 *  rather than imported. */
if (process.argv[1] === import.meta.filename) await buildExtension();
