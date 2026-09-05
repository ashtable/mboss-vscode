import { beforeAll, describe, expect, it } from 'vitest';

import type { DiffSummary } from '../core/index.js';
import { WorkflowIRSchema, type WorkflowIR } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { sidebarWords } from '../sidebar/words.js';

import { previewOf } from './model.js';
import { bannerFor, canvasPreview } from './view.js';

/**
 * What a proposal looks like before anybody has
 * agreed to it.
 *
 * Two things are being checked here and they are
 * different in kind. The sentence around the counts
 * is frozen copy — a person approving an agent's
 * edit reads the same words every time, and the
 * reassurance about deterministic layout is the
 * point of the product, not decoration — so it is
 * asserted whole. The counts inside it are the
 * proposal's own diff, and the rule for rendering
 * them has to cover the removals and changes the
 * frozen example happens not to have.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

const NOTHING: DiffSummary = {
  nodesAdded: 0,
  nodesRemoved: 0,
  nodesChanged: 0,
  edgesAdded: 0,
  edgesRemoved: 0,
};

let project: string;

beforeAll(async () => {
  project = await makeProject();
  writeWorkflow(project, 'groom_booking');
});

describe('the banner', () => {
  /**
   * The mockup's own line, to the character. The
   * counts in it are what a sixteen-node proposal
   * with eighteen wires produces, which is what
   * makes this the example the rule was derived
   * from rather than a second copy of the rule.
   */
  it('says what the design says, for a proposal that only adds', () => {
    expect(bannerFor({ ...NOTHING, nodesAdded: 16, edgesAdded: 18 })).toBe(
      'PREVIEW CHANGES · +16 nodes +18 edges · deterministic layout — ' +
        'the agent sent semantics, never coordinates',
    );
  });

  it('signs removals and changes, grouped by what they are', () => {
    expect(
      bannerFor({
        nodesAdded: 4,
        nodesRemoved: 2,
        nodesChanged: 1,
        edgesAdded: 5,
        edgesRemoved: 3,
      }),
    ).toContain('· +4 −2 ~1 nodes +5 −3 edges ·');
  });

  it('leaves out a term that counted nothing', () => {
    expect(
      bannerFor({ ...NOTHING, nodesRemoved: 2, edgesRemoved: 3 }),
    ).toContain('· −2 nodes −3 edges ·');
  });

  it('leaves out a whole group that counted nothing', () => {
    expect(bannerFor({ ...NOTHING, edgesAdded: 18 })).toContain(
      '· +18 edges ·',
    );
  });

  /**
   * A proposal can be a no-op — an agent re-sending
   * what is already there. The sentence still has to
   * read as a sentence.
   */
  it('says so when a proposal changes nothing', () => {
    expect(bannerFor(NOTHING)).toContain('· no changes ·');
  });
});

/**
 * The two answers to a proposal, in the words the
 * design fixed. Not "apply" and "cancel": the first
 * says the edit is being agreed to as well as
 * written, and the second says the conversation
 * carries on rather than ending.
 */
describe('the words on the buttons', () => {
  it('are the ones the design settled on', () => {
    const strings = sidebarWords();

    expect(strings.approve).toBe('Approve & apply');
    expect(strings.refine).toBe('Refine');
    expect(strings.undo).toBe('Undo');
  });
});

describe('the line above the graph', () => {
  it('names whoever proposed it, and that nothing has been applied', async () => {
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, revisited' }),
      baseRevision: groom.revision,
      proposedBy: 'claude code',
    });

    const preview = canvasPreview(previewOf(proposal, groom));

    expect(preview.headline).toBe(
      'PREVIEW — proposed by claude code · not applied yet',
    );
  });
});

describe('the document a preview draws', () => {
  it('is the proposal’s, not the one on disk', async () => {
    const spec = specOf({
      ...groom,
      title: 'Groom booking, without the confirmation',
      nodes: groom.nodes.filter((node) => node.id !== 'send_confirmation'),
      edges: groom.edges.filter((edge) => edge.id !== 'e11'),
    });

    const proposal = await propose(project, {
      name: 'groom_booking',
      spec,
      baseRevision: groom.revision,
    });

    const model = previewOf(proposal, groom);

    expect(model.candidate.title).toBe(
      'Groom booking, without the confirmation',
    );
    expect(model.candidate.nodes.map((node) => node.id)).not.toContain(
      'send_confirmation',
    );
  });

  /**
   * The caption under the graph keeps naming the
   * revision that exists. A preview is not a
   * revision — the banner over it is what says the
   * content is not applied — and a caption claiming
   * a number nothing has written would be the one
   * thing on screen that is false.
   */
  it('keeps the revision the file is at', async () => {
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, again' }),
      baseRevision: groom.revision,
    });

    expect(previewOf(proposal, groom).candidate.revision).toBe(groom.revision);
  });

  it('starts at the first revision when there is no file yet', async () => {
    const proposal = await propose(project, {
      name: 'sermon_helper',
      spec: specOf(groom),
      baseRevision: null,
    });

    expect(previewOf(proposal, undefined).candidate.revision).toBe(1);
  });
});

