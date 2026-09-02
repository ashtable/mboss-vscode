import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Problem } from '../problem.js';
import { makeProject } from '../test-support/project.js';

import { scanProject } from './manifest.js';

/**
 * What a change under `lib/` costs, and what it
 * produces.
 *
 * Two things are being held to here. The scan is
 * asked on every change and never guarded by a
 * check of our own — the library's cache is keyed
 * on the contents of the files it read, which is a
 * better answer than any "has anything changed"
 * test written out here could be, and a second one
 * beside it is a second thing to be wrong.
 *
 * And what the scan could not make sense of reaches
 * PROBLEMS. Code mid-edit is the ordinary state, so
 * the scan carries type errors rather than throwing
 * — which means nothing anywhere would say the
 * palette just got smaller and the typed-wiring
 * check just got weaker, unless this does.
 */

/**
 * Problems the scan reported about the code-behind
 * itself.
 *
 * A scan follows what the handlers import, so a
 * project whose dependencies are not installed
 * reports on the runtime a handler reached into as
 * well — true, and the same thing the project's own
 * `tsc` would say, but not a statement about the
 * handlers.
 */
function aboutHandlers(project: string, problems: Problem[]): Problem[] {
  return problems.filter((problem) =>
    problem.file.startsWith(join(project, 'lib')),
  );
}

describe('a project whose handlers compile', () => {
  it('offers what they export', async () => {
    const project = await makeProject({ lib: 'lib' });

    const scan = scanProject(project);

    expect(aboutHandlers(project, scan.problems)).toEqual([]);
    expect(scan.manifest?.functions.map((one) => one.export)).toContain(
      'findSlot',
    );
  });

  it('answers from the cache when nothing changed', async () => {
    const project = await makeProject({ lib: 'lib' });

    const first = scanProject(project);
    const second = scanProject(project);

    expect(second.manifest?.scannedAt).toBe(first.manifest?.scannedAt);
  });

  it('reads them again when one of them changes', async () => {
    const project = await makeProject({ lib: 'lib' });

    const before = scanProject(project);

    writeFileSync(
      join(project, 'lib', 'extra.ts'),
      'export function extra(name: string): string {\n' +
        '  return name;\n' +
        '}\n',
      'utf8',
    );

    const after = scanProject(project);

    expect(after.manifest?.scannedAt).not.toBe(before.manifest?.scannedAt);
    expect(after.manifest?.functions.map((one) => one.export)).toContain(
      'extra',
    );
  });
});

describe('a project whose handlers do not compile', () => {
  it('says so, against the file that does not', async () => {
    const project = await makeProject({ lib: 'lib-broken' });

    const found = aboutHandlers(project, scanProject(project).problems);

    expect(found).toEqual([
      {
        file: join(project, 'lib', 'broken.ts'),
        severity: 'error',
        message: expect.any(String),
      },
    ]);
  });

  it('still offers whatever did scan', async () => {
    const project = await makeProject({ lib: 'lib-broken' });

    expect(scanProject(project).manifest).toBeDefined();
  });
});

describe('a project with no code-behind yet', () => {
  /**
   * How every project starts, and how a fresh clone
   * of one arrives: git does not track an empty
   * directory. Nothing to scan is not a problem to
   * report.
   */
  it('has nothing to offer and nothing to complain about', async () => {
    const project = await makeProject();

    const scan = scanProject(project);

    expect(scan.problems).toEqual([]);
    expect(scan.manifest?.functions).toEqual([]);
  });
});
