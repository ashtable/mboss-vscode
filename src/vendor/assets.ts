import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What this extension ships to put inside a
 * project.
 *
 * Two artifacts, and they are one thing: the MCP
 * server a coding agent drives, and the skill that
 * teaches it how. Both are built in another
 * repository and copied here at build time, because
 * an installed extension cannot build anything —
 * the server's own `dist/` is not even tracked, so
 * nesting its source gives you a build context and
 * not a bundle.
 *
 * Each comes from its own released pin, and the
 * two are held to one tool surface by a spec here.
 * The server's repository nests the skill as well
 * and reaching through it would have been one pin
 * fewer — but that gitlink is behind the skill's
 * own released branch, so it ships an older skill.
 * Two pins that are checked beat one that is
 * silently stale.
 *
 * They are also stamped differently, and that is
 * not an inconsistency. The bundle is eighteen
 * megabytes with a version line built beside it for
 * exactly this comparison. The skill is four small
 * text files with no stamp anywhere, so the files
 * themselves are what gets compared.
 */

/** Where a built extension keeps everything. */
export const ASSET_ROOT = 'dist';

/** And the two directories inside it that a project
 *  gets a copy of. */
export const MCP_ASSET_DIR = 'mcp';
export const SKILL_ASSET_DIR = 'skill';

export const BUNDLE_FILE = 'server.js';
export const VERSION_FILE = 'VERSION';

/**
 * What makes the assets, named in the failure that
 * wants them.
 *
 * A build that quietly shipped less than it should
 * packages, installs, activates, and then fails at
 * the one moment it was asked to make a project.
 * One sentence naming this is the difference
 * between that and a five-minute fix.
 */
export const MCP_BUILD_COMMAND = 'npm run build:mcp';

/** The bundle and the line that stamps it. */
export type VendoredBundle = {
  server: string;

  version: string;
};

/** One file of the skill, by its path within the
 *  skill's own tree. */
export type SkillFile = {
  /** Relative, posix separators, as it lands. */
  path: string;

  contents: string;
};

/**
 * The assets, read on demand.
 *
 * `bundle()` is a function rather than a field
 * because the server is around eighteen megabytes
 * of text: it is read at the moment it is written
 * into a project and not held afterwards. The
 * version is a single line, so asking whether a
 * project is up to date costs nothing.
 */
export type Vendor = {
  /** The one line the extension and a project
   *  compare. */
  version(): string;

  bundle(): VendoredBundle;

  skill(): readonly SkillFile[];
};

/** The assets an extension installed at `root`
 *  carries. */
export function shippedVendor(root: string): Vendor {
  const mcp = join(root, ASSET_ROOT, MCP_ASSET_DIR);
  const skill = join(root, ASSET_ROOT, SKILL_ASSET_DIR);

  const version = (): string => read(join(mcp, VERSION_FILE)).trim();

  return {
    version,
    bundle: () => ({
      server: read(join(mcp, BUNDLE_FILE)),
      version: version(),
    }),
    skill: () => walk(skill, ''),
  };
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `this extension ships no ${path} — run \`${MCP_BUILD_COMMAND}\``,
      { cause },
    );
  }
}

/**
 * Every file under the skill's asset directory, in
 * a fixed order.
 *
 * Walked rather than listed by name. A reference
 * file added in the skill's own repository should
 * travel by being there, not by somebody
 * remembering to add it here — and this repository
 * would be the last place to find out that it had
 * not.
 */
function walk(dir: string, prefix: string): SkillFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch (cause) {
    throw new Error(
      `this extension ships no ${dir} — run \`${MCP_BUILD_COMMAND}\``,
      { cause },
    );
  }

  return entries.flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory()
      ? walk(path, `${prefix}${name}/`)
      : [{ path: `${prefix}${name}`, contents: readFileSync(path, 'utf8') }];
  });
}

/**
 * A path inside a project, from the posix-spelled
 * relative ones the assets carry.
 */
export function projectPath(project: string, relative: string): string {
  return join(project, ...relative.split('/'));
}
