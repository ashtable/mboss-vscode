import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type NodeBox } from '../core/rules.js';

import { gapUnder, spliceGaps, type SpliceGap } from './drag/gaps.js';
import { GRID } from './grid.js';

/**
 * Where a block dropped on the canvas would go in.
 *
 * A wire is the one place on a graph where a new
 * block has an obvious meaning: it goes between the
 * two ends, and the wire becomes two. So every wire
 * offers a gap while something is being dragged, and
 * the gap the pointer is inside is the one the drop
 * splices.
 *
 * Worked out here rather than in the component so
 * that "which wire would this land on" is a question
 * a test can ask without a browser and without a
 * pointer.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../mboss-core/fixtures/${name}`, import.meta.url),
  );

  return JSON.parse(readFileSync(path, 'utf8'));
}

const ir = WorkflowIRSchema.parse(fixture('ir/groom_booking.workflow.json'));

const boxes = fixture('golden/layout/groom_booking.layout.json') as Record<
  string,
  NodeBox
>;

/** The one wire in the fixture that runs against
 *  the flow, closing a loop. */
const BACK_EDGE = 'e8';

function gapFor(edgeId: string): SpliceGap {
  return spliceGaps(ir, boxes).find((gap) => gap.edgeId === edgeId)!;
}

describe('the gaps a drag opens', () => {
  /**
   * A loop-closing wire is the exception. Splicing
   * one would leave the wire pointing back at a
   * block that had just been created, which is a
   * document core refuses — so it is not offered.
   */
  it('opens one on every wire the flow goes forward along', () => {
    const gaps = spliceGaps(ir, boxes);

    expect(gaps.map((gap) => gap.edgeId).sort()).toEqual(
      ir.edges
        .filter((edge) => !edge.back)
        .map((edge) => edge.id)
        .sort(),
    );

    expect(ir.edges.some((edge) => edge.id === BACK_EDGE && edge.back)).toBe(
      true,
    );
  });

  /**
   * Between the block it leaves and the block it
   * reaches, on the grid: a gap is where the new
   * block is about to be, and a block lands on the
   * grid.
   */
  it('centres each gap between the two blocks it would go between', () => {
    // The first wire of the fixture, by hand: out of
    // the bottom of the trigger at (165, 72), into
    // the top of the step under it at (165, 144).
    expect(gapFor('e1').at).toEqual({ x: 160, y: 100 });

    for (const gap of spliceGaps(ir, boxes)) {
      const edge = ir.edges.find((one) => one.id === gap.edgeId)!;
      const from = boxes[edge.from.node]!;
      const to = boxes[edge.to.node]!;

      expect(gap.at.x % GRID).toBe(0);
      expect(gap.at.y % GRID).toBe(0);

      // Somewhere along the wire, which is the whole
      // claim a centre makes. The exact arithmetic
      // is the case above; this is every other wire
      // in the fixture saying the answer is not
      // somewhere else entirely.
      expect(gap.at.y).toBeGreaterThan(from.y);
      expect(gap.at.y).toBeLessThan(to.y + to.h);
    }
  });
});

describe('the gap a pointer is over', () => {
  it('is the one the pointer is inside', () => {
    const gaps = spliceGaps(ir, boxes);
    const wanted = gapFor('e2');

    expect(gapUnder(gaps, wanted.at)?.edgeId).toBe('e2');

    // Off centre but still within it, which is most
    // of where a pointer actually is.
    expect(
      gapUnder(gaps, { x: wanted.at.x + 90, y: wanted.at.y - 20 })?.edgeId,
    ).toBe('e2');
  });

  /** Empty canvas splices nothing: the block lands
   *  where it was let go of, wired to nothing. */
  it('is nothing at all where there is no gap', () => {
    expect(gapUnder(spliceGaps(ir, boxes), { x: 4000, y: 4000 })).toBe(
      undefined,
    );
  });

  /**
   * Gaps are as wide as a block and wires are not
   * far apart, so two of them can cover the same
   * spot. The nearer centre wins — the further one
   * would put the block somewhere the pointer never
   * was.
   */
  it('is the nearer of two that both cover it', () => {
    const overlapping: SpliceGap[] = [
      { edgeId: 'left', at: { x: 0, y: 0 } },
      { edgeId: 'right', at: { x: 40, y: 0 } },
    ];

    expect(gapUnder(overlapping, { x: 30, y: 0 })?.edgeId).toBe('right');
    expect(gapUnder(overlapping, { x: 10, y: 0 })?.edgeId).toBe('left');
  });
});
