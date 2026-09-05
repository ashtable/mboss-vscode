import type { Position } from '../core/rules.js';

/**
 * The grid the canvas is drawn on and moved on.
 *
 * One number, used by both: the dots behind the
 * graph are this far apart, and anything a person
 * drops or drags lands on the same spacing. Two
 * numbers would draw a grid nothing ever lines up
 * with, which is worse than drawing none.
 */
export const GRID = 20;

/** The nearest line of the grid to a coordinate. */
export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** The nearest crossing of the grid to a point. */
export function snapped(at: Position): Position {
  return { x: snap(at.x), y: snap(at.y) };
}

/**
 * How near a block has to come to another block's
 * centre before the two are called lined up.
 *
 * Half a square. Anything nearer than that the grid
 * would have put on the same line anyway, so the
 * guide is saying what is about to happen rather
 * than offering something to aim at.
 */
const GUIDE_REACH = GRID / 2;

/**
 * The lines a block being moved has come level with.
 *
 * Centres rather than edges, because that is what
 * reads as lined up: two blocks of different widths
 * sharing a left edge look like an accident, and two
 * sharing a centre look deliberate.
 *
 * One line per place, however many blocks stand on
 * it — a second drawn over the first says nothing
 * the first did not.
 */
export function guides(centre: number, others: readonly number[]): number[] {
  const found = new Set<number>();

  for (const other of others) {
    if (Math.abs(other - centre) <= GUIDE_REACH) found.add(other);
  }

  return [...found].sort((first, second) => first - second);
}

/**
 * Whether the grid moved a block off where the
 * pointer had it.
 *
 * Under half a pixel is nothing anybody could see,
 * and the pointer arrives as a fraction while the
 * grid is whole numbers — so a readout that called
 * every drag snapped would be saying something the
 * screen does not show.
 */
export function movedByGrid(wanted: Position, landed: Position): boolean {
  return (
    Math.abs(landed.x - wanted.x) >= 0.5 || Math.abs(landed.y - wanted.y) >= 0.5
  );
}
