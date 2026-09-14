import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** What the See bundle may take from the canvas. */
const SEE_MAY_IMPORT = new Set([
  '../canvas/RunNode.js',
  '../canvas/Wire.js',
  '../canvas/graph.js',
  '../canvas/Node.js',
  // What a run recorded about one block reads the
  // same wherever somebody is standing when they
  // ask, so the rail draws the Inspector's card
  // rather than a second one of its own.
  '../canvas/inspector/EvidenceCard.js',
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
      const path = join(
        REPO_ROOT,
        'src',
        specifier.replace(/^\.\.\//, '').replace(/\.js$/, ''),
      );

      expect([`${path}.ts`, `${path}.tsx`].some((one) => fileThere(one))).toBe(
        true,
      );
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

function fileThere(path: string): boolean {
  try {
    readFileSync(path);

    return true;
  } catch {
    return false;
  }
}
