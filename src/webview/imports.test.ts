import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, sourceFiles } from '../test-support/repo.js';

/**
 * What one bundle may reach into another
 * directory for.
 *
 * The run page draws the same blocks the canvas
 * draws, so it imports from `canvas/` — and a
 * webview bundle is whatever its entry's import
 * graph drags in. Left unwritten, "the run page
 * borrows a couple of components" becomes "the run
 * page carries the editor", and the first anybody
 * knows about it is a panel that takes a second to
 * open.
 *
 * So the borrowing is a list. Adding to it is a
 * decision somebody makes here rather than a side
 * effect of an import somebody wrote.
 */

/**
 * What the See bundle may take from the canvas.
 *
 * The run graph draws the canvas's own blocks and
 * wires. What a run recorded about a block is the
 * Inspector's card, drawn in the Inspector, so
 * nothing about it is on this list.
 */
const SEE_MAY_IMPORT = new Set([
  '../canvas/RunNode.js',
  '../canvas/Wire.js',
  '../canvas/graph.js',
  '../canvas/Node.js',
]);

/**
 * What the Inspector bundle may take from the
 * canvas.
 *
 * A block reads the same in the Inspector as on
 * the board, so the pane asks the board's own
 * rules what a run did to it, which functions fit
 * it, and which glyph it wears. The editor itself
 * stays out: the pane is opened beside every
 * canvas, and carrying the board would make it as
 * slow to open as one.
 */
const INSPECTOR_MAY_IMPORT = new Set([
  '../canvas/graph.js',
  '../canvas/libFunction.js',
  '../canvas/icons.js',
]);

/**
 * The Inspector's host modules, which run in the
 * extension rather than in the pane: they read the
 * open canvases, the edits a canvas makes and the
 * words it resolves, and none of that is bundled.
 */
const INSPECTOR_HOST = new Set([
  'view.ts',
  'subject.ts',
  'focus.ts',
  'host.ts',
  'surface.ts',
]);

const CANVAS_IMPORT = /from\s+'(\.\.\/canvas\/[^']+)'/g;

/** The six directories that each belong to one view
 *  and to nothing else. */
const VIEWS = ['canvas', 'sidebar', 'runs', 'see', 'inspector', 'gallery'];

const IMPORT = /from\s+'([^']+)'/g;

describe('what the run page may reach into the canvas for', () => {
  it('imports only what it is allowed to', () => {
    const reached = sourceFiles()
      .filter((path) => path.includes(join('src', 'see')))
      .flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(CANVAS_IMPORT)].map(
          (found) => found[1] ?? '',
        ),
      );

    expect(reached).not.toHaveLength(0);
    expect(
      [...new Set(reached)].filter((one) => !SEE_MAY_IMPORT.has(one)),
    ).toEqual([]);
  });

  /**
   * And every name on the list is a file, so a
   * rename cannot leave the fence pointing at
   * nothing — and a name added for something not
   * written yet fails here rather than sitting in
   * the list as a permission nobody granted.
   */
  it('names files that are there', () => {
    for (const specifier of SEE_MAY_IMPORT) {
      expect(specifierThere(specifier)).toBe(true);
    }
  });
});

describe('what the Inspector bundle may reach into the canvas for', () => {
  it('imports only what it is allowed to', () => {
    const pane = sourceFiles().filter(
      (path) =>
        path.includes(join('src', 'inspector')) &&
        !/\.test\.tsx?$/.test(path) &&
        !INSPECTOR_HOST.has(basename(path)),
    );

    expect(pane).not.toHaveLength(0);

    const reached = pane.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(CANVAS_IMPORT)].map(
        (found) => found[1] ?? '',
      ),
    );

    expect(reached).not.toHaveLength(0);
    expect(
      [...new Set(reached)].filter((one) => !INSPECTOR_MAY_IMPORT.has(one)),
    ).toEqual([]);
  });

  it('names files that are there', () => {
    for (const specifier of INSPECTOR_MAY_IMPORT) {
      expect(specifierThere(specifier)).toBe(true);
    }
  });
});

/**
 * The components every view draws are shared exactly
 * as far as they depend on nothing.
 *
 * One of them reaching into a view is what turns a
 * shared layer into that view's layer: the other
 * five bundles start carrying its graph, its
 * fixtures and its words, and the next person to
 * change that view breaks a panel they never opened.
 */
describe('what a shared component may import', () => {
  it('reaches into no view', () => {
    const shared = sourceFiles().filter((path) =>
      path.includes(join('src', 'webview', 'signal')),
    );

    expect(shared).not.toEqual([]);

    const reached = shared.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(IMPORT)].map((found) => ({
        path,
        specifier: found[1] ?? '',
      })),
    );

    expect(reached).not.toEqual([]);
    expect(
      reached
        .filter((one) =>
          VIEWS.some((view) => one.specifier.includes(`/${view}/`)),
        )
        .map((one) => one.specifier),
    ).toEqual([]);
  });
});

/** Whether a `../<dir>/<file>.js` specifier names a
 *  source file under `src/`. */
function specifierThere(specifier: string): boolean {
  const path = join(
    REPO_ROOT,
    'src',
    specifier.replace(/^\.\.\//, '').replace(/\.js$/, ''),
  );

  return [`${path}.ts`, `${path}.tsx`].some((one) => fileThere(one));
}

function fileThere(path: string): boolean {
  try {
    readFileSync(path);

    return true;
  } catch {
    return false;
  }
}
