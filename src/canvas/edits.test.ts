import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WorkflowIRSchema,
  starterNode,
  type LibManifest,
  type NodeBox,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import { CORE_ROOT, readJson } from '../test-support/repo.js';

import {
  editFor,
  waysOutOf,
  type EditContext,
  type EditOutcome,
  type Gesture,
} from './edits.js';
import { paletteLabels } from './words.js';

/**
 * What a canvas gesture means, asked with a document
 * in and a document out.
 *
 * Nothing here opens a panel or writes a file. The
 * rules — a block dropped on a wire splices it, a
 * deleted block is bridged, a first move pins the
 * whole graph — are functions of the document, and
 * are asked as such. That the session gates them on
 * the revision, asks the picker, says the sentences
 * and writes is checked where the session is.
 */

const ir = WorkflowIRSchema.parse(
  readJson(join(CORE_ROOT, 'fixtures', 'ir', 'groom_booking.workflow.json')),
);

/** The code-behind as core's own scan of the `lib`
 *  fixture read it. */
const manifest = readJson<LibManifest>(
  join(CORE_ROOT, 'fixtures', 'golden', 'manifest', 'lib.manifest.json'),
);

/** The boxes the canvas would be drawing: one per
 *  block, somewhere, on the grid. */
const boxes: Record<string, NodeBox> = Object.fromEntries(
  ir.nodes.map((node, index) => [
    node.id,
    { x: 20 * (index + 1), y: 40 * (index + 1), w: 230, h: 60 },
  ]),
);

const labels = paletteLabels();

function context(over: Partial<EditContext> = {}): EditContext {
  return { ir, boxes, manifest, labels, ...over };
}

/** The document an edit came to. Anything else is
 *  the test failing. */
function next(outcome: EditOutcome): WorkflowIR {
  expect(outcome.at).toBe('next');
  if (outcome.at !== 'next') throw new Error(outcome.at);

  return outcome.ir;
}

function nodeIn(document: WorkflowIR, id: string): WorkflowNode {
  const node = document.nodes.find((one) => one.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);

  return node;
}

/** The document with that node's handler taken
 *  off, which is the state a person is in when they
 *  reach for the picker at all. */
function without(handlerOn: string): WorkflowIR {
  return WorkflowIRSchema.parse({
    ...ir,
    nodes: ir.nodes.map((node) =>
      node.id === handlerOn
        ? Object.fromEntries(
            Object.entries(node).filter(([key]) => key !== 'handler'),
          )
        : node,
    ),
  });
}

/** The document with that function behind that
 *  node. */
function deciding(nodeId: string, exported: string): WorkflowIR {
  return {
    ...ir,
    nodes: ir.nodes.map((node) =>
      node.id === nodeId ? { ...node, handler: { export: exported } } : node,
    ),
  };
}

describe('a wire drawn between two blocks', () => {
  const connect = (
    from: Gesture & { type: 'connect' } extends infer G
      ? G extends { from: infer F }
        ? F
        : never
      : never,
  ) =>
    editFor(
      { type: 'connect', from, to: { node: 'book_appointment' } },
      context(),
    );

  it('is written from the block, by the way out that was taken', () => {
    const written = next(connect({ node: 'find_slot', port: 'out' }));

    expect(written.edges).toHaveLength(ir.edges.length + 1);
    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'book_appointment' },
    });
  });

  it('carries the port a branch was left by', () => {
    const written = next(connect({ node: 'slot_open', port: 'no' }));

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'slot_open', port: 'no' },
    });
  });

  it('is nothing when the block it leaves is not there', () => {
    expect(connect({ node: 'no_such_node', port: 'out' })).toEqual({
      at: 'nothing',
    });
  });
});

/**
 * A block has one dot to leave by and may have
 * several ways out, so which way a wire leaves by
 * is a question. These are its answers, as facts
 * about the document; the words are the session's.
 */
