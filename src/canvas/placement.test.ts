import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  nodeSize,
  WorkflowIRSchema,
  type NodeBox,
  type WorkflowIR,
} from '../core/rules.js';

import { spliceGaps } from './drag/gaps.js';
import type { CanvasNode } from './graph.js';
import { GRID } from './grid.js';
import {
  landingFor,
  landsAt,
  layoutKeyOf,
  nodesFor,
  onTheGrid,
  rounded,
} from './placement.js';

/**
 * Where a block goes.
 *
 * These rules used to sit in three places that never
 * met — the host's snapping, the graph module's key,
 * and three helpers private to the canvas component
 * — so the only tier that could reach any of them
 * was a browser, and the arithmetic that decides
 * where a dropped block lands was reachable from
 * nowhere at all. This is the whole question, asked
 * without a pointer.
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

/** The same document with every block placed where
 *  the file says, which is what a person's first
 *  move writes. */
function placed(at: Record<string, { x: number; y: number }>): WorkflowIR {
  return {
    ...ir,
    nodes: ir.nodes.map((node) =>
      at[node.id] === undefined ? node : { ...node, position: at[node.id] },
    ),
  };
}

/** A node as React Flow holds it, which is all these
 *  rules read of one. */
function node(id: string, x: number, y: number): CanvasNode {
  return { id, position: { x, y }, data: {}, type: 'step' } as CanvasNode;
}

describe('the layout, put on the grid', () => {
  it('moves every block the engine placed onto a grid line', () => {
    const snapped = onTheGrid(ir, boxes);

    for (const box of Object.values(snapped)) {
      expect(box.x % GRID).toBe(0);
      expect(box.y % GRID).toBe(0);
    }
  });

  /**
   * A coordinate in the document is somebody's own
   * answer. Drawing it ten pixels from where the file
   * put it would tell a different story from the
   * file — and rounding it here would then be written
   * back by the next move.
   */
  it('leaves a block the document placed exactly where it says', () => {
    const off = { x: 137, y: 41 };
    const snapped = onTheGrid(placed({ find_slot: off }), {
      ...boxes,
      find_slot: { ...boxes['find_slot']!, ...off },
    });

    expect(snapped['find_slot']).toMatchObject(off);
  });

  it('still moves the blocks beside it that nobody placed', () => {
    const snapped = onTheGrid(placed({ find_slot: { x: 137, y: 41 } }), {
      ...boxes,
      find_slot: { ...boxes['find_slot']!, x: 137, y: 41 },
    });

    for (const [id, box] of Object.entries(snapped)) {
      if (id === 'find_slot') continue;

      expect(box.x % GRID).toBe(0);
    }
  });
});

describe('the identity of one picture', () => {
  it('is the same for the same document laid out the same way', () => {
    expect(layoutKeyOf(ir, boxes)).toBe(layoutKeyOf(ir, boxes));
  });

  it('changes when a block moves', () => {
    const moved = { ...boxes, find_slot: { ...boxes['find_slot']!, x: 999 } };

    expect(layoutKeyOf(ir, moved)).not.toBe(layoutKeyOf(ir, boxes));
  });

  /** The number a person can check by eye leads, but
   *  cannot carry it alone: a proposal is drawn at
   *  the revision of the file it is about. */
  it('leads with the revision', () => {
    expect(layoutKeyOf(ir, boxes).startsWith(`${ir.revision}:`)).toBe(true);
    expect(layoutKeyOf({ ...ir, revision: ir.revision + 1 }, boxes)).not.toBe(
      layoutKeyOf(ir, boxes),
    );
  });
});

describe('the nodes to draw', () => {
  const held = [node('a', 500, 500), node('b', 10, 10)];
  const drawn = [node('a', 0, 0), node('b', 10, 10)];

  /**
   * The same layout, so the only block that can be
   * somewhere else is one under a pointer right now —
   * which is exactly the block that must not move.
   */
  it('keeps where the canvas has them when the picture is the same', () => {
    const shown = nodesFor(held, drawn, 'k1', 'k1');

    expect(shown.map((one) => one.position)).toEqual([
      { x: 500, y: 500 },
      { x: 10, y: 10 },
    ]);
  });

  it('takes the host back when the picture is a different one', () => {
    const shown = nodesFor(held, drawn, 'k1', 'k2');

    expect(shown.map((one) => one.position)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  /** A block the canvas has never held is drawn where
   *  the host put it, whichever way the key went. */
  it('draws a block it was not holding where the host says', () => {
    const shown = nodesFor([], drawn, 'k1', 'k1');

    expect(shown.map((one) => one.position)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('draws what the host sent and nothing it no longer sends', () => {
    expect(
      nodesFor(held, [node('a', 0, 0)], 'k1', 'k1').map((one) => one.id),
    ).toEqual(['a']);
  });
});

describe('where a carried block would land', () => {
  const gaps = spliceGaps(ir, boxes);
  const { width, height } = nodeSize('step');

  /**
   * What is held hangs up and to the left of the
   * pointer, because a block drawn centred on the
   * pointer covers the gap it is about to go into.
   * Over open canvas there is no promise but the
   * shape being carried, so it lands exactly there.
   */
  it('lands where the shape is being carried, over open canvas', () => {
    const at = { x: 4000, y: 4000 };
    const landing = landingFor('step', at, gaps);

    expect(landing.gap).toBeUndefined();
    expect(landing.held).toEqual({ x: 4000 - width, y: 4000 - height });
    expect(landing.lands).toEqual(landing.held);
  });

  /**
   * The gap is drawn where the block will be and says
   * as much, so that is the promise to keep — and
   * keeping it means centring on the gap rather than
   * landing where the shape was being carried.
   */
  it('lands centred on the gap it was let go of over', () => {
    const gap = gaps.find((one) => one.edgeId === 'e2');
    if (gap === undefined) throw new Error('no gap on e2');

    const landing = landingFor('step', gap.at, gaps);

    expect(landing.gap?.edgeId).toBe('e2');
    expect(landing.lands).toEqual({
      x: gap.at.x - width / 2,
      y: gap.at.y - height / 2,
    });
  });

  /** The block a person is holding is in the same
   *  place either way — only where it would land
   *  changes. */
  it('holds it in the same place whether or not a gap takes it', () => {
    const gap = gaps.find((one) => one.edgeId === 'e2');
    if (gap === undefined) throw new Error('no gap on e2');

    expect(landingFor('step', gap.at, gaps).held).toEqual(
      landingFor('step', gap.at, []).held,
    );
  });

  /**
   * A wire arrives at the top of a block, half way
   * across, so a block put at the end of one hangs
   * below where the person let go rather than being
   * centred on it.
   */
  it('hangs a block put at the end of a wire below that point', () => {
    expect(landsAt('step', { x: 300, y: 200 })).toEqual({
      x: 300 - width / 2,
      y: 200,
    });
  });

  it('measures each kind by its own size', () => {
    expect(landsAt('branch', { x: 300, y: 200 }).x).toBe(
      300 - nodeSize('branch').width / 2,
    );
  });
});

describe('a position the document can hold', () => {
  it('is whole pixels, because nothing draws a fraction of one', () => {
    expect(rounded({ x: 12.4, y: -3.5 })).toEqual({ x: 12, y: -3 });
  });
});
