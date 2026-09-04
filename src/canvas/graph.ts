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
 * about what a person is looking at. The last four
 * are facts about a run, and no run is watched
 * yet — they are named here, and styled in the
 * sheet, so that following one is a matter of
 * filling them in rather than of reshaping this.
 */
export type NodeState =
  | 'dormant'
  | 'selected'
  | 'proposed'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'done';

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
};

/** What a node component is handed. */
export type CanvasNodeData = {
  /** The document's node, whole. */
  node: WorkflowNode;

  /** The ports its outgoing wires leave from, in
   *  the order they are drawn. */
  ports: string[];

  /** The one line under the title, already in the
   *  reader's language. */
  line: string;

  state: NodeState;

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

  return {
    nodes: ir.nodes.map((node) =>
      toCanvasNode(
        node,
        boxes[node.id],
        ports.get(node.id) ?? [],
        stateOf(node.id, arriving, drawing.selected),
        lineOf(node, drawing),
      ),
    ),
    edges: ir.edges.map((edge) => ({
      id: edge.id,
      type: 'wire',
      source: edge.from.node,
      sourceHandle: edge.from.port,
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
        state: 'idle',
        back: edge.back,
      },
    })),
  };
}

function toCanvasNode(
  node: WorkflowNode,
  box: NodeBox | undefined,
  ports: string[],
  state: NodeState,
  line: string,
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
    data: { node, ports, line, state },
  };
}

function stateOf(
  id: string,
  proposed: ReadonlySet<string>,
  selected: string | undefined,
): NodeState {
  if (id === selected) return 'selected';
  if (proposed.has(id)) return 'proposed';

  return 'dormant';
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
function lineOf(node: WorkflowNode, drawing: Drawing): string {
  if (node.handler !== undefined) return `ƒ ${node.handler.export}`;

  const label = drawing.labels[node.kind];

  return HANDLER_KINDS.has(node.kind)
    ? `${label} · ${drawing.unassigned}`
    : label;
}
