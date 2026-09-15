import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { liveRun } from '../test-support/runs.js';

import { inspectorInit } from './subject.js';

/**
 * What the Inspector draws, worked out from what
 * the surface in front holds.
 *
 * Pure on purpose: the surfaces are a canvas
 * session and the run page, and both are asked
 * here as the plain data they answer with, so each
 * rule is one call and one expectation.
 */

const ir = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../mboss-core/fixtures/ir/groom_booking.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

/** A canvas on groom_booking, as its session
 *  answers. */
function canvas(over: Partial<SubjectInputs> = {}): SubjectInputs {
  return {
    file: 'groom_booking.workflow.json',
    workflow: 'groom_booking',
    read: { ok: true, ir },
    revision: ir.revision,
    manifest: undefined,
    diagnostics: [],
    selected: undefined,
    mode: 'configure',
    run: undefined,
    decided: {},
    ...over,
  };
}

describe('what the Inspector is about', () => {
  it('is about nothing when nothing has focus', () => {
    expect(inspectorInit({ at: 'none' })).toEqual({
      type: 'init',
      view: 'inspector',
      strings: inspectorWords(),
      subject: { at: 'none', file: undefined },
    });
  });

  it('names the file of a canvas with nothing selected', () => {
    expect(inspectorInit({ at: 'canvas', canvas: canvas() }).subject).toEqual({
      at: 'none',
      file: 'groom_booking.workflow.json',
    });
  });

  it('is about nothing on a run tab that is showing no run', () => {
    expect(inspectorInit({ at: 'run', reading: undefined }).subject).toEqual({
      at: 'none',
      file: undefined,
    });
  });
});

describe('a block selected on a canvas', () => {
  it('is that block, on Configure, with no run in focus', () => {
    const diagnostics = [
      {
        code: 'V05' as const,
        severity: 'error' as const,
        nodeId: 'find_slot',
        message: 'a finding the canvas reported',
      },
    ];
    const manifest = { functions: [], types: {} } as never;

    expect(
      inspectorInit({
        at: 'canvas',
        canvas: canvas({
          selected: 'find_slot',
          manifest,
          diagnostics,
          decided: { slot_open: 'yes' },
        }),
      }).subject,
    ).toEqual({
      at: 'block',
      block: {
        source: 'canvas',
        file: 'groom_booking.workflow.json',
        workflow: 'groom_booking',
        ir,
        revision: ir.revision,
        nodeId: 'find_slot',
        face: 'configure',
        manifest,
        diagnostics,
        paletteLabels: paletteLabels(),
        kindWords: kindWords(),
        run: undefined,
        functionId: undefined,
        decided: { slot_open: 'yes' },
        runInput: undefined,
      },
    });
  });

  it('carries the face the canvas holds, and its run', () => {
    const run = liveRun({ workflow: 'groom_booking' });

    expect(
      inspectorInit({
        at: 'canvas',
        canvas: canvas({ selected: 'find_slot', mode: 'evidence', run }),
      }).subject,
    ).toMatchObject({ at: 'block', block: { face: 'evidence', run } });
  });

  /**
   * Nothing is editable over a draft, and the
   * canvas says so by holding no revision; the
   * block is still the one to draw.
   */
  it('carries no revision where the canvas may not be edited', () => {
    expect(
      inspectorInit({
        at: 'canvas',
        canvas: canvas({ selected: 'find_slot', revision: undefined }),
      }).subject,
    ).toMatchObject({ at: 'block', block: { revision: undefined } });
  });

  /**
   * What a run did as a whole is not a block, and
   * the pane has nothing of its own to say about it
   * yet, so it waits on the file like any canvas
   * with nothing picked.
   */
  it('waits on the file while a followed run has nothing selected', () => {
    expect(
      inspectorInit({
        at: 'canvas',
        canvas: canvas({
          mode: 'evidence',
          run: liveRun({ workflow: 'groom_booking' }),
        }),
      }).subject,
    ).toEqual({ at: 'none', file: 'groom_booking.workflow.json' });
  });

  it('is about nothing but the file where the document does not read', () => {
    expect(
      inspectorInit({
        at: 'canvas',
        canvas: canvas({
          read: { ok: false, detail: 'Unexpected token' },
          revision: undefined,
          selected: 'find_slot',
        }),
      }).subject,
    ).toEqual({ at: 'none', file: 'groom_booking.workflow.json' });
  });
});
