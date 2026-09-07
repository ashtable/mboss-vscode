import { Handle, Position, type NodeProps } from '@xyflow/react';

import { postToHost } from '../webview/client.js';

import { BlockFace } from './Node.js';
import { SOURCE_PORT, TARGET_PORT, wantsHandler } from './graph.js';
import type { CanvasNode } from './graph.js';

/**
 * One block on a run's graph.
 *
 * The same face the canvas draws, with everything
 * about editing taken away: nothing here is
 * dragged, wired, dropped on or deleted. A run page
 * shows what already happened, and a graph that
 * invited an edit would be offering to change a
 * document from a page about a run of it.
 *
 * The handles stay, because the wires between
 * blocks are drawn between them — a wire with
 * nowhere to attach is a wire drawn from the top
 * left corner.
 */
export function RunNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;

  return (
    <div
      className="node"
      data-run-node={node.id}
      data-node-kind={node.kind}
      data-state={data.state}
      onClick={() => postToHost({ type: 'seeNode', nodeId: node.id })}
    >
      <Handle
        type="target"
        position={Position.Top}
        id={TARGET_PORT}
        isConnectable={false}
      />

      <BlockFace
        kind={node.kind}
        title={node.title}
        line={data.line}
        wanting={wantsHandler(node)}
        state={data.state}
        runTitle={data.runTitle}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id={SOURCE_PORT}
        isConnectable={false}
      />
    </div>
  );
}