describe('the ways out of a block', () => {
  it('is the one port of a block that decides nothing', () => {
    expect(waysOutOf(nodeIn(ir, 'find_slot'))).toEqual([{ port: 'out' }]);
  });

  it('reads a branch by what its cases decide, then the fall-through', () => {
    expect(waysOutOf(nodeIn(ir, 'slot_open'))).toEqual([
      { port: 'yes', decides: 'true' },
      { port: 'no', fallThrough: true },
    ]);
  });

  it('names an approval by its two outcomes', () => {
    expect(
      waysOutOf(starterNode('approval', 'sign_off', 'Sign off')).map(
        (way) => way.port,
      ),
    ).toEqual(['approved', 'rejected']);
  });
});

describe('a block dropped on the canvas', () => {
  const drop = (
    over: Partial<Extract<Gesture, { type: 'addNode' }>> = {},
    with_ = context(),
  ): EditOutcome =>
    editFor(
      { type: 'addNode', kind: 'step', position: { x: 320, y: 480 }, ...over },
      with_,
    );

  it("is written where it was dropped, with the palette's word for a name", () => {
    const added = next(drop()).nodes.at(-1)!;

    expect(added).toMatchObject({
      id: 'step',
      kind: 'step',
      title: labels.step,
      position: { x: 320, y: 480 },
    });
  });

  it('is the block the column shows next', () => {
    expect(drop()).toMatchObject({ at: 'next', select: 'step' });
  });

  it('is wired to nothing when it was dropped on nothing', () => {
    const written = next(drop());

    expect(written.nodes).toHaveLength(ir.nodes.length + 1);
    expect(written.edges.map((edge) => edge.id)).toEqual(
      ir.edges.map((edge) => edge.id),
    );
  });

  /**
   * A block let go of on a wire goes into it. The
   * wire ends at the new block, and a second wire
   * carries on to wherever the first one went — so
   * the run that went through two blocks goes
   * through three, in the same order.
   */
  it('is spliced into the wire it was dropped on', () => {
    const split = ir.edges.find((edge) => edge.id === 'e2')!;
    const written = next(drop({ spliceEdge: 'e2' }));

    expect(written.nodes).toHaveLength(ir.nodes.length + 1);
    expect(written.edges).toHaveLength(ir.edges.length + 1);

    const added = written.nodes.at(-1)!;
    const before = written.edges.find((edge) => edge.id === 'e2')!;
    const after = written.edges.at(-1)!;

    expect(before.from).toEqual(split.from);
    expect(before.to).toEqual({ node: added.id });
    expect(after.from).toEqual({ node: added.id, port: 'out' });
    expect(after.to).toEqual(split.to);
  });

  /**
   * A loop-closing wire cannot be split: what came
   * back round would come back round to a block
   * created a moment ago, which is a document core
   * refuses. So the whole edit is nothing, block
   * included, rather than half-written. A wire that
   * is not there is the same answer, because the
   * panel is a frame running scripts and may be
   * naming a graph that has moved on.
   */
  it('is nothing when the wire could not be split', () => {
    expect(drop({ spliceEdge: 'e8' })).toEqual({ at: 'nothing' });
    expect(drop({ spliceEdge: 'e_nope' })).toEqual({ at: 'nothing' });
  });

  it('is written with the wire that reached it, in one edit', () => {
    const written = next(
      drop({ connectFrom: { node: 'find_slot', port: 'out' } }),
    );
    const added = written.nodes.at(-1)!;

    expect(written.nodes).toHaveLength(ir.nodes.length + 1);
    expect(written.edges).toHaveLength(ir.edges.length + 1);
    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'find_slot', port: 'out' },
      to: { node: added.id },
    });
  });

  it('pins every other block to the box it was drawn with', () => {
    const written = next(drop());

    for (const node of ir.nodes) {
      expect(nodeIn(written, node.id).position).toEqual({
        x: boxes[node.id]!.x,
        y: boxes[node.id]!.y,
      });
    }
  });

  /** Somebody has arranged this graph and an agent
   *  has added a block to it since. Core parks the
   *  unplaced one; pinning it here would be a second
   *  answer to the same question. */
  it('leaves a half-placed document to core', () => {
    const halfPlaced = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'find_slot' ? node : { ...node, position: { x: 0, y: 0 } },
      ),
    };

    const written = next(drop({}, context({ ir: halfPlaced })));

    expect(nodeIn(written, 'find_slot').position).toBeUndefined();
  });
});

