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
import type { StepState } from '../runs/reading.js';
import type { LiveRun, LiveStep, QueueCounts } from '../runs/watch.js';
import { filled } from '../webview/fill.js';
import { fine } from '../webview/time.js';

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

  /** What the mark on the block a run is at says it
   *  is. The mark itself is a dot, so the sentence
   *  is the only thing a screen reader has, and it
   *  is also where the mark admits it was worked
   *  out rather than read off a row. */
  runningDerived: string;

  /**
   * What the line under a parked block says, with
   * `{0}` for the moment the run stopped there.
   *
   * Optional because not every reader of this
   * drawing has the word: the run page says the
   * same thing in a column of its own and would
   * then be saying it twice. Without one, a parked
   * block keeps the line every other block has.
   */
  waitingSince?: string;

  /**
   * What a queue block's line says while its
   * children are moving, with `{0}` for the ones
   * running now and `{1}` for the ones still to
   * start.
   *
   * Optional for the reason `waitingSince` is: a
   * reader without the word draws the code behind
   * the block instead of a template with two holes
   * in it.
   */
  queueCounts?: string;

  /**
   * The word for anything a surface worked out
   * rather than read off a row, which the counts
   * line is titled with.
   *
   * Both counts are aggregates over the children's
   * rows; the block itself recorded neither, and a
   * line that did not admit it would be read as
   * something the ledger says.
   */
  derived?: string;

  /** Blocks an agent is asking for, which the file
   *  does not have. */
  proposed?: readonly string[];

  selected?: string;

  /** The run this canvas is about, while somebody is
   *  following one of this workflow. */
  run?: LiveRun;

  /**
   * Which way out each decided block took, where the
   * ledger says.
   *
   * Optional because a canvas with no run has no
   * decisions, and making every caller pass an empty
   * map would be noise. Only ever names the round
   * the run is on — which round a recorded value
   * belongs to is settled before the drawing sees
   * it.
   */
  decided?: ReadonlyMap<string, string>;
};

/** What a node component is handed. */
export type CanvasNodeData = {
  /** The document's node, whole. */
  node: WorkflowNode;

  /** The one line under the title, already in the
   *  reader's language. */
  line: string;

  /** Whether that line is when the run parked here
   *  rather than the code behind the block. Absent
   *  everywhere else, so a block drawn `waiting` by
   *  a reader with no word for it does not claim to
   *  be saying one. */
  waiting?: boolean;

  /** Or whether it is what this block's children
   *  are doing. Absent everywhere else, the way
   *  `waiting` is. */
  counts?: boolean;

  /** What the line says about itself, where it says
   *  anything: the whole of a moment that may not
   *  fit, or the admission that a count was worked
   *  out rather than recorded. */
  lineTitle?: string;

  state: NodeState;

  /** What the run mark says, where there is a run
   *  and it is at this block. */
  runTitle?: string;

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

  /** Every block on the graph, so a wire can put
   *  its name somewhere it can be read. */
  blocks: readonly NodeBox[];

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
  const run = tonesOf(ir, drawing.run, drawing.decided ?? new Map());
  const parked = parkedAt(drawing.run);

  // Built once and handed to every wire, rather
  // than each of them keeping its own copy of the
  // same graph.
  const blocks = Object.values(boxes);

  return {
    nodes: ir.nodes.map((node) =>
      toCanvasNode(
        node,
        boxes[node.id],
        stateOf(node.id, arriving, drawing.selected, run.nodes),
        lineFor(
          node,
          drawing,
          parked.get(node.id),
          drawing.run?.queues?.[node.id],
        ),
        drawing.runningDerived,
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
        blocks,
      },
    })),
  };
}

function toCanvasNode(
  node: WorkflowNode,
  box: NodeBox | undefined,
  state: NodeState,
  line: BlockLine,
  runningDerived: string,
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
    data: {
      node,
      line: line.text,
      state,
      ...(line.waiting ? { waiting: true } : {}),
      ...(line.counts ? { counts: true } : {}),
      ...(line.title === undefined ? {} : { lineTitle: line.title }),
      ...(state === 'running' ? { runTitle: runningDerived } : {}),
    },
  };
}

/**
 * The line under a title, which of the three kinds
 * of line it is, and what it says about itself.
 *
 * The title is settled here rather than in the
 * component because it is a different sentence for
 * each kind: the whole of a moment that may not fit
 * inside the block, or the admission that a pair of
 * counts was worked out.
 */
type BlockLine = {
  text: string;
  waiting: boolean;
  counts: boolean;
  title: string | undefined;
};

/**
 * The line a block shows, which is the code behind
 * it until a run has something to say there.
 *
 * A block the run stopped on is the one somebody
 * came to the canvas about, and when it stopped is
 * what is worth reading there. A queue block is the
 * other way round: nothing has stopped, and what is
 * worth reading is how much of the work is still to
 * come. Both are written here rather than inside
 * `lineOf`, because that function answers a question
 * about the document alone and a run is not part of
 * the document.
 *
 * Parked first. A block cannot be both, and a run
 * that stopped at one is the more urgent of the two
 * sentences.
 */
