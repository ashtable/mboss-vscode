import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BUNDLE_FILE, VERSION_FILE, type Vendor } from './assets.js';
import { copySkill } from './skillCopy.js';

export { shippedVendor, type Vendor } from './assets.js';
export { vendorState } from './staleness.js';

/**
 * The control plane a project carries, and keeping
 * it current.
 *
 * One module answers one question — *what does this
 * project have vendored, and is it what this
 * extension ships* — so that the command handlers
 * above it only ever decide when to ask and what to
 * say about the answer.
 *
 * Creating a project and refreshing one arrive here
 * differently on purpose. Creating goes through
 * core's scaffold with the bundle passed in, so the
 * file set stays a pure function of its inputs and
 * core keeps owning what a project is made of.
 * Refreshing cannot: the project already exists,
 * and only the two vendored things may change.
 */

/** Where a project keeps the bundle. */
const MCP_DIR = ['.mboss', 'mcp'];

/**
 * The note core leaves in an empty bundle slot.
 *
 * It exists to explain that the server is missing.
 * Once it is not, the note is wrong, and somebody
 * reading it goes looking for a file already
 * sitting beside it.
 */
const PLACEHOLDER = 'README.md';

/**
 * Replaces both vendored artifacts with the ones
 * this extension ships.
 *
 * The skill goes to both destinations and the
 * bundle is stamped, so afterwards the project
 * reads as current.
 */
export async function refreshVendor(
  project: string,
  vendor: Vendor,
): Promise<void> {
  const dir = join(project, ...MCP_DIR);
  const bundle = vendor.bundle();

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, BUNDLE_FILE), bundle.server, 'utf8');
  await writeFile(join(dir, VERSION_FILE), `${bundle.version}\n`, 'utf8');
  await rm(join(dir, PLACEHOLDER), { force: true });

  await copySkill(project, vendor.skill());
}

/**
 * The skill alone — the other half of creating a
 * project, since core's scaffold writes the bundle
 * itself when it is handed one.
 */
export async function vendorSkill(
  project: string,
  vendor: Vendor,
): Promise<void> {
  await copySkill(project, vendor.skill());
}
