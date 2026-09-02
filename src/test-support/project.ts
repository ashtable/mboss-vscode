import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scaffoldProject } from '@mboss/core';

import { CORE_ROOT } from './repo.js';

/**
 * A throwaway mBoss project on disk, for the specs
 * that need a real one.
 *
 * The watcher, the compiler and the code-behind
 * scan all read and write files, and a fake
 * filesystem underneath them would turn every
 * assertion into a statement about the fake. So
 * these build the real thing: core's own scaffold,
 * core's own fixtures, in a directory nobody else
 * is looking at.
 */

/** Where core keeps the fixtures its own specs
 *  use. */
const FIXTURES = join(CORE_ROOT, 'fixtures');

/**
 * Scaffolds a project in a fresh temporary
 * directory and returns its path.
 *
 * `lib` names one of core's code-behind fixture
 * directories — `lib` for handlers that compile,
 * `lib-broken` for one that does not — and is left
 * out for a project whose handlers do not exist
 * yet, which is how every project starts.
 */
export async function makeProject(opts?: {
  lib?: 'lib' | 'lib-broken';
}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-vscode-'));

  await scaffoldProject(dir, { name: 'fixture_app' });

  if (opts?.lib !== undefined) copyLib(dir, opts.lib);

  return dir;
}

/**
 * Copies one of core's code-behind fixtures into a
 * project's `lib/`.
 *
 * Test files are left behind: they import vitest,
 * which a scanned project has no business
 * carrying, and the scan skips them anyway.
 */
export function copyLib(project: string, fixture: 'lib' | 'lib-broken'): void {
  const from = join(FIXTURES, fixture);
  const to = join(project, 'lib');

  mkdirSync(to, { recursive: true });

  for (const name of readdirSync(from).sort()) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;

    copyFileSync(join(from, name), join(to, name));
  }
}

/**
 * Puts one of core's workflow fixtures into a
 * project, the way an apply or a hand edit would.
 *
 * Written straight to the file rather than through
 * `applySpec`, because these specs are about what
 * happens *after* a document changes and the
 * writer is beside the point.
 */
export function writeWorkflow(project: string, name: string): string {
  const path = join(project, '.mboss', 'workflows', `${name}.workflow.json`);

  mkdirSync(join(project, '.mboss', 'workflows'), { recursive: true });
  writeFileSync(path, readWorkflowFixture(name), 'utf8');

  return path;
}

/** One of core's workflow fixtures, as text. */
export function readWorkflowFixture(name: string): string {
  return readFileSync(join(FIXTURES, 'ir', `${name}.workflow.json`), 'utf8');
}
