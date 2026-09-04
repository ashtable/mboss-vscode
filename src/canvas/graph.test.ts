import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NODE_PALETTE,
  WorkflowIRSchema,
  nodeSize,
  type NodeBox,
  type NodeKind,
} from '../core/rules.js';
import type { LiveOutcome, LiveRun, StepState } from '../runs/watch.js';

import {
  toReactFlow,
  type CanvasNode,
  type Drawing,
  type EdgeState,
  type NodeState,
} from './graph.js';

/**
 * The canvas draws exactly what core laid out,
 * in the state the document and the person put it
 * in.
 *
 * Both halves of the first matter. The positions
 * have to be the ones layout computed, and the
 * boxes have to be the sizes it computed them
 * *for* — a canvas that picks its own node size
 * paints a graph whose spacing was calculated for
 * different boxes, and the error is invisible
 * until two nodes overlap.
 *
 * The second half is what the whole picture is
 * coloured by, so it is worked out here rather
 * than in a component: whether a block is the one
 * being looked at, and whether it is a block at
 * all or something an agent is still asking for.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../mboss-core/fixtures/${name}`, import.meta.url),
  );

  return JSON.parse(readFileSync(path, 'utf8'));
}

const ir = WorkflowIRSchema.parse(fixture('ir/groom_booking.workflow.json'));
const boxes = fixture('golden/layout/groom_booking.layout.json') as Record<
  string,
  NodeBox
>;

const labels = Object.fromEntries(
  NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
) as Record<NodeKind, string>;

/** The words the host resolves, with nothing
 *  proposed and nothing selected unless a test
 *  says so. */
function drawing(over: Partial<Drawing> = {}): Drawing {
  return { labels, unassigned: 'unassigned', ...over };
}

/**
 * A run of this workflow, as the watcher reports
 * one.
 *
 * The steps are given in the order the ledger holds
 * them, which is the order they ran in — the last
 * of them is the one the frontier is worked out
 * from.
 */
function run(
  steps: readonly (readonly [string, StepState])[],
  outcome: LiveOutcome = 'running',
): LiveRun {
  return {
    workflowId: 'wf_1',
    workflow: ir.name,
    status: outcome === 'running' ? 'PENDING' : 'SUCCESS',
    steps: steps.map(([nodeId, state]) => ({ name: nodeId, nodeId, state })),
    recovered: false,
    outcome,
  };
}

/** The whole path a completed run of this workflow
 *  leaves behind, taking the branch that goes for
 *  the chat. */
const WHOLE_RUN = [
  ['parse_request', 'done'],
  ['find_slot', 'done'],
  ['twilio_chat', 'done'],
  ['await_reply', 'done'],
  ['book_appointment', 'done'],
  ['record_booking', 'done'],
  ['send_confirmation', 'done'],
] as const;

function statesOf(nodes: CanvasNode[]): Record<string, NodeState> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.data.state]));
}

function wireStates(over: Partial<Drawing>): Record<string, EdgeState> {
  const { edges } = toReactFlow(ir, boxes, drawing(over));

  return Object.fromEntries(
    edges.map((edge) => [edge.id, edge.data?.state ?? 'idle']),
  );
}