describe('a block moved by hand', () => {
  it('writes every position the move carries, and pins the rest', () => {
    const written = next(
      editFor(
        { type: 'move', positions: { find_slot: { x: 140, y: 260 } } },
        context(),
      ),
    );

    expect(nodeIn(written, 'find_slot').position).toEqual({ x: 140, y: 260 });
    expect(nodeIn(written, 'parse_request').position).toEqual({
      x: boxes['parse_request']!.x,
      y: boxes['parse_request']!.y,
    });
  });
});

describe('arranging the graph', () => {
  it('lets go of every position', () => {
    const placed = next(editFor({ type: 'move', positions: {} }, context()));

    const written = next(editFor({ type: 'arrange' }, context({ ir: placed })));

    expect(written.nodes.map((node) => node.position)).toEqual(
      written.nodes.map(() => undefined),
    );
  });

  /** A graph nobody has placed is already the one
   *  the engine lays out, so there is nothing there
   *  to let go of — and writing it anyway would
   *  raise the revision over a document that says
   *  exactly what it said before. */
  it('is nothing when no block has been placed', () => {
    expect(editFor({ type: 'arrange' }, context())).toEqual({ at: 'nothing' });
  });
});

/**
 * Deleting, which the document does and the canvas
 * does not: what was selected, and the wires the
 * graph library hands over along with it.
 */
describe('deleting', () => {
  const cut = (nodeIds: string[], edgeIds: string[]): EditOutcome =>
    editFor({ type: 'delete', nodeIds, edgeIds }, context());

  it('bridges the gap a deleted block leaves', () => {
    const after = next(cut(['record_booking'], ['e10', 'e11']));

    expect(after.nodes.map((node) => node.id)).not.toContain('record_booking');
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'book_appointment', port: 'out' },
        to: { node: 'send_confirmation' },
      }),
    );
  });

  it('takes a wired block and its wires in one edit', () => {
    const after = next(cut(['find_slot'], ['e2', 'e3', 'e8']));

    expect(after.nodes.map((node) => node.id)).not.toContain('find_slot');
    expect(after.edges.map((edge) => edge.id)).toEqual([
      'e1',
      'e4',
      'e5',
      'e6',
      'e7',
      'e9',
      'e10',
      'e11',
    ]);
  });

  it('takes a whole selection in one edit', () => {
    const after = next(cut(['twilio_chat', 'await_reply'], ['e5', 'e6', 'e7']));

    expect(after.nodes.map((node) => node.id)).toEqual(
      ir.nodes
        .map((node) => node.id)
        .filter((id) => id !== 'twilio_chat' && id !== 'await_reply'),
    );
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'slot_open', port: 'no' },
        to: { node: 'reply_decision' },
      }),
    );
  });

  it('is nothing for a block the document does not have', () => {
    expect(cut(['no_such_node'], [])).toEqual({ at: 'nothing' });
  });

  it('cuts only the wire it was told to', () => {
    expect(next(cut([], ['e9'])).edges.map((edge) => edge.id)).toEqual(
      ir.edges.filter((edge) => edge.id !== 'e9').map((edge) => edge.id),
    );
  });
});

describe('an edit from the Inspector column', () => {
  const edit = (node: unknown): EditOutcome =>
    editFor({ type: 'edit', node }, context());

  it('replaces the node it names and leaves the rest alone', () => {
    const written = next(
      edit({ ...nodeIn(ir, 'find_slot'), title: 'Find an open slot' }),
    );

    expect(nodeIn(written, 'find_slot').title).toBe('Find an open slot');
    expect(written.nodes).toHaveLength(ir.nodes.length);
    expect(written.edges).toEqual(ir.edges);
  });

  /** The column shows fields for shapes that are
   *  not yet complete, and the document keeps what
   *  it had until one of them is. */
  it('refuses a node the catalog would not accept', () => {
    expect(
      edit({ id: 'find_slot', kind: 'step', title: 'x', config: null }),
    ).toEqual({ at: 'refused', because: 'unparseable-node' });
  });

  it('is nothing for a node the document does not have', () => {
    expect(edit({ ...nodeIn(ir, 'find_slot'), id: 'ghost' })).toEqual({
      at: 'nothing',
    });
  });
});

