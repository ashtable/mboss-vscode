import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildExtension } from './build.js';
import { REPO_ROOT } from './test-support/repo.js';

/**
 * What actually ends up inside the `.vsix`.
 *
 * `.vscodeignore` decides this, and it is the one
 * file in the repository whose mistakes are
 * invisible everywhere else: shipping `src/` is
 * merely wasteful, but excluding an asset the
 * extension copies out at run time produces a
 * package that installs, activates, and then fails
 * at the moment a user asks it to do the one thing
 * it exists for.
 */

const scratch: string[] = [];
let entries: string[];

/** Every path inside the archive. */
function archiveEntries(vsix: string): string[] {
  return execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
}

function has(prefix: string): boolean {
  return entries.some((entry) => entry.startsWith(`extension/${prefix}`));
}

describe('the packaged extension', () => {
  beforeAll(async () => {
    await buildExtension();

    const dir = mkdtempSync(join(tmpdir(), 'mboss-vsix-'));
    scratch.push(dir);
    const vsix = join(dir, 'mboss.vsix');

    execFileSync(
      process.execPath,
      [
        join(REPO_ROOT, 'node_modules', '@vscode', 'vsce', 'vsce'),
        'package',
        // Everything the host needs is bundled, so
        // there is no dependency tree to ship.
        '--no-dependencies',
        '--out',
        vsix,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    entries = archiveEntries(vsix);
  });

  afterAll(() => {
    while (scratch.length > 0) {
      rmSync(scratch.pop() as string, { recursive: true, force: true });
    }
  });

  it('ships the manifest and both string bundles', () => {
    expect(has('package.json')).toBe(true);
    expect(has('package.nls.json')).toBe(true);
    expect(has('l10n/bundle.l10n.json')).toBe(true);
  });

  it('ships the built code', () => {
    expect(has('dist/extension.cjs')).toBe(true);
    expect(has('dist/webview/')).toBe(true);
  });

  it('ships the icon the manifest points at', () => {
    expect(has('media/activity-bar.svg')).toBe(true);
  });

  /**
   * The two faces the webviews are set in, and the
   * terms they are shipped under.
   *
   * Redistributing an OFL face means carrying its
   * licence, and this package is the only copy a
   * user ever receives — so the notice travels
   * with the bytes rather than living in a
   * repository they will never see.
   */
  it('ships the vendored faces and their terms', () => {
    expect(has('dist/webview/fonts/')).toBe(true);
    expect(has('THIRD_PARTY_NOTICES.md')).toBe(true);
    expect(has('media/fonts/albert-sans-OFL.txt')).toBe(true);
    expect(has('media/fonts/spline-sans-mono-OFL.txt')).toBe(true);
  });

  /**
   * These are not source and not build tooling;
   * they are bytes the extension copies into a new
   * project. A source-shaped exclusion pattern
   * that swept them up would leave a package with
   * nothing to copy.
   */
  it('ships the assets it copies into a project', () => {
    expect(has('dist/app/')).toBe(true);
    expect(has('dist/workflows/index.ts')).toBe(true);
    expect(has('dist/mcp/server.js')).toBe(true);
    expect(has('dist/mcp/VERSION')).toBe(true);
    expect(has('dist/skill/SKILL.md')).toBe(true);
    expect(has('dist/skill/references/')).toBe(true);
  });

  /** The two checkouts they were copied out of are
   *  build context, not something a user installs. */
  it('ships no nested source', () => {
    expect(has('mboss-core/')).toBe(false);
    expect(has('mboss-mcp-server/')).toBe(false);
    expect(has('mboss-skills/')).toBe(false);
  });

  /** Core resolves these while it is still loading;
   *  without them the extension does not activate. */
  it('ships the type declarations core resolves', () => {
    expect(has('dist/node_modules/@types/node/')).toBe(true);
  });

  it('ships neither the source nor an install tree', () => {
    expect(has('src/')).toBe(false);
    expect(has('node_modules/')).toBe(false);
  });
});
