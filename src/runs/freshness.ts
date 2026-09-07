import { join } from 'node:path';

/**
 * Whether the running image is behind the
 * workspace.
 *
 * The app runs out of an image, not out of the
 * folder somebody is editing. A run replayed
 * against an image built before their last change
 * runs the old code and answers as if nothing had
 * been fixed, so whoever offers that replay says
 * first whether the two still agree.
 *
 * The walk is injected because the answer is a
 * comparison of numbers while the numbers are
 * facts about somebody's disk: the specs hand it a
 * tree rather than writing one.
 *
 * There is a window this cannot close. The build
 * copies the sources, finishes, and only then does
 * compose make the container, so a file saved in
 * those seconds is older than a build that does
 * not contain it and reads as fresh. Hashing every
 * input at every build would close it, and would
 * cost that on every build for a window seconds
 * wide. It is named here and left open.
 */

/** One file the image was built from, and when
 *  somebody last changed it. */
export type Changed = {
  path: string;
  changedAt: number;
};

/**
 * Everything under one path, with the moment each
 * of them last changed.
 *
 * A path the project does not have is no entries
 * rather than a failure: a project with no
 * `prisma/` is a project, and a missing input is
 * one fewer thing that can be stale.
 */
export type Walker = (dir: string) => readonly Changed[];

/**
 * What decides which code is running.
 *
 * The first three are what the person writes and
 * the build copies; the middle four are what pins
 * the dependencies and how the image is made.
 * `.env` is not in the image at all — the build
 * context leaves it out — but compose hands it to
 * the container, so a change to it changes what
 * the app is running just as an edit to `lib/`
 * does.
 *
 * Asked about one entry at a time, never as one
 * walk of the project: `node_modules` is larger
 * than everything here put together and is an
 * output of `package-lock.json` rather than an
 * input of its own.
 */
export const IMAGE_INPUTS: readonly string[] = [
  'lib',
  'src',
  'prisma',
  'package.json',
  'package-lock.json',
  'prisma.config.ts',
  'Dockerfile',
  'docker-entrypoint.sh',
  'docker-compose.yml',
  '.env',
];

export type Freshness =
  { at: 'fresh' } | { at: 'stale'; newest: Changed } | { at: 'unknown' };

/**
 * The newest input against the build, or nothing
 * to compare it with.
 *
 * A file stamped at the build's own moment is the
 * one that went into it, so only a later one is a
 * change the image has not seen.
 */
export function freshness(
  walk: Walker,
  project: string,
  builtAt: number | undefined,
): Freshness {
  // Nothing is walked when nothing can be decided:
  // the answer is the same whatever the files say.
  if (builtAt === undefined) return { at: 'unknown' };

  let newest: Changed | undefined;

  for (const input of IMAGE_INPUTS) {
    for (const file of walk(join(project, input))) {
      if (file.changedAt <= builtAt) continue;

      if (newest === undefined || file.changedAt > newest.changedAt) {
        newest = file;
      }
    }
  }

  return newest === undefined ? { at: 'fresh' } : { at: 'stale', newest };
}