describe('toReactFlow', () => {
  it('puts every node where the blessed layout put it', () => {
    const { nodes } = toReactFlow(ir, boxes, drawing());

    expect(nodes).toHaveLength(ir.nodes.length);

    for (const node of nodes) {
      expect(node.position).toEqual({
        x: boxes[node.id]?.x,
        y: boxes[node.id]?.y,
      });
    }
  });

  it('draws each node at the size its kind is laid out at', () => {
    const { nodes } = toReactFlow(ir, boxes, drawing());

    for (const node of nodes) {
      const kind = ir.nodes.find((one) => one.id === node.id)?.kind;
      expect(kind).toBeDefined();

      expect({ width: node.width, height: node.height }).toEqual(
        nodeSize(kind!),
      );
      expect({ width: node.width, height: node.height }).toEqual({
        width: boxes[node.id]?.w,
        height: boxes[node.id]?.h,
      });
    }
  });

  it('carries every wire the document draws', () => {
    const { edges } = toReactFlow(ir, boxes, drawing());

    expect(edges).toHaveLength(ir.edges.length);

    for (const edge of ir.edges) {
      const drawn = edges.find((one) => one.id === edge.id);

      expect(drawn?.source).toBe(edge.from.node);
      expect(drawn?.target).toBe(edge.to.node);
    }
  });

  it('leaves a node with one way out no port to choose from', () => {
    const { nodes, edges } = toReactFlow(ir, boxes, drawing());

    const step = nodes.find((node) => node.id === 'parse_request');
    expect(step?.data.ports).toEqual(['out']);

    expect(edges.find((edge) => edge.id === 'e2')?.sourceHandle).toBe('out');
  });

  it('gives a branch one handle per case and one for the fall-through', () => {
    const { nodes, edges } = toReactFlow(ir, boxes, drawing());

    const branch = nodes.find((node) => node.id === 'reply_decision');
    expect(branch?.data.ports).toEqual(['new_time', 'book_it', 'stop']);

    expect(edges.find((edge) => edge.id === 'e9')?.sourceHandle).toBe(
      'book_it',
    );
  });

  it('marks the loop-closing edge so it can be drawn against the flow', () => {
    const { edges } = toReactFlow(ir, boxes, drawing());

    expect(edges.find((edge) => edge.id === 'e8')?.data?.back).toBe(true);
    expect(edges.find((edge) => edge.id === 'e7')?.data?.back).toBe(false);
  });

  it('reports a node the layout has no box for rather than stacking it at the origin', () => {
    const incomplete = Object.fromEntries(
      Object.entries(boxes).filter(([id]) => id !== 'booking_requested'),
    );

    expect(() => toReactFlow(ir, incomplete, drawing())).toThrow(
      /booking_requested/,
    );
  });
});

/**
 * A port name is worth reading only where there
 * was a choice of ports.
 *
 * Every other wire leaves by `out`, and a canvas
 * that labelled those too would be a graph of
 * eleven edges wearing the same word.
 */
describe('the port a wire leaves by', () => {
  it('is named on a wire out of a branch', () => {
    const { edges } = toReactFlow(ir, boxes, drawing());

    expect(edges.find((edge) => edge.id === 'e9')?.data?.port).toBe('book_it');
    expect(edges.find((edge) => edge.id === 'e4')?.data?.port).toBe('yes');
  });

  it('is left off a wire out of a node with one way out', () => {
    const { edges } = toReactFlow(ir, boxes, drawing());

    expect(edges.find((edge) => edge.id === 'e2')?.data?.port).toBeUndefined();
  });
});

describe('the state a node is drawn in', () => {
  it('is dormant for a block nobody is looking at', () => {
    const { nodes } = toReactFlow(ir, boxes, drawing());

    expect(nodes.map((node) => node.data.state)).toEqual(
      ir.nodes.map(() => 'dormant'),
    );
  });

  it('is selected for the one the Inspector is showing', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({ selected: 'find_slot' }),
    );

    const found = nodes.find((node) => node.id === 'find_slot');

    expect(found?.data.state).toBe('selected');
    expect(found?.selected).toBe(true);

    expect(nodes.find((node) => node.id === 'parse_request')?.data.state).toBe(
      'dormant',
    );
  });

  it('is proposed for a block only an agent has asked for', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({ proposed: ['await_reply'] }),
    );

    expect(nodes.find((node) => node.id === 'await_reply')?.data.state).toBe(
      'proposed',
    );
    expect(nodes.find((node) => node.id === 'find_slot')?.data.state).toBe(
      'dormant',
    );
  });
});

/**
 * Where a run has got to, which is two questions
 * the ledger answers differently.
 *
 * A block it holds a step for is drawn in that
 * step's state, and that is a reading. Where the
 * run is *now* is not written down anywhere — a
 * step is recorded when it completes and never when
 * it starts — so it is derived from the shape of
 * the graph, and everything below is about that
 * derivation being honest rather than optimistic.
 */
