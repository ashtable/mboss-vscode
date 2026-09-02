import { Handle, Position, type NodeProps } from '@xyflow/react';

import { truncateTitle } from '../core/rules.js';
import { Registered } from '../webview/Registered.js';

import { TARGET_PORT, type CanvasNode } from './graph.js';
import { portOffsets, summaryOf } from './summary.js';

/**
 * One block on the canvas.
 *
 * One component for all ten kinds rather than ten,
 * because the difference between them is what each
 * one *says* — its ports, its summary lines, its
 * id — and all three of those already come from
 * core. Ten components would be ten copies of this
 * frame around one varying line.
 *
 * The size is the size core laid the graph out
 * with, applied by React Flow from the node's own
 * `width` and `height`. The frame here fills it
 * and never measures anything: a box that sized
 * itself to its text would sit at coordinates
 * computed for a different box.
 */
export function Block({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.node;

  // The registration marks go on the one kind whose
  // promise is worth seeing from across the graph:
  // a transaction lands whole or not at all.
  const transaction = node.kind === 'transaction';

  return (
    <Registered
      className={transaction ? 'block block-transaction' : 'block'}
      marks={transaction}
      data-node-kind={node.kind}
      data-selected={selected === true ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Top} id={TARGET_PORT} />

      <p className="block-title">{truncateTitle(node.title)}</p>
      <p className="block-id mono">{node.id}</p>

      <ul className="block-summary mono">
        {summaryOf(node).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>

      {portOffsets(node).map(({ port, at }) => (
        <Handle
          key={port}
          type="source"
          position={Position.Bottom}
          id={port}
          style={{ left: at }}
        >
          {data.ports.length > 1 ? (
            <span className="port-label mono">{port}</span>
          ) : null}
        </Handle>
      ))}
    </Registered>
  );
}