/**
 * Where the blocks sit while a proposal is being
 * read.
 *
 * An agent writes semantics and never coordinates,
 * so a spec arrives with no positions in it at all.
 * Drawn as it stands, that spec would re-arrange a
 * canvas somebody laid out by hand the moment an
 * agent touched anything — and would mark every
 * block on it as arriving, because every block
 * would differ from the one on disk. So the
 * preview is drawn in the layout the approved
 * document will have, and a coordinate is not
 * something a block can be said to have changed.
 */
describe('the layout a preview is drawn in', () => {
  /** The same workflow, arranged by hand. */
  const placed: WorkflowIR = {
    ...groom,
    nodes: groom.nodes.map((node, index) => ({
      ...node,
      position: { x: 120, y: index * 132 },
    })),
  };

  const positionsOf = (ir: WorkflowIR) =>
    ir.nodes.map((node) => [node.id, node.position] as const);

  it('is the one the document already has', async () => {
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, retitled' }),
      baseRevision: groom.revision,
    });

    const { candidate } = previewOf(proposal, placed);

    expect(positionsOf(candidate)).toEqual(positionsOf(placed));
  });

  it('draws as arriving only the blocks the proposal touched', async () => {
    const revised = new Set(['find_slot', 'book_appointment']);

    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({
        ...groom,
        nodes: groom.nodes.map((node) =>
          revised.has(node.id) ? { ...node, title: 'Revised' } : node,
        ),
      }),
      baseRevision: groom.revision,
    });

    expect(previewOf(proposal, placed).proposed).toEqual([...revised]);
  });

  it('does not draw a block as arriving for having moved', async () => {
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({
        ...placed,
        nodes: placed.nodes.map((node) =>
          node.id === 'find_slot'
            ? { ...node, position: { x: 640, y: 640 } }
            : node,
        ),
      }),
      baseRevision: groom.revision,
    });

    const model = previewOf(proposal, placed);

    expect(model.proposed).toEqual([]);
    expect(
      model.candidate.nodes.find((node) => node.id === 'find_slot')?.position,
    ).toEqual({ x: 640, y: 640 });
  });
});

describe('the blocks drawn as proposed', () => {
  it('are the ones the proposal adds or changes, and no others', async () => {
    const spec = specOf({
      ...groom,
      nodes: [
        ...groom.nodes
          .filter((node) => node.id !== 'send_confirmation')
          .map((node) =>
            node.id === 'find_slot' ? { ...node, title: 'Find a slot' } : node,
          ),
      ],
      edges: groom.edges.filter((edge) => edge.id !== 'e11'),
    });

    const proposal = await propose(project, {
      name: 'groom_booking',
      spec,
      baseRevision: groom.revision,
    });

    const model = previewOf(proposal, groom);

    expect(model.proposed).toEqual(['find_slot']);
    expect(model.summary.nodesChanged).toBe(1);
    expect(model.summary.nodesRemoved).toBe(1);
    expect(model.summary.edgesRemoved).toBe(1);
  });

  /**
   * A whole workflow arriving at once is the case
   * the design draws, and the list of what is
   * coming has to fit beside a graph rather than
   * become one.
   */
  it('are named, up to a point, and then counted', async () => {
    const proposal = await propose(project, {
      name: 'sermon_helper',
      spec: specOf(groom),
      baseRevision: null,
    });

    const preview = canvasPreview(previewOf(proposal, undefined));

    expect(preview.proposed).toHaveLength(groom.nodes.length);
    expect(preview.named).toEqual(
      groom.nodes.slice(0, 5).map((node) => node.title),
    );
    expect(preview.more).toBe(
      `… ${groom.nodes.length - 5} more proposed nodes`,
    );
  });

  it('counts nothing extra when they all fit', async () => {
    const spec = specOf({
      ...groom,
      nodes: groom.nodes.slice(0, 2),
      edges: groom.edges.slice(0, 1),
    });

    const proposal = await propose(project, {
      name: 'short_one',
      spec,
      baseRevision: null,
    });

    const preview = canvasPreview(previewOf(proposal, undefined));

    expect(preview.named).toHaveLength(2);
    expect(preview.more).toBeUndefined();
  });
});

/**
 * The proposal carries what core found when it was
 * written, and that is what the preview shows — not
 * a fresh run of the rules over the same spec. A
 * person approves the preview they were shown.
 */
describe('what the rules found', () => {
  it('is the proposal’s own record of it', async () => {
    const proposal = await propose(project, {
      name: 'sermon_helper',
      spec: specOf(groom),
      baseRevision: null,
    });

    expect(previewOf(proposal, undefined).diagnostics).toEqual(
      proposal.diagnostics,
    );
  });
});
