import type { NodeKind } from '../core/rules.js';

import type { NodeState } from './graph.js';

/**
 * The glyph on a block, and the colour of the tile
 * it sits in.
 *
 * Two rules, and between them they are the whole
 * file. The glyph says what kind of block this is,
 * and every one of them is drawn in one weight of
 * one stroke — ten icons in ten weights reads as
 * ten different products. The colour says what is
 * happening to the block right now, and never what
 * kind it is: ten kinds in ten colours is a legend
 * to memorise, and the block worth finding across
 * a graph is the one that is running.
 *
 * The paths are Lucide's, written out here rather
 * than imported. A webview bundle that pulled the
 * icon package would carry a thousand glyphs to
 * draw ten, and these ten change only when
 * somebody decides they should. The licence is in
 * THIRD_PARTY_NOTICES.md.
 */

export type Tone = 'neutral' | 'brand' | 'agent' | 'ok' | 'warn' | 'fail';

/**
 * Keyed on state. `dormant` and `done` take no
 * colour at all — a run that finished an hour ago
 * is not happening, and a tile lit for it is
 * decoration.
 */
export const TONE: Record<NodeState, Tone> = {
  dormant: 'neutral',
  selected: 'brand',
  proposed: 'agent',
  running: 'ok',
  waiting: 'warn',
  failed: 'fail',
  done: 'neutral',
};

const PATHS: Record<NodeKind, readonly string[]> = {
  // zap
  trigger: [
    'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  ],

  // package
  step: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],

  // database
  transaction: [
    'M3 5v14a9 3 0 0 0 18 0V5',
    'M3 12a9 3 0 0 0 18 0',
    'M21 5a9 3 0 0 1-18 0 9 3 0 0 1 18 0Z',
  ],

  // globe
  apiCall: [
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
    'M2 12h20',
  ],

  // split
  branch: [
    'M16 3h5v5',
    'M8 3H3v5',
    'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3',
    'm15 9 6-6',
  ],

  // repeat
  loop: [
    'm17 2 4 4-4 4',
    'M3 11v-1a4 4 0 0 1 4-4h14',
    'm7 22-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ],

  // clock
  durableWait: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2'],

  // user-check
  approval: [
    'm16 11 2 2 4-4',
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  ],

  // mail
  emailSend: [
    'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z',
    'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7',
  ],

  // code
  codeStep: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
};

export function NodeIcon({ kind, tone }: { kind: NodeKind; tone: Tone }) {
  return (
    <span className="node-icon" data-tone={tone}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {PATHS[kind].map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    </span>
  );
}
