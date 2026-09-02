import type { Edge, Node } from '@xyflow/react';

import {
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
 * Positions come from `layout()`, sizes come from
 * the metrics `layout()` used, ports come from
 * `portsOf`, and the type on a wire comes off the
 * edge. The canvas' job is to paint what core
 * worked out, and this is the translation — kept
 * apart from the components so that "does the
 * canvas draw what was laid out" is a question a
 * test can ask without a browser.
 */

/** What a node component is handed. */
export type CanvasNodeData = {
  /** The document's node, whole: a component
   *  draws its own kind's summary from it. */
  node: WorkflowNode;

  /** The ports its outgoing wires leave from, in
   *  the order they are drawn. */
  ports: string[];

  [key: string]: unknown;
};

/** What an edge component is handed. */
export type CanvasEdgeData = {
  /** The type flowing along the wire, absent on an
   *  edge that has not declared one. */
  label: string | undefined;

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
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: ir.nodes.map((node) => toCanvasNode(node, boxes[node.id])),
    edges: ir.edges.map((edge) => ({
      id: edge.id,
      type: 'wire',
      source: edge.from.node,
      sourceHandle: edge.from.port,
      target: edge.to.node,
      targetHandle: TARGET_PORT,
      data: { label: edge.type, back: edge.back },
    })),
  };
}

function toCanvasNode(
  node: WorkflowNode,
  box: NodeBox | undefined,
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
    data: { node, ports: portsOf(node) },
  };
}
