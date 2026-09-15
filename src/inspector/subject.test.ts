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
import type { Run, Step } from '../runs/rows.js';
import type { SeeView } from '../runs/view.js';
import { liveRun } from '../test-support/runs.js';
import { shortRunId } from '../webview/ids.js';
import { fine } from '../webview/time.js';

import {
  inspectorInit,
  type RunDocument,
  type StartRefusal,
} from './subject.js';

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

/** A clock the specs hold still. */
const NOW = 50_000;

/** Whether a replay from the start is on offer:
 *  it is, unless a case says otherwise. */
const OFFERED: StartRefusal = () => undefined;

/** A canvas on groom_booking, as its session
 *  answers. */
function canvas(over: Partial<SubjectInputs> = {}): SubjectInputs {
  return {
    file: 'groom_booking.workflow.json',
    path: '/work/grooming/.mboss/workflows/groom_booking.workflow.json',
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
    expect(
      inspectorInit({ at: 'canvas', startRefusal: OFFERED, canvas: canvas() })
        .subject,
    ).toEqual({
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
        now: NOW,
        startRefusal: OFFERED,
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
        startRefusal: OFFERED,
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
        startRefusal: OFFERED,
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
        startRefusal: OFFERED,
        canvas: canvas({ selected: 'find_slot', revision: undefined }),
      }).subject,
    ).toMatchObject({ at: 'block', block: { revision: undefined } });
  });

  it('is about nothing but the file where the document does not read', () => {
    expect(
      inspectorInit({
        at: 'canvas',
        startRefusal: OFFERED,
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
    return inspectorInit({
      at: 'run',
      reading: tab,
      inspected,
      document,
      now: NOW,
      startRefusal: OFFERED,
    }).subject;
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

  it('is about the whole run while no block is picked', () => {
    expect(subject(reading({ selectedNode: undefined }))).toMatchObject({
      at: 'run',
      run: { source: 'run', workflowId: 'wf_1' },
    });
  });
});

/**
 * A whole run, when one is in front and nothing of
 * it is picked.
 *
 * The run tab has read the ledger for the run, so
 * it can say what a recovery cost, where the run
 * was replayed from and to, and what the last
 * replay did. A canvas follows a run tick by tick
 * and has read none of that, so its card says
 * nothing about any of it rather than something
 * made up.
 */
describe('a run with nothing picked', () => {
  const ID = '7089cd29-881b-4319-a16d-1af70cc1e9a7';

  const RUN: Run = {
    workflowId: ID,
    name: 'groom_booking',
    status: 'SUCCESS',
    recoveryAttempts: 1,
    executorId: 'local-dev',
    applicationVersion: '1',
    createdAt: 1000,
    startedAt: 1000,
    completedAt: 2600,
    error: undefined,
    forkedFrom: undefined,
    wasForkedFrom: false,
  };

  function step(functionId: number, from: number, to: number): Step {
    return {
      functionId,
      name: `step_${String(functionId)}`,
      startedAt: from,
      completedAt: to,
      output: '{}',
      error: undefined,
      childWorkflowId: undefined,
    };
  }

  /** The run tab over that run, nothing picked. */
  function onRunTab(
    over: Partial<SeeView> = {},
    startRefusal: StartRefusal = OFFERED,
  ) {
    return inspectorInit({
      at: 'run',
      reading: {
        run: RUN,
        steps: [],
        selectedStep: undefined,
        note: undefined,
        ir,
        ...over,
      },
      inspected: undefined,
      document: undefined,
      now: NOW,
      startRefusal,
    }).subject;
  }

  /** The card's run, from a subject known to be
   *  about one. */
  function runOf(subject: ReturnType<typeof onRunTab>) {
    if (subject.at !== 'run') throw new Error(`about ${subject.at}`);

    return subject.run;
  }

  describe('on the run tab', () => {
    it('is the run the tab is showing, as the card says it', () => {
      expect(onRunTab()).toEqual({
        at: 'run',
        run: {
          source: 'run',
          workflowId: ID,
          short: '#7089',
          workflow: 'groom_booking',
          state: 'done',
          line: 'done · 1.6 s',
          input: undefined,
          ledger: [
            { label: 'workflow_uuid', value: ID },
            { label: 'status', value: 'SUCCESS' },
            { label: 'recovery_attempts', value: '1' },
            { label: 'executor_id', value: 'local-dev' },
            { label: 'application_version', value: '1' },
          ],
          recovery: undefined,
          lineage: [],
          controls: {
            cancel: false,
            resume: false,
            cancelledAt: undefined,
            gaveUp: false,
          },
          replayStart: true,
          replayRefused: undefined,
          note: undefined,
        },
      });
      expect(shortRunId(ID)).toBe('#7089');
    });

    it('leaves the version out of the ledger where DBOS kept none', () => {
      const run = runOf(
        onRunTab({ run: { ...RUN, applicationVersion: undefined } }),
      );

      expect(run.ledger.map((row) => row.label)).toEqual([
        'workflow_uuid',
        'status',
        'recovery_attempts',
        'executor_id',
      ]);
    });

    /**
     * The one argument a generated workflow takes,
     * not the argument array DBOS stores it in; whole
     * where it is short, and something to open where
     * it is not.
     */
    it('draws a short input inline and a long one as something to open', () => {
      const input = (value: Run['input']) =>
        runOf(onRunTab({ run: { ...RUN, input: value } })).input;
      const long = { note: 'x'.repeat(107) };

      expect(input({ shape: 'payload', value: { a: '012345678' } })).toEqual({
        kind: 'inline',
        text: '{ "a": "012345678" }',
      });
      expect(input({ shape: 'payload', value: long })).toEqual({
        kind: 'artifact',
        preview: `{ "note": "${'x'.repeat(107)}" }`,
        size: '118 B',
      });
      expect(`{ "note": "${'x'.repeat(107)}" }`).toHaveLength(121);
      expect(
        input({ shape: 'payload', value: { note: 'x'.repeat(106) } }),
      ).toEqual({ kind: 'inline', text: `{ "note": "${'x'.repeat(106)}" }` });
      expect(input({ shape: 'raw', text: 'not json' })).toEqual({
        kind: 'inline',
        text: 'not json',
      });
      expect(input({ shape: 'none' })).toBeUndefined();
    });

    /**
     * Every sentence about a recovery is worked out
     * from the rows rather than read off one, and
     * each says so.
     */
    it('says what a recovery cost, each sentence marked derived', () => {
      const recovered = { ...RUN, recoveryAttempts: 2, createdAt: 0 };
      const placed = runOf(
        onRunTab({
          run: { ...recovered, completedAt: 10_000 },
          steps: [step(0, 0, 1000), step(1, 1000, 2000), step(2, 8000, 9000)],
        }),
      );
      const unplaced = runOf(
        onRunTab({
          run: { ...recovered, completedAt: 2000 },
          steps: [step(0, 0, 1000), step(1, 1000, 2000)],
        }),
      );

      expect(placed.recovery).toEqual(
        [
          messages.runRecoveredHeading(),
          messages.runRecoveredBody(),
          messages.runRecoveredDown('6.0 s'),
          messages.runRecoveredReused(2),
        ].map((said) => `${said} · derived`),
      );
      expect(unplaced.recovery).toEqual(
        [messages.runRecoveredHeading(), messages.runRecoveredUnplaced()].map(
          (said) => `${said} · derived`,
        ),
      );
      expect(runOf(onRunTab()).recovery).toBeUndefined();
    });

    /**
     * The sentence used to say steps "came back
     * instead of running again", which reads as
     * though DBOS decided not to execute something.
     * What happened is narrower, and the gap is an
     * inference rather than a moment anything wrote
     * down.
     */
    it('says what a recovery cost without claiming code was skipped', () => {
      const [heading, body] =
        runOf(
          onRunTab({
            run: {
              ...RUN,
              recoveryAttempts: 2,
              createdAt: 0,
              completedAt: 10_000,
            },
            steps: [step(0, 0, 1000), step(1, 1000, 2000), step(2, 8000, 9000)],
          }),
        ).recovery ?? [];

      expect(heading).toBe(
        'Recovered — completed durable operations were not re-executed' +
          ' · derived',
      );
      expect(body).toContain('derived from the widest gap');
      expect(body).toContain('rather than run again');
      expect(body).not.toContain('instead of running again');
    });

    /** Dead-lettering writes no error row, so how many
     *  times DBOS restarted it is what there is to say. */
    it('says how many restarts DBOS gave up after', () => {
      const run = runOf(
        onRunTab({
          run: {
            ...RUN,
            status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
            recoveryAttempts: 4,
          },
        }),
      );

      expect(run.recovery).toEqual([
        'DBOS stopped restarting it after 3 restarts · derived',
      ]);
      expect(run.controls.gaveUp).toBe(true);
      expect(run.line).toBe('gave up · 1.6 s');
    });

    it('names the run it was replayed from, then each replay of it', () => {
      const run = runOf(
        onRunTab({
          lineage: {
            parent: {
              run: { ...RUN, workflowId: 'wf_parent' },
              startStep: 3,
              boundary: 'Find a slot',
            },
            forks: [
              {
                run: { ...RUN, workflowId: 'wf_fork1' },
                startStep: 2,
                boundary: undefined,
              },
              {
                run: { ...RUN, workflowId: 'wf_fork2', status: 'ERROR' },
                startStep: 4,
                boundary: 'Book it',
              },
            ],
          },
        }),
      );

      expect(run.lineage).toEqual([
        {
          direction: 'of',
          workflowId: 'wf_parent',
          short: shortRunId('wf_parent'),
          startStep: 3,
        },
        {
          direction: 'to',
          workflowId: 'wf_fork1',
          short: shortRunId('wf_fork1'),
          startStep: 2,
          word: 'done',
        },
        {
          direction: 'to',
          workflowId: 'wf_fork2',
          short: shortRunId('wf_fork2'),
          startStep: 4,
          word: 'failed',
        },
      ]);
      expect(
        runOf(onRunTab({ lineage: { parent: undefined, forks: [] } })).lineage,
      ).toEqual([]);
    });

    it('offers Cancel while it is going, and Resume once it stopped', () => {
      const going = runOf(
        onRunTab({
          run: { ...RUN, status: 'PENDING', completedAt: undefined },
        }),
      );
      const stopped = runOf(
        onRunTab({
          run: { ...RUN, status: 'CANCELLED' },
          cancelledHere: true,
        }),
      );

      expect(going.controls).toEqual({
        cancel: true,
        resume: false,
        cancelledAt: undefined,
        gaveUp: false,
      });
      expect(stopped.controls).toEqual({
        cancel: false,
        resume: true,
        cancelledAt: messages.runCancelledByYou(fine(2600)),
        gaveUp: false,
      });
    });

    it('offers a replay from the start, or says why not', () => {
      const asked: unknown[][] = [];
      const skewed = messages.replaySdkMajor('4.27.6', '5.1.0');
      const refused = runOf(
        onRunTab({}, (...question) => {
          asked.push(question);

          return skewed;
        }),
      );

      expect(refused).toMatchObject({
        replayStart: false,
        replayRefused: skewed,
      });
      expect(asked).toEqual([['groom_booking', ir]]);
      expect(runOf(onRunTab())).toMatchObject({
        replayStart: true,
        replayRefused: undefined,
      });
    });

    it('says what the last replay did', () => {
      const said = messages.replayRefused('no such run');

      expect(runOf(onRunTab({ note: said })).note).toBe(said);
    });

    /**
     * Which of the two controls is on offer is the
     * status column's answer and nothing else's:
     * DBOS's own statements leave `SUCCESS` and
     * `ERROR` alone, cancel is meaningless once a run
     * has stopped, and resume is meaningless while
     * one is still going. So the card offers at most
     * one of them, ever.
     *
     * "by you" is this window's own memory of having
     * asked. Nothing is written down anywhere, and the
     * card says it only when it is told to.
     */
    describe('the two controls over the run', () => {
      function controls(over: Partial<Run>, view: Partial<SeeView> = {}) {
        return runOf(onRunTab({ run: { ...RUN, ...over }, ...view })).controls;
      }

      const IN_FLIGHT = ['PENDING', 'ENQUEUED', 'DELAYED'];
      const RESUMABLE = ['CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED'];
      const OVER = ['SUCCESS', 'ERROR'];

      it('offers Cancel while a run is pending, enqueued or delayed', () => {
        for (const status of IN_FLIGHT) {
          expect({
            status,
            ...controls({ status, completedAt: undefined }),
          }).toMatchObject({ status, cancel: true });
        }

        for (const status of [...RESUMABLE, ...OVER]) {
          expect({ status, ...controls({ status }) }).toMatchObject({
            status,
            cancel: false,
          });
        }
      });

      /**
       * A run DBOS gave up recovering is the other
       * run resume is for: its statement leaves only
       * `SUCCESS` and `ERROR` alone, and picking one
       * of those back up would be offering to restart
       * a run that is over.
       */
      it('offers Resume only on a cancelled or exhausted run', () => {
        for (const status of RESUMABLE) {
          expect({ status, ...controls({ status }) }).toMatchObject({
            status,
            resume: true,
          });
        }

        for (const status of [...IN_FLIGHT, ...OVER]) {
          expect({ status, ...controls({ status }) }).toMatchObject({
            status,
            resume: false,
          });
        }
      });

      it('never offers both', () => {
        for (const status of [...IN_FLIGHT, ...RESUMABLE, ...OVER]) {
          const offered = controls({ status });

          expect(offered.cancel && offered.resume).toBe(false);
        }
      });

      /**
       * Window memory, and it says so. Nothing is
       * persisted: a run this window cancelled is
       * "by you" until the window closes, and a run
       * cancelled from a terminal or by somebody else
       * carries the time alone however it got that
       * way.
       */
      it('says "by you" only when told', () => {
        const mine = controls({ status: 'CANCELLED' }, { cancelledHere: true });
        const theirs = controls({ status: 'CANCELLED' });

        expect(mine.cancelledAt).toContain('by you');
        expect(theirs.cancelledAt).not.toContain('by you');
        expect(theirs.cancelledAt).toBeTypeOf('string');
      });

      it('says nothing about a cancellation on a run nobody cancelled', () => {
        expect(controls({ status: 'ERROR' }).cancelledAt).toBeUndefined();
      });
    });
  });

  describe('followed on a canvas', () => {
    /** The canvas in front, following a run, with
     *  nothing selected. */
    function onCanvas(
      over: Parameters<typeof liveRun>[0] = {},
      startRefusal: StartRefusal = OFFERED,
    ) {
      return inspectorInit({
        at: 'canvas',
        startRefusal,
        canvas: canvas({
          mode: 'evidence',
          run: liveRun({ workflowId: ID, workflow: 'groom_booking', ...over }),
        }),
      }).subject;
    }

    it('says nothing of what only the run tab reads, recovered or not', () => {
      expect(
        onCanvas({
          status: 'SUCCESS',
          outcome: 'done',
          recovered: true,
          recoveryAttempts: 2,
          applicationVersion: '1',
          completedAt: 2600,
          recordedInput: { shape: 'payload', value: { orderId: 'ord_123' } },
        }),
      ).toEqual({
        at: 'run',
        run: {
          source: 'canvas',
          workflowId: ID,
          short: '#7089',
          workflow: 'groom_booking',
          state: 'done',
          line: 'done · 1.6 s · ↻ recovered',
          input: { kind: 'inline', text: '{ "orderId": "ord_123" }' },
          ledger: [
            { label: 'workflow_uuid', value: ID },
            { label: 'status', value: 'SUCCESS' },
            { label: 'recovery_attempts', value: '2' },
            { label: 'executor_id', value: 'local-dev' },
            { label: 'application_version', value: '1' },
          ],
          recovery: undefined,
          lineage: [],
          controls: {
            cancel: false,
            resume: false,
            cancelledAt: undefined,
            gaveUp: false,
          },
          replayStart: true,
          replayRefused: undefined,
          note: undefined,
        },
      });
    });

    it('offers Cancel while it is going, and Resume once it stopped', () => {
      const going = runOf(onCanvas({ status: 'PENDING' }));
      const stopped = runOf(
        onCanvas({
          status: 'CANCELLED',
          outcome: 'cancelled',
          completedAt: 2600,
        }),
      );

      expect(going.controls.cancel).toBe(true);
      expect(stopped.controls).toEqual({
        cancel: false,
        resume: true,
        cancelledAt: fine(2600),
        gaveUp: false,
      });
    });

    it('refuses a replay from the start where the SDK is skewed', () => {
      const asked: unknown[][] = [];
      const skewed = messages.replaySdkMajor('4.27.6', '5.1.0');

      expect(
        onCanvas({}, (...question) => {
          asked.push(question);

          return skewed;
        }),
      ).toMatchObject({
        at: 'run',
        run: { replayStart: false, replayRefused: skewed },
      });
      expect(asked).toEqual([['groom_booking', ir]]);
    });

    /**
     * A watch that let go says `quiet`, which is the
     * watch's word rather than the run's. It lets go
     * only of a run still moving — a parked one stops
     * it at `waiting` — so the status it last read
     * still says which word that was.
     */
    it('says the run’s own word once its watch has let go', () => {
      expect(
        onCanvas({ status: 'PENDING', recoveryAttempts: 2, outcome: 'quiet' }),
      ).toMatchObject({
        at: 'run',
        run: { state: 'recovering', line: 'recovering' },
      });
    });

    it('is about the block, not the run, once one is selected', () => {
      expect(
        inspectorInit({
          at: 'canvas',
          startRefusal: OFFERED,
          canvas: canvas({
            selected: 'find_slot',
            run: liveRun({ workflow: 'groom_booking' }),
          }),
        }).subject,
      ).toMatchObject({ at: 'block' });
    });
  });
});
