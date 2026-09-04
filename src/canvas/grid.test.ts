import { describe, expect, it } from 'vitest';

import { GRID, guides, movedByGrid, snap, snapped } from './grid.js';

/**
 * The arithmetic behind placing a block by hand.
 *
 * Where the grid puts it, which of its neighbours it
 * has come level with, and whether the grid moved it
 * anywhere a person would notice. All three are
 * asked mid-gesture, several times a second, so they
 * are worked out here rather than in a component —
 * and a question a test can ask without a pointer is
 * a question that stays answered.
 */

describe('the grid a block lands on', () => {
  it('takes a coordinate to the nearest line', () => {
    expect(snap(0)).toBe(0);
    expect(snap(GRID)).toBe(GRID);
    expect(snap(GRID - 1)).toBe(GRID);
    expect(snap(1)).toBe(0);
    expect(snap(-GRID + 1)).toBe(-GRID);
    expect(snap(-GRID - 1)).toBe(-GRID);
  });

  /** Halfway is a tie, and a tie goes up — the same
   *  way every other rounding in the file does. */
  it('sends a coordinate halfway between two lines up', () => {
    expect(snap(GRID / 2)).toBe(GRID);
  });

  it('takes a point to the nearest crossing', () => {
    expect(snapped({ x: 165, y: 72 })).toEqual({ x: 160, y: 80 });
  });
});

/**
 * Two blocks read as lined up when their centres sit
 * on one axis, which is what the guide draws. The
 * reach is half a grid square: anything nearer would
 * have landed on the same line anyway, so the line
 * says what is about to happen rather than offering
 * something to aim at.
 */
describe('lining a block up with the ones around it', () => {
  it('draws a line through a centre within half a square', () => {
    expect(guides(160, [160 + GRID / 2, 160 - GRID / 2])).toEqual([
      160 - GRID / 2,
      160 + GRID / 2,
    ]);
  });

  it('draws nothing through one further out than that', () => {
    expect(guides(160, [160 + GRID / 2 + 1, 160 - GRID / 2 - 1])).toEqual([]);
    expect(guides(160, [400])).toEqual([]);
  });

  /** One line, however many blocks are standing on
   *  it: a second drawn over the first says nothing
   *  the first did not. */
  it('draws one line where several blocks share it', () => {
    expect(guides(160, [165, 165, 165])).toEqual([165]);
  });
});

describe('whether the grid moved a block', () => {
  it('says it did where the block is not where the pointer had it', () => {
    expect(movedByGrid({ x: 165, y: 72 }, { x: 160, y: 80 })).toBe(true);
    expect(movedByGrid({ x: 160, y: 72 }, { x: 160, y: 80 })).toBe(true);
  });

  /**
   * Under half a pixel is nothing anybody could see,
   * so a readout claiming the grid had moved the
   * block would be a claim nothing on screen backs
   * up. The pointer arrives as a fraction and the
   * grid is whole numbers, so this case is the
   * ordinary one rather than the odd one.
   */
  it('says it did not where the pointer was already on a line', () => {
    expect(movedByGrid({ x: 160, y: 80 }, { x: 160, y: 80 })).toBe(false);
    expect(movedByGrid({ x: 160.2, y: 79.8 }, { x: 160, y: 80 })).toBe(false);
  });
});
