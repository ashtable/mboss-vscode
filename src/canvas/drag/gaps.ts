import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type NodeBox,
  type Position,
  type WorkflowIR,
} from '../../core/rules.js';
import { snapped } from '../grid.js';

/**
 * Where a block being dragged onto the canvas could
 * go in.
 *
 * A wire is the one place on a graph where a new
 * block means something obvious: it goes between the
 * two ends and the wire becomes two. So while
 * something is being dragged, every wire opens a gap
 * the width of a block, and letting go inside one
 * splices there.
 *
 * A loop-closing wire opens none. Splicing one would
 * leave the wire running back to a block created a
 * moment ago, which is a document core refuses — and
 * a gap that refuses the drop it invited is worse
 * than no gap.
 */

/** One wire's offer, and where the block would land
 *  if it were taken. */
export type SpliceGap = {
  edgeId: string;

  /** The centre of the gap, in the graph's own
   *  coordinates. */
  at: Position;
};

/**
 * The size of the block that would fill it.
 *
 * Both marks drawn from these — the gap a wire opens
 * and the slot a lifted block left — are a
 * block-shaped hole, and a hole any other size is a
 * different, smaller thing sitting where a block
 * goes. It has to be the block's own size rather
 * than a number that resembles it: a block lands
 * centred on a gap, so a gap eight pixels short puts
 * the block four pixels above the outline that
 * offered it.
 */
export const GAP_WIDTH = NODE_WIDTH;
export const GAP_HEIGHT = NODE_HEIGHT;

export function spliceGaps(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
): SpliceGap[] {
  const gaps: SpliceGap[] = [];

  for (const edge of ir.edges) {
    if (edge.back) continue;

    const from = boxes[edge.from.node];
    const to = boxes[edge.to.node];

    // A wire whose ends have not been laid out is a
    // wire nothing has drawn either.
    if (from === undefined || to === undefined) continue;

    gaps.push({
      edgeId: edge.id,
      at: snapped({
        x: (from.x + from.w / 2 + (to.x + to.w / 2)) / 2,
        y: (from.y + from.h + to.y) / 2,
      }),
    });
  }

  return gaps;
}

/**
 * The gap a point is in, if it is in one.
 *
 * Gaps are as wide as a block and wires are not far
 * apart, so a point can be inside two of them. The
 * nearer centre wins: the further one would put the
 * block somewhere the pointer never was.
 */
export function gapUnder(
  gaps: readonly SpliceGap[],
  at: Position,
): SpliceGap | undefined {
  let found: SpliceGap | undefined;
  let nearest = Infinity;

  for (const gap of gaps) {
    const across = Math.abs(gap.at.x - at.x);
    const down = Math.abs(gap.at.y - at.y);

    if (across > GAP_WIDTH / 2 || down > GAP_HEIGHT / 2) continue;

    const distance = across * across + down * down;
    if (distance >= nearest) continue;

    nearest = distance;
    found = gap;
  }

  return found;
}
