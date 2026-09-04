import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState, type DragEvent } from 'react';

import { truncateTitle } from '../core/rules.js';
import { postToHost } from '../webview/client.js';

import { LIB_FN, carries } from './dragging.js';
import { TARGET_PORT, type CanvasNode } from './graph.js';
import { NodeIcon, TONE } from './icons.js';

/**
 * One block on the canvas.
 *
 * One component for all ten kinds rather than ten,
 * because a block says the same four things
 * whatever it is: which kind it is, what it is
 * called, which code runs there, and what is
 * happening to it. Ten components would be ten
 * copies of this frame around one glyph.
 *
 * Nothing else is drawn. Not the id, not the
 * config, not the ports — a person reading a
 * canvas is looking for the shape of the workflow,
 * and everything a block cannot say from across
 * the room belongs in the Inspector.
 *
 * The size is the size core laid the graph out
 * with, applied by the graph library from the
 * node's own `width` and `height`. The frame here
 * fills it and never measures anything: a box that
 * sized itself to its text would sit at
 * coordinates computed for a different box.
 *
 * A block is also where a function from the palette
 * lands. Whether it may sit there is not decided
 * here — the host asks core the same question the
 * palette and the picker ask, and says so out loud
 * when the answer is no.
 */
export function Node({ data }: NodeProps<CanvasNode>) {
  const { node, ports, state, assignAgainst } = data;
  const [landing, setLanding] = useState(false);

  // The three of them exist together or not at
  // all: a block takes a function only while what
  // is drawn is the document.
  const dropping =
    assignAgainst === undefined
      ? {}
      : {
          // The types are readable mid-drag and the
          // data is not, so what is being carried
          // is all a hover can ask about.
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!carries(event.dataTransfer, LIB_FN)) return;

            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setLanding(true);
          },

          onDragLeave: () => setLanding(false),

          onDrop: (event: DragEvent<HTMLDivElement>) => {
            const exported = event.dataTransfer.getData(LIB_FN);

            event.preventDefault();
            setLanding(false);

            if (exported === '') return;

            postToHost({
              type: 'assign',
              baseRevision: assignAgainst,
              nodeId: node.id,
              export: exported,
            });
          },
        };

  return (
    <div
      className="node"
      data-node-kind={node.kind}
      data-state={state}
      data-landing={landing ? 'lib-fn' : undefined}
      {...dropping}
    >
      <Handle type="target" position={Position.Top} id={TARGET_PORT} />

      <NodeIcon kind={node.kind} tone={TONE[state]} />

      <div className="node-text">
        <p className="node-title">{truncateTitle(node.title)}</p>
        <p className="node-line mono">{data.line}</p>
      </div>

      {ports.map((port, index) => (
        <Handle
          key={port}
          type="source"
          position={Position.Bottom}
          id={port}
          style={{ left: across(index, ports.length) }}
        />
      ))}
    </div>
  );
}

/** Where one of a block's outgoing wires leaves
 *  from, as a fraction across its bottom edge. */
function across(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}
