import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { copyVendoredAssets } from '../build.js';
import {
  ASSET_ROOT,
  MCP_ASSET_DIR,
  SKILL_ASSET_DIR,
  BUNDLE_FILE,
  VERSION_FILE,
  type SkillFile,
  type Vendor,
} from '../vendor/assets.js';

/**
 * Standing in for an installed extension.
 *
 * The vendor module answers questions about a
 * directory laid out the way a `.vsix` unpacks, so
 * the specs need one of those. Two shapes are
 * useful and they are not the same thing: a root
 * holding the *real* built assets, for anything
 * asserting about the bytes that actually ship, and
 * a made-up one, for everything that is about paths
 * and would only be slower for carrying eighteen
 * megabytes around.
 */

const scratch: string[] = [];

/** A throwaway directory, removed by `cleanRoots`. */
export function scratchDir(prefix = 'mboss-vendor-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  scratch.push(dir);

  return dir;
}

export function cleanRoots(): void {
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
}

/**
 * An extension root holding the assets the build
 * really produces.
 *
 * Only the asset copy runs, not the whole build:
 * nothing here is a question about the JavaScript,
 * and bundling the host and three webviews to look
 * at a copied file would make every spec that wants
 * real bytes slower for nothing.
 */
export function realExtensionRoot(): string {
  const root = scratchDir();

  copyVendoredAssets(join(root, ASSET_ROOT));

  return root;
}

/** An extension root with made-up assets in it. */
export function fakeExtensionRoot(
  version: string,
  skill: readonly SkillFile[] = FAKE_SKILL,
): string {
  const root = scratchDir();
  const dist = join(root, ASSET_ROOT);

  write(join(dist, MCP_ASSET_DIR, BUNDLE_FILE), 'console.log("hello");\n');
  write(join(dist, MCP_ASSET_DIR, VERSION_FILE), `${version}\n`);

  for (const file of skill) {
    write(join(dist, SKILL_ASSET_DIR, file.path), file.contents);
  }

  return root;
}

/** Enough of a skill to be copied and counted. */
export const FAKE_SKILL: readonly SkillFile[] = [
  { path: 'SKILL.md', contents: '# a skill\n' },
  { path: 'references/tools.md', contents: '# tools\n' },
];

/**
 * A vendor over made-up bytes.
 *
 * The command under test cares that it passed the
 * bundle on and copied the skill, not what was in
 * either — so this keeps the eighteen-megabyte read
 * out of every spec that is really about a file
 * tree.
 */
export function fakeVendor(version = 'test-v0.0.0+abc1234'): Vendor {
  return {
    version: () => version,
    bundle: () => ({ server: 'console.log("hello");\n', version }),
    skill: () => [...FAKE_SKILL],
  };
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}
