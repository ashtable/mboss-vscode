import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  HOST_BUNDLE,
  SCAFFOLD_TEMPLATES,
  WEBVIEW_ENTRIES,
  buildExtension,
  copyVendoredAssets,
  hostOptions,
} from './build.js';
import { REPO_ROOT, fileExists } from './test-support/repo.js';
// Deliberately the module the *extension* reads its
// vendored assets through, not the build's own
// spelling of the same paths. Plain `node` runs the
// build script and will not follow a `.js`
// specifier to a `.ts` sibling, so the two cannot
// share a constant — this is where they are held
// together instead.
import { shippedVendor } from './vendor/index.js';
// Deliberately the module the *host* asks for a
// bundle through, not the build's own spelling of
// the same path. The two agreeing is the thing
// worth checking.
import { webviewFile } from './webview/entry.js';

/**
 * The build, run for real and read back.
 *
 * Everything asserted here is invisible to the
 * type checker and to every other spec: whether a
 * module stayed external, whether a browser bundle
 * quietly acquired a Node import, whether a path
 * from this machine was baked into something that
 * ships. None of it shows up until the extension
 * is installed somewhere else.
 */

const scratch: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-build-'));
  scratch.push(dir);
  return dir;
}

/** Every file the build left, recursively. */
function outputs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? outputs(path) : [path];
  });
}

