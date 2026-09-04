import { useViewport } from '@xyflow/react';

import type { Position } from '../../core/rules.js';
import { filled } from '../../webview/fill.js';
import type { CanvasStrings } from '../../webview/protocol.js';

import { GAP_HEIGHT, GAP_WIDTH } from './gaps.js';

/**
 * What is drawn around a block a hand has picked up.
 *
 * Three things, and each answers a question a person
 * has while the block is in the air. Where did it
 * come from — the outline of the slot it left. Is it
 * lined up with anything — the centreline through
 * the blocks it has come level with. Where exactly
 * is it, and why is it not under my pointer — the
 * readout, which says both.
 *
 * None of them is drawn once the block lands. They
 * are about a gesture in progress, and a graph
 * covered in the marks of a finished one is a graph
 * nobody can read.
 */

/** A block on its way from somewhere to somewhere,
 *  while a hand still has it. */
export type Lift = {
  /** Where it was picked up from, in the graph's own
   *  coordinates. */
  from: Position;

  /** Where it is now. */
  at: Position;

  /** Whether the grid put it somewhere the pointer
   *  did not. */
  snapped: boolean;

  /** The centres it has come level with. */
  guides: readonly number[];
};

/**
 * The hole the block came out of.
 *
 * The same block-shaped hole a wire opens to offer a
 * splice, because it is the same thing — a space
 * where a block is not. Neutral rather than brand,
 * though: everything else a gesture draws is blue
 * because a person is doing it, and the place they
 * have left is not something they are doing. A blue
 * hole would read as an offer to put it back.
 */
export function OldSlot({ at }: { at: Position }) {
  return (
    <div
      className="old-slot"
      data-old-slot
      style={{
        transform: `translate(${at.x}px, ${at.y}px)`,
        width: GAP_WIDTH,
        height: GAP_HEIGHT,
      }}
    />
  );
}

/**
 * Where the block is, said in numbers, above it.
 *
 * The graph's own coordinates, which are the ones
 * the document holds — a person moving a block by
 * hand is entitled to the numbers they are writing.
 *
 * And the grid's own admission when it applies. A
 * block that will not sit where the pointer put it
 * is the one moment this gesture surprises anybody,
 * so it is the one moment it explains itself.
 */
export function Readout({
  lift,
  strings,
}: {
  lift: Lift;
  strings: CanvasStrings;
}) {
  const said = filled(strings.readout, String(lift.at.x), String(lift.at.y));

  return (
    <div
      className="move-readout mono"
      data-readout
      style={{ transform: `translate(${lift.at.x}px, ${lift.at.y}px)` }}
    >
      {lift.snapped ? filled(strings.snapped, said) : said}
    </div>
  );
}

/**
 * The lines the block has come level with, drawn the
 * height of the pane.
 *
 * In the pane's own pixels rather than the graph's,
 * because a centreline is about a whole column and
 * the graph itself has no top or bottom to reach.
 * The graph's transform is therefore applied by
 * hand: a line about where a block is has to travel
 * with the graph that block is on.
 */
export function SnapGuides({ at }: { at: readonly number[] }) {
  const { x, zoom } = useViewport();

  return (
    <>
      {at.map((centre) => (
        <div
          key={centre}
          className="snap-guide"
          data-snap-guide
          style={{ left: x + centre * zoom }}
        />
      ))}
    </>
  );
}
