import { useConnection } from '@xyflow/react';

import { nodeSize, type NodeBox, type WorkflowIR } from '../../core/rules.js';
import { filled } from '../../webview/fill.js';

import { useConnecting } from './Connecting.js';

/**
 * What would meet what, under the block the pointer
 * is over.
 *
 * Shape names rather than block titles: the blocks
 * are already named on themselves, and what a person
 * is being told is that what leaves one end is what
 * the other takes.
 *
 * Only where both ends name a shape. A block with no
 * function behind it declares nothing, and an
 * undeclared shape fits everything — so there is
 * nothing to print, and a line invented for that
 * case would claim a check the document never made.
 *
 * Which block the pointer is over is asked of the
 * graph library by id alone. The block itself
 * changes identity on every pointer frame, and this
 * has to redraw when the answer changes rather than
 * when the pointer moves.
 */
export function ShapeNote({
  ir,
  boxes,
  wording,
}: {
  ir: WorkflowIR;
  boxes: Record<string, NodeBox>;
  wording: string;
}) {
  const connecting = useConnecting();
  const over = useConnection((connection) =>
    connection.inProgress ? (connection.toNode?.id ?? undefined) : undefined,
  );

  if (connecting === undefined || over === undefined) return null;
  if (!connecting.fits.has(over)) return null;

  const takes = ir.nodes.find((node) => node.id === over);
  const produces = connecting.from.out;

  if (takes?.in === undefined || produces === undefined) return null;

  const box = boxes[over];
  if (box === undefined) return null;

  return (
    <p
      className="shape-note mono"
      data-shape-note
      style={{
        transform: `translate(${box.x}px, ${
          box.y + nodeSize(takes.kind).height + NOTE_GAP
        }px)`,
      }}
    >
      {filled(wording, produces, takes.in)}
    </p>
  );
}

/** How far under the block the note sits, clear of
 *  the dot on its bottom edge. */
const NOTE_GAP = 24;