describe('the state a run puts a block in', () => {
  it('takes the state of the step the ledger holds for it', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({
        run: run(
          [
            ['parse_request', 'done'],
            ['find_slot', 'failed'],
          ],
          'failed',
        ),
      }),
    );

    expect(statesOf(nodes)).toMatchObject({
      parse_request: 'done',
      find_slot: 'failed',
      booking_requested: 'dormant',
    });
  });

  /**
   * A branch deciding on predicates is decided in
   * the generated code and writes no row at all, so
   * a frontier that stopped at one would say the run
   * is sitting at a block that never runs.
   */
  it('lights what is past the last step, through a branch that records none', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({
        run: run([
          ['parse_request', 'done'],
          ['find_slot', 'done'],
        ]),
      }),
    );

    expect(statesOf(nodes)).toMatchObject({
      find_slot: 'done',
      slot_open: 'dormant',
      book_appointment: 'running',
      twilio_chat: 'running',
      record_booking: 'dormant',
    });
  });

  /** Written against a run that stopped in the
   *  middle, because a run that reached the end of
   *  the graph would have nothing ahead of it to get
   *  wrong. */
  it('leaves a run that has ended no frontier at all', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({
        run: run(
          [
            ['parse_request', 'done'],
            ['find_slot', 'done'],
            ['twilio_chat', 'done'],
            ['await_reply', 'done'],
            ['book_appointment', 'failed'],
          ],
          'failed',
        ),
      }),
    );

    expect(nodes.filter((node) => node.data.state === 'running')).toEqual([]);
    expect(statesOf(nodes)).toMatchObject({
      book_appointment: 'failed',
      record_booking: 'dormant',
    });
  });

  it('draws every block a run went through as done', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({ run: run(WHOLE_RUN, 'done') }),
    );

    expect(statesOf(nodes)).toMatchObject({
      send_confirmation: 'done',
      await_reply: 'done',
      slot_open: 'dormant',
    });
  });

  /** A parked run is at the block it parked on.
   *  Lighting what comes next would say it had got
   *  past something it is waiting on a person for. */
  it('leaves a run parked on a person no frontier either', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({
        run: run(
          [
            ['parse_request', 'done'],
            ['find_slot', 'done'],
            ['twilio_chat', 'done'],
            ['await_reply', 'waiting'],
          ],
          'waiting',
        ),
      }),
    );

    expect(nodes.filter((node) => node.data.state === 'running')).toEqual([]);
    expect(statesOf(nodes)['await_reply']).toBe('waiting');
  });

  it('shows the block a person clicked as the one they clicked', () => {
    const { nodes } = toReactFlow(
      ir,
      boxes,
      drawing({
        run: run([['parse_request', 'done']]),
        selected: 'parse_request',
      }),
    );

    expect(statesOf(nodes)['parse_request']).toBe('selected');
  });
});

/**
 * A wire is drawn in what happened at the block it
 * feeds, so a wire whose two ends the ledger says
 * nothing about stays structure — including the two
 * either side of a branch that recorded nothing,
 * because which way that one went is not written
 * down.
 */
describe('the state a wire is drawn in', () => {
  it('is idle while no run is being watched', () => {
    const { edges } = toReactFlow(ir, boxes, drawing());

    expect(edges.map((edge) => edge.data?.state)).toEqual(
      ir.edges.map(() => 'idle'),
    );
  });

  it('is active along every wire the run is travelling now', () => {
    expect(
      wireStates({
        run: run([
          ['parse_request', 'done'],
          ['find_slot', 'done'],
        ]),
      }),
    ).toMatchObject({
      e2: 'done',
      e3: 'active',
      e4: 'active',
      e5: 'active',
      e10: 'idle',
    });
  });

  it('is done along the wires a finished run went down', () => {
    expect(wireStates({ run: run(WHOLE_RUN, 'done') })).toMatchObject({
      e2: 'done',
      e10: 'done',
      e11: 'done',
      e3: 'idle',
    });
  });

  it('carries the tone of the block it feeds', () => {
    expect(
      wireStates({
        run: run(
          [
            ['parse_request', 'done'],
            ['find_slot', 'done'],
            ['twilio_chat', 'done'],
            ['await_reply', 'waiting'],
          ],
          'waiting',
        ),
      })['e6'],
    ).toBe('waiting');

    expect(
      wireStates({
        run: run(
          [
            ['parse_request', 'done'],
            ['find_slot', 'failed'],
          ],
          'failed',
        ),
      })['e2'],
    ).toBe('failed');
  });
});

/**
 * The one line under a title, in the three shapes
 * it comes in. It is the only thing on a block
 * that is not the block's name, so what it says
 * has to be the thing worth knowing: which code
 * runs here, or that none does yet, or that this
 * kind runs none at all.
 */
describe('the line under a title', () => {
  const lineOf = (id: string): string | undefined =>
    toReactFlow(ir, boxes, drawing()).nodes.find((node) => node.id === id)?.data
      .line;

  it('names the function a block runs', () => {
    expect(lineOf('parse_request')).toBe('ƒ parseRequest');
  });

  it('says a block that runs code of its own has none yet', () => {
    expect(lineOf('slot_open')).toBe('Branch · unassigned');
  });

  it('says only what a block that runs no code of its own is', () => {
    expect(lineOf('booking_requested')).toBe('Trigger');
    expect(lineOf('await_reply')).toBe('Wait');
    expect(lineOf('send_confirmation')).toBe('Email');
  });
});