/**
 * Putting a function from the project's code-behind
 * behind a block. One rule decides whether it may
 * sit there, and it is asked here on the way in: the
 * picker that offered the row and the node that took
 * the drop are both a frame running scripts.
 */
describe('assigning a function to a block', () => {
  const assign = (
    nodeId: string,
    exported: string | null,
    with_ = context(),
  ): EditOutcome =>
    editFor({ type: 'assign', nodeId, export: exported }, with_);

  it('writes one that fits a block that decides nothing', () => {
    const written = next(
      assign('find_slot', 'findSlot', context({ ir: without('find_slot') })),
    );
    const node = nodeIn(written, 'find_slot');

    expect(node.handler).toEqual({ export: 'findSlot' });
    expect(node.kind).toBe('step');
    expect(node.config).toEqual({});
  });

  it('writes one that fits, and seeds the branch’s cases from it', () => {
    const node = nodeIn(next(assign('slot_open', 'tryAgain')), 'slot_open');

    expect(node.handler).toEqual({ export: 'tryAgain' });
    expect(node.kind === 'branch' && node.config.cases).toEqual([
      expect.objectContaining({
        port: 'yes',
        when: { path: '', op: 'eq', value: true },
      }),
      expect.objectContaining({
        port: 'no',
        when: { path: '', op: 'eq', value: false },
      }),
    ]);
  });

  it('refuses one that does not fit, and says why', () => {
    expect(assign('slot_open', 'parseRequest')).toMatchObject({
      at: 'refused',
      because: 'misfit',
      reason: { kind: 'not-a-decision' },
      export: 'parseRequest',
      title: 'Open at requested time?',
    });
  });

  /** Somebody naming a function they have not
   *  written yet, which is what the scaffolder
   *  writes the stub for. */
  it('writes a name the code-behind has never heard of', () => {
    const node = nodeIn(next(assign('slot_open', 'decideLater')), 'slot_open');

    expect(node.handler).toEqual({ export: 'decideLater' });
    expect(
      node.kind === 'branch' && node.config.cases.map((one) => one.when.value),
    ).toEqual([true, false]);
  });

  /** The transcript is where what happened to the
   *  document is read, and the row names the kind
   *  as well as the title because two titles can
   *  read alike. */
  it('says which block took the function', () => {
    expect(assign('slot_open', 'tryAgain')).toMatchObject({
      at: 'next',
      assigned: {
        nodeId: 'slot_open',
        kind: 'branch',
        title: 'Open at requested time?',
        export: 'tryAgain',
      },
    });
  });

  it('clears the handler and leaves a branch’s cases alone', () => {
    const decided = deciding('slot_open', 'tryAgain');
    const node = nodeIn(
      next(assign('slot_open', null, context({ ir: decided }))),
      'slot_open',
    );

    expect(node).not.toHaveProperty('handler');
    expect(node.kind === 'branch' && node.config).toEqual(
      nodeIn(decided, 'slot_open').config,
    );
  });

  it('is nothing for a block the document does not have', () => {
    expect(assign('no_such_node', 'findSlot')).toEqual({ at: 'nothing' });
  });
});

/**
 * The module is pure on purpose: it is what lets
 * every rule above be asked without a panel, a
 * picker or a fake editor. This is what keeps it
 * that way once somebody reaches for `api.info`
 * from inside it.
 */
describe('the module stays pure', () => {
  const source = readFileSync(join(import.meta.dirname, 'edits.ts'), 'utf8');

  it('value-imports only the rules and the wiring', () => {
    const imported = [
      ...source.matchAll(/^import (?!type )[^;]*?from '([^']+)';/gms),
    ].map((match) => match[1]);

    expect(imported.sort()).toEqual(['../core/rules.js', './wiring.js']);
  });

  it('names neither the editor nor its words', () => {
    expect(source).not.toMatch(
      /from 'vscode'|messages\.js|core\/index\.js|vscodeApi\.js|from 'node:/,
    );
  });
});
