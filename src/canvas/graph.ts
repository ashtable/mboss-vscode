import type { Edge, Node } from '@xyflow/react';

import {
  HANDLER_KINDS,
  nodeSize,
  portsOf,
  type NodeBox,
  type NodeKind,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import type { LiveRun, LiveStep, StepState } from '../runs/watch.js';

/**
 * A workflow document, as the graph library wants
 * it.
 *
 * Nothing here decides anything about the picture.
 * Positions come from the layout, sizes come from
 * the metrics it used, ports come from `portsOf`,
 * and the words come from the host. The canvas'
 * job is to paint what core worked out, and this
 * is the translation — kept apart from the
 * components so that "does the canvas draw what
 * was laid out, in the state it is in" is a
 * question a test can ask without a browser.
 */

/**
 * What is happening to a block, which is the only
 * thing on the canvas colour is spent on.
 *
 * The first three are facts about the document and
 * about what a person is looking at. The rest are
 * facts about a run.
 */
export type NodeState = 'dormant' | 'selected' | 'proposed' | RunState;

/**
 * What a run says about a block: the three states
 * the ledger records, and the one it only implies.
 *
 * Written as the watcher's own three plus one so
 * that a state the ledger gains cannot be missed
 * here.
 *
 * The parked one is `waiting` and stays `waiting`.
 * It means the run stopped on somebody who has not
 * acted yet, which is the only thing a person
 * reading the canvas can do anything about. Whether
 * a run was picked back up after a crash is a
 * separate fact, and it belongs to the run rather
 * than to any one block.
 */
export type RunState = StepState | 'running';

/** What is happening along a wire. Same story: a
 *  wire is structure until a run is going through
 *  it. */
export type EdgeState = 'idle' | 'active' | 'done' | 'waiting' | 'failed';

/**
 * Everything about the picture that is not in the
 * document.
 *
 * The words, because a webview resolves none of
 * its own; the proposal, because it is somebody's
 * draft rather than the file; and the selection,
 * because it is a fact about this one open canvas.
 */
export type Drawing = {
  /** What each kind is called, in the active
   *  locale. */
  labels: Record<NodeKind, string>;

  /** The word after the kind of a block that runs
   *  code nobody has named yet. */
  unassigned: string;

  /** Blocks an agent is asking for, which the file
   *  does not have. */
  proposed?: readonly string[];

  selected?: string;

  /** Whether what is drawn is the document. It is
   *  not while a proposal is showing, and nothing
   *  drawn then may be edited. */
  editable?: boolean;

  /** The run this canvas is about, while somebody is
   *  following one of this workflow. */
  run?: LiveRun;
};

/** What a node component is handed. */
export type CanvasNodeData = {
  /** The document's node, whole. */
  node: WorkflowNode;

  /** The one line under the title, already in the
   *  reader's language. */
  line: string;

  state: NodeState;

  /** The revision a function dropped on this block
   *  is assigned against. Absent while the canvas
   *  is drawing something that is not the document,
   *  which is what takes the drop away rather than
   *  leaving it to be refused. */
  assignAgainst: number | undefined;

  [key: string]: unknown;
};

/** What an edge component is handed. */
export type CanvasEdgeData = {
  /** The port it leaves by, set only where the
   *  source had more than one to leave by. */
  port: string | undefined;

  state: EdgeState;

  /** A loop-closing edge, drawn against the flow. */
  back: boolean;

  [key: string]: unknown;
};

export type CanvasNode = Node<CanvasNodeData, NodeKind>;

export type CanvasEdge = Edge<CanvasEdgeData, 'wire'>;

/** The one target handle every node carries. */
export const TARGET_PORT = 'in';

/**
 * The one source handle every node carries, however
 * many ways out the document gives it.
 *
 * A dot is ten pixels wide and out of sight until a
 * pointer is on the block that owns it, so three of
 * them on a branch are three things nobody can aim
 * at. Every wire therefore leaves by the same dot,
 * and which way out it takes is asked once it has
 * landed. Which way each wire already took is on
 * the wire, in its label, where there is room to
 * read it.
 */
export const SOURCE_PORT = 'out';

/**
 * The identity of one picture: this document, laid
 * out here.
 *
 * The canvas holds its own nodes once a person can
 * drag one, so it has to tell a message that is a
 * different picture from one that is the same
 * picture with something else true about it — a
 * different block selected, a manifest that finished
 * scanning. Those leave this key alone and are
 * patched in; anything that changes what is drawn
 * changes it, and the canvas takes the host's nodes
 * back.
 *
 * The revision leads because that is the number a
 * person can check by eye, but it cannot carry this
 * alone: a proposal is drawn at the revision of the
 * file it is a proposal about.
 */
export function layoutKeyOf(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
): string {
  return `${ir.revision}:${hashOf(
    JSON.stringify([ir.nodes, ir.edges, boxes]),
  )}`;
}

/** A short, stable stand-in for a string, so a key
 *  stays a key rather than a copy of the document. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;

  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

/**
 * Turns a document plus its computed boxes into
 * the nodes and edges the canvas renders.
 *
 * A node with no box is thrown on rather than
 * defaulted to the origin: layout returns a box
 * per node, so a missing one means the boxes and
 * the document are of different versions, and a
 * pile of nodes at 0,0 is a bug report nobody can
 * read.
 */
export function toReactFlow(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
  drawing: Drawing,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const arriving = new Set(drawing.proposed ?? []);
  const ports = new Map(ir.nodes.map((node) => [node.id, portsOf(node)]));
  const run = tonesOf(ir, drawing.run);

  return {
    nodes: ir.nodes.map((node) =>
      toCanvasNode(
        node,
        boxes[node.id],
        stateOf(node.id, arriving, drawing.selected, run.nodes),
        lineOf(node, drawing),
        drawing.editable === true ? ir.revision : undefined,
      ),
    ),
    edges: ir.edges.map((edge) => ({
      id: edge.id,
      type: 'wire',
      source: edge.from.node,
      sourceHandle: SOURCE_PORT,
      target: edge.to.node,
      targetHandle: TARGET_PORT,
      data: {
        // Naming the port on a graph where every
        // node has one way out would be eleven
        // wires wearing the same word.
        port:
          (ports.get(edge.from.node)?.length ?? 0) > 1
            ? edge.from.port
            : undefined,
        state: run.edges.get(edge.id) ?? 'idle',
        back: edge.back,
      },
    })),
  };
}

function toCanvasNode(
  node: WorkflowNode,
  box: NodeBox | undefined,
  state: NodeState,
  line: string,
  assignAgainst: number | undefined,
): CanvasNode {
  if (box === undefined) {
    throw new Error(`the layout has no box for \`${node.id}\``);
  }

  const { width, height } = nodeSize(node.kind);

  return {
    id: node.id,
    type: node.kind,
    position: { x: box.x, y: box.y },
    width,
    height,
    // The library's own flag as well as the state,
    // because selection is its keyboard handling
    // and its z-order too, not only a colour.
    selected: state === 'selected',
    data: { node, line, state, assignAgainst },
  };
}

/**
 * What a block is drawn in when more than one thing
 * is true about it.
 *
 * What the person is doing, then what an agent is
 * asking for, then what the run is doing. A halo
 * answers a click that just happened, and a
 * proposal is not the document at all — a run's
 * colours outlast both, and are the ones to give
 * way.
 */
function stateOf(
  id: string,
  proposed: ReadonlySet<string>,
  selected: string | undefined,
  run: ReadonlyMap<string, RunState>,
): NodeState {
  if (id === selected) return 'selected';
  if (proposed.has(id)) return 'proposed';

  return run.get(id) ?? 'dormant';
}

/**
 * What a run puts on the picture, as two lookups.
 *
 * Worked out in one pass rather than per node
 * because an edge's tone is the tone of the blocks
 * at its ends, and where the run is *now* takes a
 * walk over the graph that neither a node nor an
 * edge could do for itself.
 */
type RunTones = {
  nodes: ReadonlyMap<string, RunState>;
  edges: ReadonlyMap<string, EdgeState>;
};

/** The tone a wire takes from the block it feeds:
 *  what happened there is what happened along it. */
const EDGE_FOR: Record<RunState, EdgeState> = {
  done: 'done',
  failed: 'failed',
  waiting: 'waiting',
  running: 'active',
};

/** Loudest last. A block that failed is the one
 *  worth finding across a graph, and one still
 *  parked has not finished whatever else it
 *  recorded. */
const LOUDNESS: readonly StepState[] = ['done', 'waiting', 'failed'];

function tonesOf(ir: WorkflowIR, run: LiveRun | undefined): RunTones {
  if (run === undefined) return { nodes: new Map(), edges: new Map() };

  const recorded = recordedStates(run.steps);
  const nodes = new Map<string, RunState>(recorded);

  // Only a run that is still going is ahead of what
  // the ledger holds. A parked one is at the block
  // it parked on, one that ended is where it ended,
  // and one the watch let go of is somewhere nobody
  // is being told about any more.
  const ahead =
    run.outcome === 'running'
      ? frontierFrom(ir, run.steps.at(-1)?.nodeId, recorded)
      : { nodes: new Set<string>(), edges: new Set<string>() };

  for (const id of ahead.nodes) nodes.set(id, 'running');

  const edges = new Map<string, EdgeState>();

  for (const edge of ir.edges) {
    if (ahead.edges.has(edge.id)) {
      edges.set(edge.id, 'active');
      continue;
    }

    const from = nodes.get(edge.from.node);
    const to = nodes.get(edge.to.node);

    // A wire whose ends the ledger says nothing
    // about stays structure — including the two
    // either side of a branch that recorded
    // nothing, because which way that one went is
    // not written down anywhere.
    if (from === undefined || to === undefined) continue;

    edges.set(edge.id, EDGE_FOR[to]);
  }

  return { nodes, edges };
}

/**
 * What the ledger says about each block.
 *
 * A block can own several rows — one per round of a
 * loop, one per item of a fan-out, the two halves
 * of a wait — so the loudest of them is the one the
 * block is drawn in.
 */
function recordedStates(
  steps: readonly LiveStep[],
): ReadonlyMap<string, StepState> {
  const states = new Map<string, StepState>();

  for (const step of steps) {
    const held = states.get(step.nodeId);

    if (
      held === undefined ||
      LOUDNESS.indexOf(step.state) > LOUDNESS.indexOf(held)
    ) {
      states.set(step.nodeId, step.state);
    }
  }

  return states;
}

/**
 * Where a run in flight has got to, and the wires it
 * is travelling to get there.
 *
 * The ledger records a step when it completes and
 * never when it starts, so nothing in it says where
 * the run is now. What can be said is what is
 * immediately past the last block it heard from —
 * "the run is somewhere here" — and that is what
 * this works out.
 *
 * A branch deciding on predicates writes no row at
 * all: it is decided in the generated code. So the
 * walk goes through one to whatever it leads to,
 * rather than stopping at a block that never runs.
 */
function frontierFrom(
  ir: WorkflowIR,
  from: string | undefined,
  recorded: ReadonlyMap<string, StepState>,
): { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();

  if (from === undefined) return { nodes, edges };

  const kinds = new Map(ir.nodes.map((node) => [node.id, node.kind]));
  const walked = new Set<string>();

  const step = (at: string): void => {
    if (walked.has(at)) return;
    walked.add(at);

    for (const edge of ir.edges) {
      if (edge.from.node !== at) continue;

      // A block the ledger already holds is behind
      // the run rather than ahead of it.
      if (recorded.has(edge.to.node)) continue;

      edges.add(edge.id);

      if (kinds.get(edge.to.node) === 'branch') step(edge.to.node);
      else nodes.add(edge.to.node);
    }
  };

  step(from);

  return { nodes, edges };
}

/**
 * The one line a block shows under its title.
 *
 * Which code runs here, when something does. When
 * nothing does, whether that is a block still
 * waiting for a function or a kind that never has
 * one — a Trigger is not "unassigned", it is a
 * trigger, and saying otherwise would send a
 * person looking for code to write.
 */
export function lineOf(node: WorkflowNode, drawing: Drawing): string {
  if (node.handler !== undefined) return `ƒ ${node.handler.export}`;

  const label = drawing.labels[node.kind];

  return HANDLER_KINDS.has(node.kind)
    ? `${label} · ${drawing.unassigned}`
    : label;
}