function lineFor(
  node: WorkflowNode,
  drawing: Drawing,
  since: number | undefined,
  counts: QueueCounts | undefined,
): BlockLine {
  const parked = drawing.waitingSince;

  if (since !== undefined && parked !== undefined) {
    const text = filled(parked, fine(since));

    // A block is the width core laid the graph out
    // at, and a clock written to the millisecond
    // does not always fit inside it. Half a moment
    // is no moment at all, so the whole of it stays
    // reachable.
    return { text, waiting: true, counts: false, title: text };
  }

  const counted = drawing.queueCounts;

  // The same "anything still to finish" the tone
  // turns on, because a block drawn as running with
  // nothing counted under it would be two answers to
  // one question.
  if (
    counted !== undefined &&
    counts !== undefined &&
    counts.active + counts.queued > 0
  ) {
    return {
      text: filled(counted, String(counts.active), String(counts.queued)),
      waiting: false,
      counts: true,
      title: drawing.derived,
    };
  }

  return {
    text: lineOf(node, drawing),
    waiting: false,
    counts: false,
    title: undefined,
  };
}

/**
 * When each parked block parked.
 *
 * The row carrying `waiting` is the registration
 * the run wrote as it stopped, so its completion is
 * the moment. A block that parked more than once
 * has a row for each, and the latest is where the
 * run is sitting now.
 */
function parkedAt(run: LiveRun | undefined): ReadonlyMap<string, number> {
  const since = new Map<string, number>();
  if (run === undefined) return since;

  for (const step of run.steps) {
    if (step.state !== 'waiting' || step.nodeId === undefined) continue;

    const at = step.completedAt ?? step.startedAt;
    if (at !== undefined) since.set(step.nodeId, at);
  }

  return since;
}

/**
 * What the run says about one block, as the graph
 * says it.
 *
 * The column beside the graph draws a card about
 * whichever block somebody selected, and the state
 * on that card has to be the state the block is
 * drawn in — a block a run may be at reads
 * `running` on the canvas and must not read
 * "nothing recorded" a hand's width away. Selection
 * is what the graph paints instead of the run's
 * colour, so the answer cannot be read back off the
 * drawn block; it is asked here, of the function
 * that painted every other one.
 */
export function runStateOf(
  ir: WorkflowIR,
  run: LiveRun | undefined,
  nodeId: string,
  decided: ReadonlyMap<string, string> = new Map(),
): RunState | undefined {
  return tonesOf(ir, run, decided).nodes.get(nodeId);
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

function tonesOf(
  ir: WorkflowIR,
  run: LiveRun | undefined,
  decided: ReadonlyMap<string, string>,
): RunTones {
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
      ? frontierFrom(ir, run.steps.at(-1)?.nodeId, recorded, decided)
      : { nodes: new Set<string>(), edges: new Set<string>() };

  for (const id of ahead.nodes) nodes.set(id, 'running');

  // Last, because what a queue block's children are
  // doing outranks both the rows and the walk.
  for (const node of ir.nodes) {
    if (node.kind !== 'queue') continue;

    const state = queueState(run.queues?.[node.id]);
    if (state !== undefined) nodes.set(node.id, state);
  }

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
 * What a queue block's children say about it.
 *
 * The parent writes a row as each child is handed
 * to the queue. That row carries no error and is
 * complete the moment it is written, so the ledger
 * has the block finished while every child is still
 * waiting its turn — which is why the counts win
 * over the rows here rather than filling a gap in
 * them.
 *
 * A row of nothing but zeros says nothing at all.
 * The counts are one ungrouped aggregate per block,
 * so a block the run has not reached answers zeros
 * from the very first tick rather than no row —
 * and read as a state, that row would tick a block
 * nothing has happened at and green the wire into
 * it.
 */
function queueState(counts: QueueCounts | undefined): RunState | undefined {
  if (counts === undefined) return undefined;

  const moving = counts.active + counts.queued;
  const settled = counts.done + counts.failed;

  if (moving + settled === 0) return undefined;
  if (moving > 0) return 'running';

  return counts.failed > 0 ? 'failed' : 'done';
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
    // A row naming no block of this drawing paints
    // nothing: an unreadable name, or a block
    // somebody deleted between the run and the
    // reading.
    const nodeId = step.nodeId;
    if (nodeId === undefined) continue;

    const held = states.get(nodeId);

    if (
      held === undefined ||
      LOUDNESS.indexOf(step.state) > LOUDNESS.indexOf(held)
    ) {
      states.set(nodeId, step.state);
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
  decided: ReadonlyMap<string, string>,
): { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();

  if (from === undefined) return { nodes, edges };

  const kinds = new Map(ir.nodes.map((node) => [node.id, node.kind]));
  const walked = new Set<string>();

  const step = (at: string): void => {
    if (walked.has(at)) return;
    walked.add(at);

    // Which way out this block is known to have
    // taken, where the ledger recorded one. Every
    // other way out is somewhere the run
    // demonstrably did not go.
    const arm = decided.get(at);

    for (const edge of ir.edges) {
      if (edge.from.node !== at) continue;
      if (arm !== undefined && edge.from.port !== arm) continue;

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
export function lineOf(
  node: WorkflowNode,
  drawing: Pick<Drawing, 'labels' | 'unassigned'>,
): string {
  if (node.handler !== undefined) return `ƒ ${node.handler.export}`;

  const label = drawing.labels[node.kind];

  return HANDLER_KINDS.has(node.kind)
    ? `${label} · ${drawing.unassigned}`
    : label;
}

/**
 * Whether the line under the title is a gap rather
 * than a fact.
 *
 * The block is a kind that runs code and has none
 * behind it yet, which is the one case where the
 * line says something is missing. A function's name
 * is a fact about the block, and so is the kind of a
 * block that never takes one — both are written at
 * the weight facts are written in, and the gap is
 * written quieter.
 */
export function wantsHandler(node: WorkflowNode): boolean {
  return node.handler === undefined && HANDLER_KINDS.has(node.kind);
}
