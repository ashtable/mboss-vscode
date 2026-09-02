import { beforeAll, describe, expect, it } from 'vitest';

import { WorkflowIRSchema } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { previewOf } from './model.js';
import { canvasPreview, proposalCard } from './view.js';

/**
 * A proposal against content that has moved on.
 *
 * This is not the conflict an ordinary edit hits.
 * A conflicting edit is retried against what the
 * file now says; a stale proposal cannot be, because
 * nobody has approved *this* edit against *that*
 * content — the agent has to propose again. So the
 * preview keeps drawing, the warning says which
 * situation it is, and the one thing on offer is to
 * go back to the agent.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

const WARNING =
  'The graph changed since this was proposed, so it cannot be applied. ' +
  'Ask the agent to propose it again.';

let project: string;

beforeAll(async () => {
  project = await makeProject();
  writeWorkflow(project, 'groom_booking');
});

/** A proposal that renames one block, so there is
 *  something for the preview to draw as arriving. */
async function proposalFor(
  name: string,
  baseRevision: number | null,
): Promise<Awaited<ReturnType<typeof propose>>> {
  return await propose(project, {
    name,
    spec: specOf({
      ...groom,
      title: `Groom booking, at ${baseRevision}`,
      nodes: groom.nodes.map((node) =>
        node.id === 'find_slot' ? { ...node, title: 'Find a slot' } : node,
      ),
    }),
    baseRevision,
  });
}

describe('a proposal made against the document as it stands', () => {
  it('is not stale', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);

    expect(previewOf(proposal, groom).stale).toBe(false);
  });

  it('offers both the ways forward', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);
    const card = proposalCard(previewOf(proposal, groom));

    expect(card.at).toBe('proposed');
  });
});

describe('a proposal the document has moved past', () => {
  it('is stale', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);

    const moved = { ...groom, revision: groom.revision + 1 };

    expect(previewOf(proposal, moved).stale).toBe(true);
  });

  /**
   * Only Refine, and structurally so: the card has
   * no approve half to disable, which is what keeps
   * a stale proposal from being one styling bug away
   * from applicable.
   */
  it('offers only the way back to the agent', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);
    const card = proposalCard(
      previewOf(proposal, { ...groom, revision: groom.revision + 1 }),
    );

    expect(card.at).toBe('stale');
    if (card.at !== 'stale') return;
    expect(card.warning).toBe(WARNING);
  });

  it('keeps drawing, with the warning where the counts were', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);
    const preview = canvasPreview(
      previewOf(proposal, { ...groom, revision: groom.revision + 1 }),
    );

    expect(preview.warning).toBe(WARNING);
    expect(preview.banner).toBeUndefined();
    expect(preview.proposed.length).toBeGreaterThan(0);
  });
});

/**
 * The two cases where there is no pair of revisions
 * to compare, and which is why the warning names no
 * numbers: a proposal for a workflow somebody has
 * since created, and a proposal for one that has
 * since gone.
 */
describe('a proposal about a workflow that appeared or disappeared', () => {
  it('is stale when it expected no file and there is one', async () => {
    const proposal = await proposalFor('sermon_helper', null);

    expect(previewOf(proposal, groom).stale).toBe(true);
  });

  it('is stale when it expected a file and there is none', async () => {
    const proposal = await proposalFor('groom_booking', groom.revision);

    expect(previewOf(proposal, undefined).stale).toBe(true);
  });

  it('is not stale when it expected no file and there is none', async () => {
    const proposal = await proposalFor('sermon_helper', null);

    expect(previewOf(proposal, undefined).stale).toBe(false);
  });
});
