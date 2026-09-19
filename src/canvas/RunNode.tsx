import { Handle, Position, type NodeProps } from '@xyflow/react';

import { BlockFace } from './Node.js';
import { SOURCE_PORT, TARGET_PORT, wantsHandler } from './graph.js';
import type { CanvasNode } from './graph.js';

/**
 * One block on a run's graph.
 *
 * The same face the canvas draws, with everything
 * about editing taken away: the run graph edits
 * nothing, and nothing here is dragged, wired,
 * dropped on or deleted. A block's configuration is
 * edited in the Inspector, against the document
 * buffer, where the canvas's own edits land too.
 *
 * The handles stay, because the wires between
 * blocks are drawn between them — a wire with
 * nowhere to attach is a wire drawn from the top
 * left corner.
 *
 * The block takes no click of its own. Picking it
 * is the graph's to hear, once, through its node
 * handler; a click here as well would say the same
 * pick twice, and on a plain element it is a way in
 * that no key reaches.
 */
export function RunNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;

  return (
    <div
      className="node"
      data-run-node={node.id}
      data-node={node.id}
      data-node-kind={node.kind}
      data-state={data.state}
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
        counts={data.counts}
        lineTitle={data.lineTitle}
        state={data.state}
        run={data.run}
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
