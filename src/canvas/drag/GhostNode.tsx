import { nodeSize, type NodeKind, type Position } from '../../core/rules.js';
import { BlockFace } from '../Node.js';

import { CursorBadge } from './CursorBadge.js';

/**
 * The block a person is carrying, drawn where the
 * pointer has it.
 *
 * Half-there rather than solid, because it is not on
 * the graph yet: a block at full strength would read
 * as one that had already landed, and there would be
 * nothing to say the drop had not happened.
 *
 * It wears the state a block wears when it is the
 * one being looked at, which is what the block will
 * be the moment it lands — the column beside the
 * canvas will be asking about it.
 */
export function GhostNode({
  kind,
  title,
  line,
  at,
}: {
  kind: NodeKind;
  title: string;
  line: string;

  /** Its top-left corner, in the graph's own
   *  coordinates. */
  at: Position;
}) {
  const { width, height } = nodeSize(kind);

  return (
    <div
      className="ghost"
      data-ghost
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, width, height }}
    >
      <div className="node" data-node-kind={kind} data-state="selected">
        <BlockFace kind={kind} title={title} line={line} state="selected" />
      </div>

      <CursorBadge />
    </div>
  );
}
