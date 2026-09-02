import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { shippedVendor } from './assets.js';
import { SKILL_DESTINATIONS, copySkill } from './skillCopy.js';
import { makeProject } from '../test-support/project.js';
import { cleanRoots, realExtensionRoot } from '../test-support/vendor.js';

/**
 * The skill, put where each agent looks for it.
 *
 * Two copies, because the canonical one under
 * `.mboss/` is the project's own record of what it
 * was given and the other is wherever the coding
 * agent in use discovers skills. Copies rather than
 * links: a symlink is not a thing every checkout of
 * this project on every platform will still have.
 *
 * The whole tree travels, not a chosen part of it.
 * `references/conventions.md` in particular is
 * shipped content that nothing else in the
 * superproject guards, so it is named here.
 */

afterAll(cleanRoots);

const EXPECTED = [
  'SKILL.md',
  'references/conventions.md',
  'references/ir-examples.md',
  'references/tools.md',
];

describe('vendoring the skill into a project', () => {
  const vendor = shippedVendor(realExtensionRoot());

  it('lands in the canonical slot and the agent slot', () => {
    expect(SKILL_DESTINATIONS).toEqual([
      '.mboss/skills/mboss',
      '.claude/skills/mboss',
    ]);
  });

  it('copies every file to both of them, byte for byte', async () => {
    const project = await makeProject();
    const skill = vendor.skill();

    await copySkill(project, skill);

    expect(skill.map((file) => file.path)).toEqual(EXPECTED);
    for (const destination of SKILL_DESTINATIONS) {
      for (const file of skill) {
        const landed = join(project, ...destination.split('/'), file.path);

        expect(readFileSync(landed, 'utf8')).toBe(file.contents);
      }
    }
  });

  it('copies rather than linking', async () => {
    const project = await makeProject();

    await copySkill(project, vendor.skill());

    for (const destination of SKILL_DESTINATIONS) {
      const landed = join(project, ...destination.split('/'), 'SKILL.md');

      expect(lstatSync(landed).isSymbolicLink()).toBe(false);
    }
  });

  /**
   * Refreshing is the ordinary case — the slot has
   * something in it and the something is old.
   */
  it('replaces what was already there', async () => {
    const project = await makeProject();
    await copySkill(project, vendor.skill());

    const stale = join(project, '.mboss', 'skills', 'mboss', 'SKILL.md');
    writeFileSync(stale, 'an older skill\n', 'utf8');
    await copySkill(project, vendor.skill());

    expect(readFileSync(stale, 'utf8')).toBe(vendor.skill()[0]?.contents);
  });
});
