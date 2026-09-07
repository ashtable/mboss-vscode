import {
  nodeSize,
  type NodeBox,
  type NodeKind,
  type Position,
  type WorkflowIR,
} from '../core/rules.js';

import { gapUnder, type SpliceGap } from './drag/gaps.js';
import type { CanvasNode } from './graph.js';
import { snapped } from './grid.js';

/**
 * Where a block goes: on the canvas, and once
 * somebody lets go of it.
 *
 * The question used to be answered in seven places
 * across the seam — the engine laid a graph out, the
 * host snapped it, the graph module named the
 * picture, the panel decided whether to keep the
 * positions it was holding, and three helpers
 * private to a five-hundred-line component worked
 * out where a carried block hangs and where it
 * lands. Each was small where it sat. None of them
 * met, so nothing could ask the whole question, and
 * the arithmetic that decides where a dropped block
 * ends up was pinned by nothing at any tier.
 *
 * Browser-safe, and read from both sides: the host
 * snaps and names, the panel merges and lands.
 */

/**
 * The layout, moved onto the grid the canvas works
 * in.
 *
 * The engine spaces a graph on numbers of its own,
 * none of them the canvas's, so a block it laid out
 * sits between two grid lines. The grid rounds where
 * a block ends up rather than how far it moved, so
 * the first arrow press on such a block goes a
 * fraction of a square the way it was pressed and a
 * few pixels sideways as well — and every gesture
 * after that inherits the offset.
 *
 * A block the document itself places is left exactly
 * where it says. That coordinate is somebody's
 * answer rather than the engine's, and a canvas
 * drawing it ten pixels from where the file put it
 * would be telling a different story from the file.
 */
export function onTheGrid(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
): Record<string, NodeBox> {
  const placed = new Set(
    ir.nodes
      .filter((node) => node.position !== undefined)
      .map((node) => node.id),
  );

  return Object.fromEntries(
    Object.entries(boxes).map(([id, box]) => [
      id,
      placed.has(id) ? box : { ...box, ...snapped(box) },
    ]),
  );
}

/**
 * The identity of one picture: this document, laid
 * out here.
 *
 * The canvas holds its own nodes once a person can
 * drag one, so it has to tell a message that is a
 * different picture from one that is the same
 * picture with something else true about it — a
 * different block selected, a manifest that finished
 * scanning. Those leave this key alone and are
 * patched in; anything that changes what is drawn
 * changes it, and the canvas takes the host's nodes
 * back.
 *
 * The revision leads because that is the number a
 * person can check by eye, but it cannot carry this
 * alone: a proposal is drawn at the revision of the
 * file it is a proposal about.
 */
export function layoutKeyOf(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
): string {
  return `${ir.revision}:${hashOf(JSON.stringify([ir.nodes, ir.edges, boxes]))}`;
}

/** A short, stable stand-in for a string, so a key
 *  stays a key rather than a copy of the document. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;

  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

/**
 * The nodes to draw, given the ones the canvas is
 * holding and the ones the host has just sent.
 *
 * The graph library owns the nodes on screen while a
 * person is dragging one, so the canvas holds its
 * own copy rather than deriving one from every
 * message: a message arriving mid-drag would put the
 * block back where the document still says it is.
 *
 * What the host sends is therefore taken two ways.
 * A new picture — the key changed — replaces them. The
 * same picture with something else true about it, a
 * block selected or a manifest that finished
 * scanning, keeps every block where it is: the
 * layout is the same one, so the only block that can
 * be somewhere else is one under a pointer right
 * now, which is exactly the block that must not
 * move.
 *
 * The comparison is here rather than at the call
 * site, so that keeping and replacing are one
 * answer rather than a decision and a merge that
 * somebody has to remember to pair.
 */
export function nodesFor(
  held: readonly CanvasNode[],
  drawn: readonly CanvasNode[],
  was: string,
  now: string,
): CanvasNode[] {
  if (was !== now) return [...drawn];

  const at = new Map(held.map((node) => [node.id, node.position]));

  return drawn.map((node) => ({
    ...node,
    position: at.get(node.id) ?? node.position,
  }));
}

/**
 * What the pointer is holding, and where letting go
 * would put it.
 *
 * They are not the same place, and saying so is the
 * point. What is held hangs up and to the left of
 * the pointer, with the arrow on its own corner
 * marking where the pointer actually is — a block is
 * 230 pixels wide, and one drawn centred on the
 * pointer covers the gap it is about to go into.
 *
 * Where it lands is the gap's own slot whenever
 * there is a gap under the pointer. The gap is drawn
 * where the block will be and says as much, so that
 * is the promise to keep; over open canvas there is
 * no promise but the shape being carried, and the
 * block lands exactly there.
 */
export function landingFor(
  kind: NodeKind,
  at: Position,
  gaps: readonly SpliceGap[],
): { held: Position; lands: Position; gap: SpliceGap | undefined } {
  const gap = gapUnder(gaps, at);
  const { width, height } = nodeSize(kind);
  const held = { x: at.x - width, y: at.y - height };

  return {
    gap,
    held,
    lands:
      gap === undefined
        ? held
        : { x: gap.at.x - width / 2, y: gap.at.y - height / 2 },
  };
}

/**
 * Where a block put at the end of a wire goes.
 *
 * The wire arrives at the top of it, half way
 * across, because that is where every block takes a
 * wire — so the block hangs below the point the
 * person let go of rather than being centred on it.
 */
export function landsAt(kind: NodeKind, end: Position): Position {
  return { x: end.x - nodeSize(kind).width / 2, y: end.y };
}

/** A position the document can hold: coordinates are
 *  whole pixels, and nothing draws a fraction of
 *  one. */
export function rounded(at: Position): Position {
  return { x: Math.round(at.x), y: Math.round(at.y) };
}
