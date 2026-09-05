import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applySpec, mbossDirOf } from '@mboss/core';
import { describe, expect, it } from 'vitest';

import {
  STALE_LOCK_MS,
  compileWorkflows,
  currentWorkflow,
  liveProposals,
} from '../core/index.js';
import { WorkflowIRSchema } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { APPROVAL_PROMPT, approveProposal } from './approve.js';

/**
 * Approving, which is three things in a fixed
 * order: the proposal becomes the document, the
 * project's code is regenerated from it, and the
 * agent is told so it can get on with the handlers.
 *
 * The order is the whole of it. The agent is told
 * last because a message that arrived before the
 * code did would send it to read files that are not
 * there yet. And the first two run one after the
 * other rather than one inside the other: both take
 * the project's write lock, which is not reentrant,
 * so nesting them would wait out the stale-lock
 * timeout on every approval and then work anyway —
 * a bug that looks like slowness.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

const GENERATED = join('src', 'workflows', 'groom_booking.workflow.ts');

/** A project with the canonical workflow in it,
 *  its handlers, and a proposal outstanding. */
async function projectWithProposal(): Promise<{
  project: string;
  id: string;
}> {
  const project = await makeProject({ lib: 'lib' });
  writeWorkflow(project, 'groom_booking');

  const proposal = await propose(project, {
    name: 'groom_booking',
    spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
    baseRevision: groom.revision,
  });

  return { project, id: proposal.id };
}

/** What the document says now. */
async function revisionOf(project: string): Promise<number | undefined> {
  return (await currentWorkflow(project, 'groom_booking'))?.revision;
}

describe('approving a proposal', () => {
  it('writes it, regenerates, and only then tells the agent', async () => {
    const { project, id } = await projectWithProposal();
    const trail: string[] = [];

    const outcome = await approveProposal(
      {
        project,
        // Said as it happens rather than on the way
        // back, so a caller writing about the
        // approval writes before the compile and
        // the agent's turn, not after both.
        applied: () => void trail.push('applied'),
        regenerate: async () => {
          // By now the document is the proposal's,
          // one revision on, and nothing has been
          // said to the agent.
          trail.push(`document v${await revisionOf(project)}`);
          await compileWorkflows(project);
        },
        notify: async (text) => {
          trail.push(
            existsSync(join(project, GENERATED))
              ? `told the agent: ${text}`
              : 'told the agent before there was code',
          );
        },
      },
      id,
    );

    expect(outcome).toEqual({
      at: 'applied',
      workflow: 'groom_booking',
      revision: groom.revision + 1,
    });
    expect(trail).toEqual([
      'applied',
      `document v${groom.revision + 1}`,
      `told the agent: ${APPROVAL_PROMPT}`,
    ]);
  });

  it('leaves the proposal marked as applied', async () => {
    const { project, id } = await projectWithProposal();

    await approveProposal(
      {
        project,
        applied: () => {},
        regenerate: async () => {},
        notify: async () => {},
      },
      id,
    );

    expect(await liveProposals(project)).toEqual([]);
    expect(
      readFileSync(
        join(project, '.mboss', 'proposals', `${id}.proposal.json`),
        'utf8',
      ),
    ).toContain('"status": "applied"');
  });

  /**
   * The two writes both take `.mboss/.lock`, and the
   * lock is not reentrant. Nested, this would block
   * until the lock went stale and then carry on, so
   * the thing to measure is the clock: an approval
   * that regenerates for real finishes in a fraction
   * of what waiting out that timeout would cost.
   */
  it('takes the write lock twice in a row, not twice at once', async () => {
    const { project, id } = await projectWithProposal();
    const started = Date.now();

    await approveProposal(
      {
        project,
        applied: () => {},
        regenerate: async () => void (await compileWorkflows(project)),
        notify: async () => {},
      },
      id,
    );

    expect(Date.now() - started).toBeLessThan(STALE_LOCK_MS);
    expect(existsSync(join(project, GENERATED))).toBe(true);
  });
});

describe('approving a proposal the graph has moved past', () => {
  it('does none of the three things', async () => {
    const { project, id } = await projectWithProposal();
    const said: string[] = [];

    // Somebody else's edit lands first — from the
    // canvas or from another agent, either way not
    // through this proposal, which is left
    // outstanding and now behind.
    await applySpec(mbossDirOf(project), {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Meanwhile' }),
      baseRevision: groom.revision,
    });

    const outcome = await approveProposal(
      {
        project,
        applied: () => void said.push('applied'),
        regenerate: async () => void said.push('regenerated'),
        notify: async (text) => void said.push(text),
      },
      id,
    );

    expect(outcome).toEqual({ at: 'stale' });
    expect(said).toEqual([]);
    expect(await revisionOf(project)).toBe(groom.revision + 1);
  });
});

describe('approving something that is not there any more', () => {
  it('says why, rather than pretending it worked', async () => {
    const { project } = await projectWithProposal();

    const outcome = await approveProposal(
      {
        project,
        applied: () => {},
        regenerate: async () => {},
        notify: async () => {},
      },
      'prop_1_00000000',
    );

    expect(outcome.at).toBe('refused');
  });
});

/**
 * The one string this extension says to an agent on
 * its own initiative. It is asserted again in
 * `mboss-e2e-tests`, which cannot import this
 * constant, so the substring below is the contract
 * between the two repositories — plain ASCII, so
 * that nothing it passes through can change it.
 */
describe('the follow-up the agent gets', () => {
  it('tells it the proposal landed and what to do next', () => {
    expect(APPROVAL_PROMPT).toContain('Scaffold the handlers.');
    expect(APPROVAL_PROMPT).toBe(
      'Approved — proposal applied. Scaffold the handlers.',
    );
  });
});
