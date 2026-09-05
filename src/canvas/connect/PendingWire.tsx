import {
  Position,
  getBezierPath,
  type ConnectionLineComponentProps,
} from '@xyflow/react';

/**
 * The wire between the dot and the cursor.
 *
 * A curve rather than the right angles a settled
 * wire is drawn in, and a dash of its own rather
 * than the one a run travels along: this is not a
 * wire yet, and a wire being drawn must never read
 * as a wire being run.
 *
 * It ends in a dot rather than an arrowhead, because
 * that end is where the pointer is and not where
 * anything arrives.
 */
export function PendingWire({
  fromX,
  fromY,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: Position.Bottom,
    targetX: toX,
    targetY: toY,
    targetPosition: Position.Top,
  });

  return (
    <g className="pending-wire">
      <path d={path} fill="none" data-pending-wire />
      <circle cx={toX} cy={toY} r={5} data-pending-end />
    </g>
  );
}
