import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { isVendorStale, vendorState } from './staleness.js';
import { refreshVendor } from './index.js';
import { makeProject } from '../test-support/project.js';
import { cleanRoots, fakeVendor } from '../test-support/vendor.js';

/**
 * Whether what a project has vendored is what this
 * extension ships.
 *
 * Asked two ways, because the two artifacts are
 * shaped differently. The bundle is eighteen
 * megabytes with a version line built beside it for
 * exactly this, so the line is compared. The skill
 * is four small text files that nothing stamps
 * anywhere, so the files are.
 */

afterAll(cleanRoots);

const VERSION = join('.mboss', 'mcp', 'VERSION');

describe('comparing one version line to another', () => {
  it('is fresh when they are the same', () => {
    expect(
      isVendorStale('mcp-server-v0.0.1+abc1234', 'mcp-server-v0.0.1+abc1234'),
    ).toBe(false);
  });

  /**
   * The file always ends in a newline and a string
   * compared against it may or may not, so the two
   * are compared as the token they carry.
   */
  it('tolerates the trailing newline the file carries', () => {
    expect(isVendorStale('v1+abc\n', 'v1+abc')).toBe(false);
    expect(isVendorStale('v1+abc', 'v1+abc\n')).toBe(false);
  });

  it('is stale when they differ', () => {
    expect(isVendorStale('v1+abc', 'v1+def')).toBe(true);
  });

  it('is stale when the project has no version at all', () => {
    expect(isVendorStale(undefined, 'v1+abc')).toBe(true);
  });
});

describe('what a project has vendored', () => {
  const vendor = fakeVendor('v1+abc');

  /** A project with the current pair in place. */
  const current = async (): Promise<string> => {
    const project = await makeProject();

    await refreshVendor(project, vendor);

    return project;
  };

  it('is absent in a project nothing vendored into', async () => {
    expect(vendorState(await makeProject(), vendor)).toBe('absent');
  });

  it('is current straight after a refresh', async () => {
    expect(vendorState(await current(), vendor)).toBe('current');
  });

  it('is outdated when the version line is an older one', async () => {
    const project = await current();

    writeFileSync(join(project, VERSION), 'v0+000\n', 'utf8');

    expect(vendorState(project, vendor)).toBe('outdated');
  });

  /**
   * The skill has no stamp of its own, so a copy
   * that is not there — or that says something else
   * — is invisible to the bundle's version line. A
   * project scaffolded before the skill was ever
   * vendored would otherwise read as up to date.
   */
  it('is outdated when the canonical skill copy is gone', async () => {
    const project = await current();

    rmSync(join(project, '.mboss', 'skills', 'mboss'), { recursive: true });

    expect(vendorState(project, vendor)).toBe('outdated');
  });

  it("is outdated when the agent's copy is gone", async () => {
    const project = await current();

    rmSync(join(project, '.claude', 'skills', 'mboss', 'SKILL.md'));

    expect(vendorState(project, vendor)).toBe('outdated');
  });

  /**
   * A copy somebody rewrote in place counts as out
   * of date, and that is the intended answer. The
   * vendored skill is a distribution artifact rather
   * than a document the project's owner wrote, and
   * an agent driving a hand-broken one misbehaves
   * with nothing anywhere to say why.
   */
  it('is outdated when a skill file says something else', async () => {
    const project = await current();

    writeFileSync(
      join(project, '.mboss', 'skills', 'mboss', 'SKILL.md'),
      '# not the skill that shipped\n',
      'utf8',
    );

    expect(vendorState(project, vendor)).toBe('outdated');
  });

  /**
   * Core writes a note into the bundle slot
   * explaining that the bundle is missing. Once it
   * is not, the note is wrong, and a person reading
   * it would go looking for a file that is already
   * beside it.
   */
  it('clears the placeholder the empty slot carried', async () => {
    const project = await makeProject();
    const note = join(project, '.mboss', 'mcp', 'README.md');
    expect(existsSync(note)).toBe(true);

    await refreshVendor(project, vendor);

    expect(existsSync(note)).toBe(false);
  });

  it('refreshes a project whose control directory is bare', async () => {
    const project = await makeProject();
    rmSync(join(project, '.mboss', 'mcp'), { recursive: true });
    mkdirSync(join(project, '.mboss', 'mcp'), { recursive: true });

    await refreshVendor(project, vendor);

    expect(vendorState(project, vendor)).toBe('current');
  });
});
