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
