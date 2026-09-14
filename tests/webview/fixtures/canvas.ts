import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { snap } from '../../../src/canvas/grid.js';
import { layoutKeyOf } from '../../../src/canvas/placement.js';
import {
  WorkflowIRSchema,
  validateWorkflow,
  type LibManifest,
} from '../../../src/core/rules.js';
import type { CanvasInit } from '../../../src/webview/protocol.js';

import { mount, type ThemeKind } from '../harness.js';
import { canvasWords, inspectorWords, paletteLabels } from '../words.js';

/**
 * The canvas, as the host would send it.
 *
 * More than one spec drives this view — the canvas's
 * own, and the shared-component one, which needs a
 * real surface to read a component off — and
 * Playwright refuses a spec that imports another, so
 * the message they both send lives here. Two copies
 * of it would drift, and a component spec reading a
 * canvas nobody else draws proves nothing about the
 * canvas.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../mboss-core/fixtures/${name}`, import.meta.url),
      ),
      'utf8',
    ),
  );
}

export const ir = WorkflowIRSchema.parse(
  fixture('ir/groom_booking.workflow.json'),
);

/**
 * The fixture's own layout, on the grid.
 *
 * The engine spaces a graph on numbers of its own,
 * none of them the canvas's, and the host rounds
 * what it computed onto this grid before sending it.
 * A graph arriving any other way is one this canvas
 * never sees — and a block half a square off the
 * grid moves diagonally the first time somebody
 * nudges it.
 */
export const boxes: CanvasInit['boxes'] = Object.fromEntries(
  Object.entries(
    fixture('golden/layout/groom_booking.layout.json') as CanvasInit['boxes'],
  ).map(([id, box]) => [id, { ...box, x: snap(box.x), y: snap(box.y) }]),
);

export const manifest = fixture(
  'golden/manifest/lib.manifest.json',
) as LibManifest;

export function canvasInit(over: Partial<CanvasInit> = {}): CanvasInit {
  const shown = { document: { ok: true, ir } as CanvasInit['document'], boxes };
  const drawn = { ...shown, ...over };

  return {
    type: 'init',
    view: 'canvas',
    strings: canvasWords,
    paletteLabels,
    kindWords: canvasWords.kinds,
    triggerPhrases: canvasWords.triggerPhrases,
    ...shown,

    // Worked out the way the host works it out, so a
    // spec that shows a different graph gets a
    // different key without having to say so.
    layoutKey: drawn.document.ok
      ? layoutKeyOf(drawn.document.ir, drawn.boxes)
      : '',
    // Editable exactly when the document parsed and
    // nothing is proposed, the way the host says it.
    editing:
      drawn.document.ok && over.preview === undefined
        ? { revision: drawn.document.ir.revision }
        : undefined,
    diagnostics: validateWorkflow(ir, { manifest }),
    manifest,
    inspector: {
      strings: inspectorWords,
      selected: undefined,
      mode: 'configure',
    },
    preview: undefined,
    run: undefined,
    decided: {},
    ...over,
  };
}

/** The graph, on a page, showing the canonical
 *  fixture. */
export async function openCanvas(page: Page, theme: ThemeKind = 'light') {
  const harness = await mount(page, 'canvas', theme);
  await harness.show(canvasInit());

  return harness;
}