describe('the built extension', () => {
  let outdir: string;
  /** The root an installed extension would have:
   *  the one holding `dist/`. */
  let root: string;

  beforeAll(async () => {
    root = scratchDir();
    outdir = join(root, 'dist');
    await buildExtension(outdir);
  });

  afterAll(() => {
    while (scratch.length > 0) {
      rmSync(scratch.pop() as string, { recursive: true, force: true });
    }
  });

  it('emits a host bundle', () => {
    expect(fileExists(join(outdir, HOST_BUNDLE))).toBe(true);
  });

  /**
   * `vscode` is not on disk anywhere. VS Code
   * creates it when the extension host requires
   * it, so bundling it in is not possible and
   * leaving it out is not optional.
   */
  it('leaves the editor API to the editor', () => {
    const host = readFileSync(join(outdir, HOST_BUNDLE), 'utf8');

    expect(host).toContain('require("vscode")');
  });

  /**
   * A webview runs in a browser frame with no
   * `require`, no `process` and no Node built-ins.
   * esbuild will happily leave a `node:path` import
   * in a browser bundle if the platform is wrong,
   * and the failure arrives as a blank panel.
   *
   * Matched on the import rather than on the text
   * `node:`, which turns up in any object literal
   * with a `node` field — React's own code is full
   * of them.
   */
  it('emits a browser bundle per webview, with no Node in it', () => {
    const builtin = /(?:require\(|from\s*)["'](node:[\w/.-]+)["']/g;

    for (const name of WEBVIEW_ENTRIES) {
      const path = join(outdir, webviewFile(name, 'js'));

      expect(fileExists(path)).toBe(true);

      const bundle = readFileSync(path, 'utf8');
      expect([...bundle.matchAll(builtin)].map((match) => match[1])).toEqual(
        [],
      );
      expect(bundle).not.toContain('process.env');
    }
  });

  it('emits a stylesheet per webview', () => {
    for (const name of WEBVIEW_ENTRIES) {
      expect(fileExists(join(outdir, webviewFile(name, 'css')))).toBe(true);
    }
  });

  /**
   * A webview may only load a font the extension
   * itself ships, and a `url()` resolves against
   * the stylesheet's own webview URI. So the
   * question is not whether the build copied a
   * face — it is whether what the built CSS asks
   * for is where it asks for it.
   *
   * Nothing else can tell. A face that did not
   * ship is not an error anywhere: it is a panel
   * set in the platform's fallback, in an install
   * nobody here ever loads.
   */
  it('ships every face its stylesheets ask for', () => {
    const asked: string[] = [];

    for (const name of WEBVIEW_ENTRIES) {
      const sheet = join(outdir, webviewFile(name, 'css'));
      const css = readFileSync(sheet, 'utf8');

      for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const url = match[1] as string;

        // A scheme is somebody else's origin, which
        // the content security policy refuses long
        // before this would.
        expect(url).not.toContain(':');

        asked.push(url);
        expect(fileExists(resolve(dirname(sheet), url))).toBe(true);
      }
    }

    expect(asked).toContain('fonts/albert-sans-latin.woff2');
    expect(asked).toContain('fonts/spline-sans-mono-latin.woff2');
  });

  /**
   * A path baked in at build time resolves to
   * nothing on the machine that installs the
   * extension, and the failure comes much later
   * than this.
   */
  it('carries no path from the machine that built it', () => {
    for (const path of outputs(outdir)) {
      expect(readFileSync(path, 'utf8')).not.toContain(REPO_ROOT);
    }
  });

  /**
   * Core's scaffold reads its runtime templates
   * off disk on purpose, so that express, the DBOS
   * SDK and Prisma stay out of the import graph of
   * a library the cloud services nest as source.
   * `import.meta.dirname` therefore resolves to
   * wherever the bundle sits once that code is
   * bundled, and the templates have to be there.
   */
  it('ships the scaffold templates beside the bundle', () => {
    for (const template of SCAFFOLD_TEMPLATES) {
      expect(fileExists(join(outdir, template.to))).toBe(true);
    }

    const app = join(outdir, 'app');
    expect(readdirSync(app).length).toBeGreaterThan(0);
  });

  /**
   * The MCP server and the skill, at the paths the
   * extension goes looking for them.
   *
   * Read back through the vendor module rather than
   * checked against the build's own constants,
   * because a build that put them somewhere else
   * would still be internally consistent — and the
   * failure would only appear the first time
   * somebody asked for a new project.
   */
  it('ships the control plane a new project gets', () => {
    const vendor = shippedVendor(root);

    expect(vendor.version()).toMatch(/^\S+$/);
    expect(vendor.bundle().server.length).toBeGreaterThan(1_000_000);
    expect(vendor.skill().map((file) => file.path)).toContain('SKILL.md');
  });

  /**
   * The bundle loading at all, away from
   * everything that built it.
   *
   * An installed extension has no repository
   * around it and no dependency tree beside it,
   * and core reaches for one while its modules are
   * still evaluating. Reading the built file
   * cannot show that; only requiring it from
   * somewhere with nothing else in it can, and
   * what it costs to get wrong is an extension
   * that does not activate.
   */
  it('loads from a directory with nothing else in it', () => {
    const bare = scratchDir();
    cpSync(outdir, join(bare, 'dist'), { recursive: true });

    const loader = join(bare, 'load.cjs');
    writeFileSync(
      loader,
      [
        // `vscode` is created by the extension host,
        // so standing in for it is the one thing
        // this has to do before requiring anything.
        "const Module = require('node:module');",
        'const load = Module._load;',
        'Module._load = function (request, parent, isMain) {',
        "  if (request === 'vscode') return {};",
        '  return load.call(this, request, parent, isMain);',
        '};',
        `const extension = require('./dist/${HOST_BUNDLE}');`,
        'console.log(typeof extension.activate);',
      ].join('\n'),
      'utf8',
    );

    const stdout = execFileSync(process.execPath, [loader], {
      cwd: bare,
      encoding: 'utf8',
    });

    expect(stdout.trim()).toBe('function');
  });
});

/**
 * The other half of the same question, which no
 * amount of listing files can answer: does the
 * code that reads those templates still find them
 * after bundling?
 *
 * The host bundle is CommonJS, because that is
 * what the extension host requires, and
 * `import.meta` does not exist there. Without the
 * build's `define` mapping it onto `__dirname`,
 * esbuild emits an empty object, the read resolves
 * to `undefined/app`, and the whole thing fails at
 * run time from a packaged VSIX with every test
 * short of a real install passing.
 *
 * This builds a probe with the host's own options,
 * so a failure names the mechanism rather than a
 * command. The same question asked of the real
 * bundle, through the command a person actually
 * runs, is in the project-creation spec.
 */
describe('the scaffold templates, read back', () => {
  let read: string[];

  beforeAll(async () => {
    const outdir = scratchDir();
    await buildExtension(outdir);

    const probe = join(scratchDir(), 'probe.ts');
    writeFileSync(
      probe,
      [
        "import { scaffoldFiles } from '@mboss/core';",
        "const paths = scaffoldFiles({ name: 'probe' }).map((f) => f.path);",
        'console.log(JSON.stringify(paths));',
      ].join('\n'),
      'utf8',
    );

    await build({
      ...hostOptions(outdir),
      entryPoints: [{ in: probe, out: 'probe' }],
    });

    const stdout = execFileSync(process.execPath, [join(outdir, 'probe.cjs')], {
      encoding: 'utf8',
    });
    read = JSON.parse(stdout) as string[];
  });

  afterAll(() => {
    while (scratch.length > 0) {
      rmSync(scratch.pop() as string, { recursive: true, force: true });
    }
  });

  it('finds the runtime tree', () => {
    expect(
      read.filter((path) => path.startsWith('src/app/')).length,
    ).toBeGreaterThan(0);
  });

  it('finds the registry seed', () => {
    expect(read).toContain('src/workflows/index.ts');
  });
});

/**
 * The one asset this build takes on trust.
 *
 * The server's bundle is bytes from another
 * repository, and the line beside it is what a
 * project ends up stamped with. The extension then
 * compares that line for exact equality to decide
 * whether somebody's vendored copy is out of date —
 * so a line naming the wrong repository is a
 * "refresh your project?" offered over no drift at
 * all, with the writes that answer implies.
 *
 * Which repository built it is the one thing about
 * those bytes this build can check, and it is a
 * sentence at build time instead of a modal in
 * somebody's editor.
 */
describe('a control plane stamped by another repository', () => {
  /** A stand-in for the checkout the assets are
   *  copied out of. */
  function vendored(stamp: string): string {
    const from = scratchDir();
    const mcp = join(from, 'mboss-mcp-server', 'dist');
    const skill = join(from, 'mboss-skills', 'skills', 'mboss');

    mkdirSync(mcp, { recursive: true });
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(mcp, 'server.js'), 'console.log(1);\n', 'utf8');
    writeFileSync(join(mcp, 'VERSION'), `${stamp}\n`, 'utf8');
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: mboss\n---\n', 'utf8');

    return from;
  }

  it('is refused, and the stamp is quoted back', () => {
    expect(() =>
      copyVendoredAssets(scratchDir(), vendored('vscode-v0.0.1+abc1234')),
    ).toThrow('vscode-v0.0.1+abc1234');
  });

  it('leaves a build of the server alone', () => {
    const outdir = scratchDir();

    copyVendoredAssets(outdir, vendored('mcp-server-v0.0.1+abc1234'));

    expect(readFileSync(join(outdir, 'mcp', 'VERSION'), 'utf8')).toBe(
      'mcp-server-v0.0.1+abc1234\n',
    );
  });
});

describe('the entry list', () => {
  /**
   * One entry per surface a frame is pointed at.
   * The Inspector is not one of them: it is the
   * canvas' own right-hand column, drawn from the
   * same message as the graph beside it.
   */
  it('names the surfaces this extension puts in a frame', () => {
    expect([...WEBVIEW_ENTRIES]).toEqual(['canvas', 'sidebar', 'runs', 'see']);
  });

  /** Adding one is a name in that list and a file
   *  beside the others — not a change to how the
   *  build works. */
  it('drives every webview from one place', () => {
    for (const name of WEBVIEW_ENTRIES) {
      expect(fileExists(resolve(REPO_ROOT, 'src', name, 'index.tsx'))).toBe(
        true,
      );
    }
  });
});
