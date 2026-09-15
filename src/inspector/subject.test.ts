import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords } from '../canvas/words.js';
import { WorkflowIRSchema } from '../core/rules.js';

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
