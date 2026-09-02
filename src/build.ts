import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
 * others — the Runs view is its own entry when it
 * arrives.
 */
export const WEBVIEW_ENTRIES: readonly WebviewName[] = [
  'canvas',
  'inspector',
  'sidebar',
];

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
    // it. `web-worker` is elkjs reaching for a real
    // worker behind a guarded require, and only
    // when a caller asks for one — which nothing
    // here does. Left external, its absence stays a
    // caught failure at run time instead of a build
    // error now.
    external: ['vscode', 'web-worker'],
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

  copyScaffoldTemplates(outdir);
  copyShippedPackages(outdir);
  copyVendoredAssets(outdir);
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
export function copyVendoredAssets(outdir: string): void {
  mkdirSync(outdir, { recursive: true });

  for (const asset of VENDORED_ASSETS) {
    const from = join(repoRoot, asset.from);
    const to = join(outdir, asset.to);

    if (!existsSync(from)) {
      throw new Error(
        `the vendored control plane is not built at ${from} — ` +
          `run \`${MCP_BUILD_COMMAND}\``,
      );
    }

    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
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
