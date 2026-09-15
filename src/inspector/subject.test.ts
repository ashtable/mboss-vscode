import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
import {
  WorkflowIRSchema,
  validateWorkflow,
  type LibManifest,
  type WorkflowIR,
} from '../core/rules.js';
import { messages } from '../messages.js';
import type { Run } from '../runs/rows.js';
import type { SeeView } from '../runs/view.js';
import { liveRun } from '../test-support/runs.js';

import { inspectorInit, type RunDocument } from './subject.js';

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
    expect(
      inspectorInit({
        at: 'run',
        reading: undefined,
        inspected: undefined,
        document: undefined,
      }).subject,
    ).toEqual({ at: 'none', file: undefined });
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
        proposal: undefined,
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

/**
 * A block picked on the run tab.
 *
 * What the run recorded is the run tab's, and what
 * the block is set to do is the document's, read
 * where an edit would land: the canvas open on it,
 * or the document itself where none is. The run tab
 * holds only the copy it read off disk when the run
 * was opened, and an edit made against that copy
 * would be refused as stale the moment the first
 * one landed.
 */
describe('a block picked on the run tab', () => {
  /** The document at one revision. */
  function at(revision: number, document: WorkflowIR = ir): WorkflowIR {
    return { ...document, revision };
  }

  const RUN: Run = {
    workflowId: 'wf_1',
    name: 'groom_booking',
    status: 'SUCCESS',
    recoveryAttempts: 1,
    executorId: 'local-dev',
    applicationVersion: 'v0.1.0',
    createdAt: 1000,
    startedAt: 1000,
    completedAt: 9000,
    error: undefined,
    forkedFrom: undefined,
    wasForkedFrom: false,
  };

  /** The run tab over that run, read off disk at
   *  revision 7, with a block picked. */
  function reading(over: Partial<SeeView> = {}): SeeView {
    return {
      run: RUN,
      steps: [],
      selectedStep: undefined,
      note: undefined,
      ir: at(7),
      selectedNode: 'find_slot',
      ...over,
    };
  }

  /** The document with no canvas open on it. */
  function buffer(over: Partial<RunDocument> = {}): RunDocument {
    return {
      at: 'buffer',
      file: 'groom_booking.workflow.json',
      text: JSON.stringify(at(7)),
      manifest: undefined,
      proposedBy: undefined,
      ...over,
    } as RunDocument;
  }

  const inspected = {
    run: liveRun({ workflowId: 'wf_1', workflow: 'groom_booking' }),
    decided: { slot_open: 'yes' },
  };

  /** What the pane is about, with that in front. */
  function subject(tab: SeeView, document: RunDocument = buffer()) {
    return inspectorInit({ at: 'run', reading: tab, inspected, document })
      .subject;
  }

  it('is that block, drawn from the document and the run', () => {
    // A document with a wire missing, so what the
    // rules find in it is something.
    const document = { ...at(8), edges: ir.edges.slice(1) };
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../mboss-core/fixtures/golden/manifest/lib.manifest.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    ) as LibManifest;

    expect(
      subject(
        reading({ selectedStep: 3 }),
        buffer({ text: JSON.stringify(document), manifest }),
      ),
    ).toEqual({
      at: 'block',
      block: {
        source: 'run',
        file: 'groom_booking.workflow.json',
        workflow: 'groom_booking',
        ir: document,
        revision: 8,
        nodeId: 'find_slot',
        face: 'evidence',
        manifest,
        diagnostics: validateWorkflow(document, { manifest }),
        paletteLabels: paletteLabels(),
        kindWords: kindWords(),
        run: inspected.run,
        functionId: 3,
        decided: inspected.decided,
        runInput: undefined,
        proposal: undefined,
      },
    });
    expect(validateWorkflow(document, {})).not.toEqual([]);
  });

  it('reads the canvas open on the document, not the copy the run read', () => {
    const open: RunDocument = {
      at: 'canvas',
      canvas: canvas({ read: { ok: true, ir: at(9) }, revision: 9 }),
      proposedBy: undefined,
    };

    expect(subject(reading(), open)).toMatchObject({
      at: 'block',
      block: { revision: 9, ir: { revision: 9 } },
    });
  });

  it('reads the document where no canvas has it open', () => {
    expect(
      subject(reading(), buffer({ text: JSON.stringify(at(8)) })),
    ).toMatchObject({
      at: 'block',
      block: { revision: 8, ir: { revision: 8 } },
    });
  });

  /**
   * An agent's proposal is waiting on the document,
   * so nothing may be edited until somebody answers
   * it — and the pane says so in the sentence the
   * canvas shows over one.
   */
  it('holds the revision back while a proposal waits, and says whose', () => {
    expect(
      subject(reading(), buffer({ proposedBy: 'claude code' })),
    ).toMatchObject({
      at: 'block',
      block: {
        revision: undefined,
        proposal: messages.previewHeadline('claude code'),
      },
    });
    expect(
      subject(reading(), {
        at: 'canvas',
        canvas: canvas({ revision: undefined }),
        proposedBy: 'codex',
      }),
    ).toMatchObject({
      at: 'block',
      block: {
        revision: undefined,
        proposal: messages.previewHeadline('codex'),
      },
    });
    expect(subject(reading())).toMatchObject({
      at: 'block',
      block: { revision: 7, proposal: undefined },
    });
  });

  it('opens on Run evidence, and on Configure once somebody picks it', () => {
    expect(subject(reading())).toMatchObject({
      block: { face: 'evidence' },
    });
    expect(subject(reading({ selectedStep: 2 }))).toMatchObject({
      block: { face: 'evidence' },
    });
    expect(subject(reading({ face: 'configure' }))).toMatchObject({
      block: { face: 'configure' },
    });
  });

  /** A block the document no longer has has nothing
   *  to configure; what the run recorded about it is
   *  still there to read. */
  it('stays on Run evidence for a block the document no longer has', () => {
    expect(
      subject(reading({ selectedNode: 'deleted_block', face: 'configure' })),
    ).toMatchObject({
      at: 'block',
      block: { nodeId: 'deleted_block', face: 'evidence', ir: at(7) },
    });
  });

  it('names the row that was picked, and no other', () => {
    expect(subject(reading({ selectedStep: 3 }))).toMatchObject({
      block: { functionId: 3 },
    });
    expect(subject(reading())).toMatchObject({
      block: { functionId: undefined },
    });
  });

  it('is about nothing but the file where the document does not read', () => {
    expect(subject(reading(), buffer({ text: '{ not json' }))).toEqual({
      at: 'none',
      file: 'groom_booking.workflow.json',
    });
    expect(subject(reading(), buffer({ text: undefined }))).toEqual({
      at: 'none',
      file: 'groom_booking.workflow.json',
    });
  });

  it('is about nothing while no block is picked', () => {
    expect(subject(reading({ selectedNode: undefined }))).toEqual({
      at: 'none',
      file: undefined,
    });
  });
});
