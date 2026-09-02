import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { projectPath, type SkillFile } from './assets.js';

/**
 * Putting the skill where an agent will find it.
 *
 * Two destinations, because they answer two
 * different questions. The copy under `.mboss/` is
 * the project's own record of what it was given and
 * travels with the repository; the other is
 * wherever the coding agent in use looks for
 * skills, which is a convention of that agent
 * rather than of this project.
 *
 * Copies, never links. A symlink does not survive
 * a zip, a Windows checkout without developer mode,
 * or a copy of the directory onto another machine —
 * and the failure would be an agent that quietly
 * has no idea how to drive the server sitting next
 * to it.
 */

/**
 * Where the skill goes, project-relative.
 *
 * Core's scaffold already creates both as empty
 * directories, and its note in the bundle slot
 * already tells a reader why they are empty. This
 * fills them.
 *
 * `.claude/` is Claude Code's convention. Every
 * other agent's discovery directory arrives with
 * the agent registry, which is also where the
 * question of whether a copy needs its
 * `allowed-tools` line rewritten belongs — that
 * line uses Claude Code's own tool-name mangling
 * and no other agent reads it.
 */
export const SKILL_DESTINATIONS: readonly string[] = [
  '.mboss/skills/mboss',
  '.claude/skills/mboss',
];

/**
 * Writes the skill into every destination,
 * replacing whatever was there.
 *
 * The destination is cleared first rather than
 * written over, so that a file dropped from the
 * skill in a later release goes rather than sitting
 * there contradicting the ones beside it.
 */
export async function copySkill(
  project: string,
  skill: readonly SkillFile[],
): Promise<void> {
  for (const destination of SKILL_DESTINATIONS) {
    const dir = projectPath(project, destination);

    await rm(dir, { recursive: true, force: true });

    for (const file of skill) {
      const path = join(dir, ...file.path.split('/'));

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.contents, 'utf8');
    }
  }
}

/**
 * Every place the skill lands, paired with which
 * file of the skill belongs there.
 *
 * Both halves are wanted together: the absolute
 * path to read, and the relative one that says what
 * it should have said. The skill carries no version
 * of its own, so comparing the files is how a
 * project is asked whether its copies are current.
 */
export function skillPaths(
  project: string,
  skill: readonly SkillFile[],
): { absolute: string; relative: string }[] {
  return SKILL_DESTINATIONS.flatMap((destination) =>
    skill.map((file) => ({
      absolute: projectPath(project, `${destination}/${file.path}`),
      relative: file.path,
    })),
  );
}
