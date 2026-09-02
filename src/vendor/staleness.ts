import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VERSION_FILE, type SkillFile, type Vendor } from './assets.js';
import { skillPaths } from './skillCopy.js';

/**
 * Whether what a project has vendored is what this
 * extension ships.
 *
 * Two artifacts, asked about two ways, because they
 * are shaped differently and each has an exact
 * answer available cheaply.
 *
 * The bundle is eighteen megabytes and is built
 * with a version line beside it for exactly this
 * comparison, so the line is what gets compared.
 * The skill is four small text files that nothing
 * stamps — its own repository mints no version and
 * this phase does not own that repository — so the
 * files themselves get compared. Reading eleven
 * kilobytes to answer exactly beats reading a
 * hand-maintained integer that answers
 * approximately: `SKILL.md`'s
 * `metadata.mboss-skill-version` has read the same
 * value since the skill was written and does not
 * move when the prose does, which is precisely the
 * change a refresh exists to deliver.
 *
 * A skill somebody edited in place therefore reads
 * as out of date, and that is the intended answer.
 * The vendored copy is a distribution artifact, not
 * a document the project's owner authored — an
 * agent driving a hand-broken copy misbehaves with
 * no other signal anywhere that it might.
 */

export type VendorState =
  /** The project has what this extension ships. */
  | 'current'
  /** It has an older copy, or half of one. */
  | 'outdated'
  /** It has none: nothing ever vendored into it. */
  | 'absent';

/** Where a project keeps the bundle's stamp. */
const VERSION_PATH = ['.mboss', 'mcp', VERSION_FILE];

/**
 * Two version lines, compared as the token they
 * carry.
 *
 * The file always ends in a newline and a string
 * held in memory may or may not, so trimming is not
 * leniency — it is comparing the same thing.
 */
export function isVendorStale(
  vendored: string | undefined,
  shipped: string,
): boolean {
  return vendored?.trim() !== shipped.trim();
}

export function vendorState(project: string, vendor: Vendor): VendorState {
  const stamp = vendoredVersion(project);

  if (stamp === undefined) return 'absent';
  if (isVendorStale(stamp, vendor.version())) return 'outdated';

  return skillMatches(project, vendor.skill()) ? 'current' : 'outdated';
}

/** The line a project is stamped with, if it is. */
export function vendoredVersion(project: string): string | undefined {
  return readOrNothing(join(project, ...VERSION_PATH));
}

/**
 * Whether every copy of the skill in the project is
 * the one this extension ships.
 *
 * A file missing is the case the bundle's stamp
 * cannot report at all: a project scaffolded before
 * an extension was installed has the server's slot
 * explained by a note and the skill's slots simply
 * empty.
 */
function skillMatches(project: string, skill: readonly SkillFile[]): boolean {
  const wanted = new Map(
    skill.map((file) => [file.path, file.contents] as const),
  );

  return skillPaths(project, skill).every(
    (path) => readOrNothing(path.absolute) === wanted.get(path.relative),
  );
}

function readOrNothing(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
