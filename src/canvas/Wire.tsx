import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

import type { CanvasEdge } from './graph.js';

/**
 * One wire between two blocks.
 *
 * `layout()` returns boxes and no routes on
 * purpose, so the path is the canvas's own choice.
 * Orthogonal with square corners, to match a
 * system that has no rounded ones anywhere else,
 * and because a workflow read top to bottom is
 * easier to follow along right angles than along
 * curves that cross.
 */
export function Wire(props: EdgeProps<CanvasEdge>) {
  const back = props.data?.back === true;

  const [path, labelX, labelY] = back ? loopBack(props) : forward(props);

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={back ? 'wire wire-back' : 'wire'}
      />

      {props.data?.label === undefined ? null : (
        <EdgeLabelRenderer>
          <span
            className="wire-label mono nodrag nopan"
            data-edge-label={props.id}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {props.data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

type Ends = Pick<
  EdgeProps,
  | 'sourceX'
  | 'sourceY'
  | 'sourcePosition'
  | 'targetX'
  | 'targetY'
  | 'targetPosition'
>;

function forward(ends: Ends): [string, number, number] {
  const [path, labelX, labelY] = getSmoothStepPath({
    ...ends,
    borderRadius: 0,
    offset: 16,
  });

  return [path, labelX, labelY];
}

/**
 * A loop-closing edge, drawn against the flow.
 *
 * The library's own routing takes the shortest way
 * between the two ends, and for an edge that goes
 * back up the graph the shortest way is straight
 * through everything between them — a dashed line
 * down the middle of the workflow, crossing every
 * block it does not touch.
 *
 * So this one is routed by hand: out to the side,
 * up past everything, and back in from above. It is
 * the one edge in a workflow that means "again",
 * and the shape it is drawn in is what says so from
 * across the canvas.
 */
function loopBack(ends: Ends): [string, number, number] {
  const clear = 20;
  const aside = Math.max(ends.sourceX, ends.targetX) + 130;

  const path = [
    `M ${ends.sourceX},${ends.sourceY}`,
    `L ${ends.sourceX},${ends.sourceY + clear}`,
    `L ${aside},${ends.sourceY + clear}`,
    `L ${aside},${ends.targetY - clear}`,
    `L ${ends.targetX},${ends.targetY - clear}`,
    `L ${ends.targetX},${ends.targetY}`,
  ].join(' ');

  return [path, aside, (ends.sourceY + ends.targetY) / 2];
}
