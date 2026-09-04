import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

import type { CanvasEdge, EdgeState } from './graph.js';

/**
 * One wire between two blocks.
 *
 * The layout returns boxes and no routes on
 * purpose, so the path is the canvas's own choice.
 * Orthogonal with square corners, to match a
 * system that has no rounded ones anywhere else,
 * and because a workflow read top to bottom is
 * easier to follow along right angles than along
 * curves that cross.
 */

/**
 * What a wire is drawn in, by what is happening
 * along it.
 *
 * Idle is the hairline every other structural line
 * on the canvas is drawn in, because a wire
 * nothing is flowing through is structure and not
 * state. The rest are the run's own colours, and
 * they are here rather than in the stylesheet so
 * that the arrowhead at the end of the line cannot
 * disagree with the line.
 */
const STROKE: Record<EdgeState, string> = {
  idle: 'var(--hairline-strong)',
  active: 'var(--ok)',
  done: 'var(--edge-done)',
  waiting: 'var(--warn)',
  failed: 'var(--fail)',
};

export function Wire(props: EdgeProps<CanvasEdge>) {
  const back = props.data?.back === true;
  const state = props.data?.state ?? 'idle';
  const port = props.data?.port;

  const [path] = route({ ...props, back });

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={back ? 'wire wire-back' : 'wire'}
        data-state={state}
        style={{ stroke: STROKE[state] }}
        markerEnd={`url(#${arrowId(state)})`}
      />

      {port === undefined ? null : (
        <EdgeLabelRenderer>
          <span
            className="wire-port mono nodrag nopan"
            data-edge-port={props.id}
            style={{
              transform: beside({ ...props, back }),
              color: state === 'idle' ? undefined : STROKE[state],
            }}
          >
            {port}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * The arrowheads, one per state, defined once for
 * the whole canvas.
 *
 * A marker is referenced by id out of a `<defs>`,
 * so it can be neither a style rule nor a thing
 * each wire renders for itself. This is the one
 * element on the page whose only job is to hold
 * them.
 */
export function WireMarkers() {
  return (
    <svg className="wire-markers" aria-hidden="true">
      <defs>
        {Object.entries(STROKE).map(([state, stroke]) => (
          <marker
            key={state}
            id={arrowId(state as EdgeState)}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function arrowId(state: EdgeState): string {
  return `wire-arrow-${state}`;
}

/**
 * Where the port name sits: beside the line, half
 * way along it.
 *
 * Not at the block it leaves, which is where a
 * reader would look for it first: every wire out of
 * a branch leaves by the same dot, so three names
 * written where they leave would be three names on
 * top of each other. Half way along, the wires have
 * separated and each name is beside its own.
 */
function beside(ends: Ends & { back: boolean }): string {
  const [, x, y] = route(ends);

  return `translate(0, -50%) translate(${x + 10}px, ${y}px)`;
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

/** The wire's shape and the point half way along
 *  it, which is where its name goes. */
function route(ends: Ends & { back: boolean }): [string, number, number] {
  return ends.back ? loopBack(ends) : forward(ends);
}

function forward(ends: Ends): [string, number, number] {
  const [path, x, y] = getSmoothStepPath({
    ...ends,
    borderRadius: 0,
    offset: 16,
  });

  return [path, x, y];
}

/**
 * A loop-closing edge, drawn against the flow.
 *
 * The library's own routing takes the shortest way
 * between the two ends, and for an edge that goes
 * back up the graph the shortest way is straight
 * through everything between them — a line down
 * the middle of the workflow, crossing every block
 * it does not touch.
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

  // Half way up the leg it runs beside the graph on,
  // which is the length of it a reader can see.
  return [path, aside, (ends.sourceY + ends.targetY) / 2];
}
