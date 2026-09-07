import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  IMAGE_INPUTS,
  changedFiles,
  freshness,
  type Walker,
} from './freshness.js';

/**
 * Whether the running image is behind the
 * workspace.
 *
 * The comparison is numbers, so the walk is a
 * fake: a project's real mtimes would make these
 * specs a story about how fast a temporary
 * directory can be written.
 */

/** The moment the image was built. Everything here
 *  is said relative to it. */
const BUILT = Date.parse('2026-01-01T12:00:00Z');

const MINUTE = 60 * 1000;

const PROJECT = '/workspace';

/** Where one of the inputs sits in that project. */
const at = (path: string): string => join(PROJECT, path);

type Tree = Record<string, readonly { path: string; changedAt: number }[]>;

/** A walk that answers from a hand-built tree and
 *  remembers every directory it was asked about. */
function walker(tree: Tree): { walk: Walker; walked: string[] } {
  const walked: string[] = [];

  return {
    walked,
    walk: (dir) => {
      walked.push(dir);

      return tree[dir] ?? [];
    },
  };
}

describe('whether the running image is behind the workspace', () => {
  /**
   * The newest one, because that is the change the
   * person is most likely to be looking for, and
   * one path says the same thing as a list without
   * being a list.
   */
  it('says stale and names the newest changed path', () => {
    const { walk } = walker({
      [at('lib')]: [
        { path: at('lib/refund.ts'), changedAt: BUILT + MINUTE },
        { path: at('lib/booking.ts'), changedAt: BUILT + 2 * MINUTE },
      ],
      [at('package.json')]: [
        { path: at('package.json'), changedAt: BUILT - MINUTE },
      ],
    });

    expect(freshness(walk, PROJECT, BUILT)).toEqual({
      at: 'stale',
      newest: { path: at('lib/booking.ts'), changedAt: BUILT + 2 * MINUTE },
    });
  });

  it('says fresh when nothing is newer than the build', () => {
    const { walk } = walker({
      [at('lib')]: [{ path: at('lib/refund.ts'), changedAt: BUILT - MINUTE }],
      [at('Dockerfile')]: [
        { path: at('Dockerfile'), changedAt: BUILT - 2 * MINUTE },
      ],
    });

    expect(freshness(walk, PROJECT, BUILT)).toEqual({ at: 'fresh' });
  });

  /**
   * The image was built out of that file, so a file
   * stamped at the same moment is the one that went
   * into it.
   */
  it('says fresh when a path is exactly as old as the build', () => {
    const { walk } = walker({
      [at('lib')]: [{ path: at('lib/refund.ts'), changedAt: BUILT }],
    });

    expect(freshness(walk, PROJECT, BUILT)).toEqual({ at: 'fresh' });
  });

  /** Nothing to compare against is not the same as
   *  nothing having changed. */
  it('says unknown when nothing knows when it was built', () => {
    const { walk } = walker({
      [at('lib')]: [{ path: at('lib/refund.ts'), changedAt: BUILT + MINUTE }],
    });

    expect(freshness(walk, PROJECT, undefined)).toEqual({ at: 'unknown' });
  });

  /**
   * It is not in the image — the build context
   * leaves it out — but compose hands it to the
   * container, so editing it changes what the app
   * is running just as surely as editing the code.
   */
  it('counts .env', () => {
    const { walk } = walker({
      [at('.env')]: [{ path: at('.env'), changedAt: BUILT + MINUTE }],
    });

    expect(freshness(walk, PROJECT, BUILT)).toEqual({
      at: 'stale',
      newest: { path: at('.env'), changedAt: BUILT + MINUTE },
    });
  });

  /**
   * The inputs are asked about one at a time rather
   * than the project being walked whole, so the
   * largest directory in it is never opened.
   */
  it('does not walk node_modules', () => {
    const { walk, walked } = walker({
      [at('lib')]: [{ path: at('lib/refund.ts'), changedAt: BUILT - MINUTE }],
    });

    freshness(walk, PROJECT, BUILT);

    expect(walked).toEqual(IMAGE_INPUTS.map((input) => at(input)));
  });
});

/**
 * The other half: where the numbers above come
 * from.
 *
 * A real directory, because the whole point of this
 * one is that it reads a disk — a fake here would
 * make the case a statement about the fake.
 */
describe('walking one of the inputs', () => {
  /** A moment far enough back that nothing about
   *  how fast a temporary directory is written can
   *  reach it. */
  const STAMPED = Date.parse('2026-01-01T12:00:00Z');

  it('answers when each file under a directory changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mboss-walk-'));

    mkdirSync(join(dir, 'lib', 'billing'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'refund.ts'), '', 'utf8');
    writeFileSync(join(dir, 'lib', 'billing', 'card.ts'), '', 'utf8');

    for (const path of ['lib/refund.ts', 'lib/billing/card.ts']) {
      utimesSync(join(dir, path), STAMPED / 1000, STAMPED / 1000);
    }

    expect(
      [...changedFiles(join(dir, 'lib'))].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
    ).toEqual([
      { path: join(dir, 'lib', 'billing', 'card.ts'), changedAt: STAMPED },
      { path: join(dir, 'lib', 'refund.ts'), changedAt: STAMPED },
    ]);
  });

  it('answers about a single file as one entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mboss-walk-'));
    const path = join(dir, '.env');

    writeFileSync(path, 'DATABASE_URL=postgres://x\n', 'utf8');
    utimesSync(path, STAMPED / 1000, STAMPED / 1000);

    expect(changedFiles(path)).toEqual([{ path, changedAt: STAMPED }]);
  });

  /** A project with no `prisma/` is a project. */
  it('answers nothing about a path the project has not got', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mboss-walk-'));

    expect(changedFiles(join(dir, 'prisma'))).toEqual([]);
  });
});
