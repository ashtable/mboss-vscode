import { describe, expect, it } from 'vitest';

import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { SeeRun } from '../webview/protocol.js';

import type { Run, Step } from './rows.js';
import type { SessionRun } from './sessionLog.js';
import { rowOf, seeInit, sessionRowOf, type SeeView } from './view.js';
import type { ProjectWorkflow } from './workflows.js';

/**
 * The two init messages, as words.
 *
 * A webview has no localization bundle and may draw
 * no string the host did not resolve, so everything
 * a person reads in either surface is composed
 * here. The arithmetic that decides *where* a bar
 * goes is here too, because the panel is resizable
 * and the host has no idea how wide it is — so what
 * travels is fractions of a window rather than
 * pixels.
 */

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recoveryAttempts: 2,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 0,
  startedAt: 0,
  completedAt: 10_000,
  error: undefined,
  forkedFrom: undefined,
  wasForkedFrom: false,
};

function step(functionId: number, from: number, to: number): Step {
  return {
    functionId,
    name: `step_${functionId}`,
    startedAt: from,
    completedAt: to,
    output: `{"n":${functionId}}`,
    error: undefined,
    childWorkflowId: undefined,
  };
}

const STEPS = [step(0, 0, 1000), step(1, 1000, 2000), step(2, 8000, 9000)];

const WORKFLOWS: ProjectWorkflow[] = [
  {
    name: 'groom_booking',
    title: 'Groom booking',
    trigger: { mode: 'manual' },
    path: `/tmp/.mboss/workflows/groom_booking.workflow.json`,
  },
  {
    name: 'expense_claim',
    title: 'Expense claim',
    trigger: { mode: 'event', topic: 'expense.filed', keyPath: 'claimId' },
    path: `/tmp/.mboss/workflows/expense_claim.workflow.json`,
  },
  // An event workflow that names no key: every
  // send of it is a run of its own.
  {
    name: 'door_opened',
    title: 'Door opened',
    trigger: { mode: 'event', topic: 'door.opened' },
    path: `/tmp/.mboss/workflows/door_opened.workflow.json`,
  },
  // Listed so a person can see it exists; not
  // started by hand.
  {
    name: 'nightly_sweep',
    title: 'Nightly sweep',
    trigger: { mode: 'schedule' },
    path: `/tmp/.mboss/workflows/nightly_sweep.workflow.json`,
  },
];

const SESSION: SessionRun = {
  workflowId: 'run_1_a1b2',
  workflow: 'groom_booking',
  input: { bookingId: 7 },
  startedAt: 0,
  outcome: 'done',
  durationMs: 8200,
  stepCount: 3,
  recovered: false,
  via: 'start',
};

describe('a row of the run history', () => {
  it('names a run by the workflow it is a run of', () => {
    const row = rowOf(RUN);

    expect(row.workflowId).toBe('wf_c9d2f3');
    expect(row.name).toBe('groom_booking');
  });

  /**
   * The clock is the user's, not the design's: the
   * mockups are drawn in 24-hour time and an editor
   * that ignored somebody's own convention for
   * telling it would be the one panel that does.
   * What is asserted is the composition.
   */
  it('says when it ran and how long it took', () => {
    expect(rowOf(RUN).when).toMatch(/^\d{1,2}:\d{2}.* · 10\.0 s$/);
  });

  it('leaves the duration off a run that is still going', () => {
    expect(
      rowOf({ ...RUN, status: 'PENDING', completedAt: undefined }).when,
    ).not.toContain('·');
  });

  /**
   * The three the design names, and a run can match
   * two of them: recovering is a thing that
   * happened during a run, not a way one ended.
   */
  it('marks a run that recovered, whatever it went on to do', () => {
    const row = rowOf(RUN);

    expect(row.severity).toBe('ok');
    expect(row.recovered).toBe(true);
  });

  /**
   * The tag says a run recovered; the number is
   * worth its space only past the first crash. It
   * also keeps the sentence grammatical, which one
   * without plural forms otherwise would not be
   * for the commonest case there is.
   */
  it('counts the crashes only once there is more than one', () => {
    expect(rowOf(RUN).recoveredNote).toBeUndefined();
    expect(rowOf({ ...RUN, recoveryAttempts: 3 }).recoveredNote).toBe(
      'recovered from 2 crashes',
    );
  });

  it('draws a failure loudly and says what it was', () => {
    const row = rowOf({ ...RUN, status: 'ERROR', error: 'login failed' });

    expect(row.severity).toBe('failed');
    expect(row.error).toBe('login failed');
  });

  /**
   * A run DBOS gave up on is not the same news as a
   * run that threw: one is a bug to read, the other
   * is a loop somebody has to break. No mockup
   * draws it, so it gets its own severity rather
   * than being folded in with the ordinary
   * failures.
   */
  it('tells a run DBOS gave up on apart from one that threw', () => {
    const row = rowOf({ ...RUN, status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' });

    expect(row.severity).toBe('exhausted');
    expect(row.status).toBe('MAX_RECOVERY_ATTEMPTS_EXCEEDED');
  });

  /**
   * And a run somebody stopped is not news about the
   * code at all. It stays under Failed, because that
   * filter is DBOS's own partial index and the
   * status word on the row says which of the three it
   * was — but it is drawn as its own thing, since
   * nobody has to go and look into it.
   */
  it('tells a run somebody cancelled apart from one that failed', () => {
    const row = rowOf({ ...RUN, status: 'CANCELLED' });

    expect(row.severity).toBe('cancelled');
    expect(row.status).toBe('CANCELLED');
    expect(rowOf({ ...RUN, status: 'ERROR' }).severity).toBe('failed');
  });

  it('draws a run that has not finished as still going', () => {
    for (const status of ['PENDING', 'ENQUEUED', 'DELAYED']) {
      expect(rowOf({ ...RUN, status }).severity).toBe('running');
    }
  });

  it('names what a run is a replay of', () => {
    const row = rowOf({ ...RUN, forkedFrom: 'wf_a1b4e7' });

    expect(row.replayOf).toBe('replay of wf_a1b4e7');
    expect(rowOf(RUN).replayOf).toBeUndefined();
  });

  /**
   * Out of the runs the page already holds and out
   * of nothing else. `forked_from` is a column every
   * row selects, so a child that is on screen is a
   * line the list can draw for free — and a child
   * that is not is a query nobody asked for.
   */
  it('names the runs replayed from it that are on this page', () => {
    const parent = { ...RUN, wasForkedFrom: true };
    const child = {
      ...RUN,
      workflowId: 'wf_fork1',
      status: 'ERROR',
      forkedFrom: 'wf_c9d2f3',
    };

    expect(rowOf(parent, [parent, child]).forks).toEqual([
      '└ replay → wf_fork1 · failed',
    ]);
    expect(rowOf(parent, [parent]).forks).toEqual([]);
  });
});

describe('a row of what this window set going', () => {
  it('says how long a finished run took, and nothing for one going', () => {
    expect(sessionRowOf(SESSION, WORKFLOWS).when).toContain('8.2 s');
    expect(
      sessionRowOf({ ...SESSION, durationMs: undefined }, WORKFLOWS).when,
    ).not.toContain('·');
  });

  /**
   * Which of the two actions a row offers is a
   * fact about the workflow's trigger rather than
   * about the run: sending the same input again is
   * the same run only where the route mints the id
   * from it.
   */
  it('marks the rows whose input decides the run', () => {
    expect(sessionRowOf(SESSION, WORKFLOWS).keyed).toBe(false);
    expect(
      sessionRowOf({ ...SESSION, workflow: 'expense_claim' }, WORKFLOWS).keyed,
    ).toBe(true);

    // An event is not enough on its own: without a
    // key path the route mints a fresh id, so
    // sending it again is another run.
    expect(
      sessionRowOf({ ...SESSION, workflow: 'door_opened' }, WORKFLOWS).keyed,
    ).toBe(false);
  });

  /**
   * Both actions on a session row send the input
   * the row was started with, and a row this window
   * did not start has none — a fork carries the
   * input of the run it came from, which lives in
   * the ledger. So how the run got here is what the
   * panel draws the actions from, and the only one
   * left on such a row is the one that opens it.
   */
  it('offers only Open run on a replayed session row', () => {
    const row = sessionRowOf(
      {
        ...SESSION,
        workflow: 'expense_claim',
        input: undefined,
        via: 'replay',
      },
      WORKFLOWS,
    );

    // `keyed` is a fact about the workflow's trigger
    // and stays true for a fork of one, so `via` is
    // the only thing that can keep Send the event
    // again off this row.
    expect(row.keyed).toBe(true);
    expect(row.via).toBe('replay');
  });

  it('offers only Open run on a resumed session row', () => {
    expect(
      sessionRowOf({ ...SESSION, input: undefined, via: 'resume' }, WORKFLOWS)
        .via,
    ).toBe('resume');
    expect(sessionRowOf(SESSION, WORKFLOWS).via).toBe('start');
  });

  /** One field, whether a step threw or the
   *  ingress refused to start it at all. */
  it('carries whichever failure the row has', () => {
    expect(
      sessionRowOf(
        {
          ...SESSION,
          outcome: 'failed',
          failedStep: { name: 'find_slot', error: 'CDC_PASS rotated' },
        },
        WORKFLOWS,
      ).error,
    ).toBe('CDC_PASS rotated');
    expect(
      sessionRowOf(
        { ...SESSION, outcome: 'failed', error: 'the app is not up' },
        WORKFLOWS,
      ).error,
    ).toBe('the app is not up');
  });
});

describe('one run in detail', () => {
  const init = seeInit({
    run: RUN,
    steps: STEPS,
    selectedStep: 2,
    note: undefined,
  });
  const run = init.run;

  it('is addressed to the view that draws it', () => {
    expect(init.view).toBe('see');
  });

  it('says what it is and how long it took', () => {
    expect(run?.headline).toBe('SUCCESS · 10.0 s total');
    expect(run?.breadcrumb).toBe('mBoss › runs › groom_booking › wf_c9d2f3');
  });

  /**
   * The exact four rows the design asks for. They
   * are the run as Postgres holds it, which is what
   * the line under them says.
   */
  it('shows the ledger the design names, row for row', () => {
    expect(run?.rail.map((row) => row.label)).toEqual([
      'workflow_uuid',
      'status',
      'recovery_attempts',
      'executor_id',
      'application_version',
    ]);

    expect(run?.rail.map((row) => row.value)).toEqual([
      'wf_c9d2f3',
      'SUCCESS',
      '2',
      'local-dev',
      'v0.4.1',
    ]);
  });

  it('leaves out a column DBOS never filled in', () => {
    const bare = seeInit({
      run: { ...RUN, applicationVersion: undefined },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
    });

    expect(bare.run?.rail.map((row) => row.label)).not.toContain(
      'application_version',
    );
  });

  /**
   * `<step> ✓` against `<step> ✓ restored` is the
   * one distinction this whole view exists to draw,
   * and the word is the host's because a webview
   * shows none of its own.
   */
  it('marks the steps that came back from Postgres', () => {
    expect(run?.chips.map((chip) => chip.restored)).toEqual([
      true,
      true,
      false,
    ]);
    expect(init.strings.restored).toBe('restored');
  });

  it('draws the band across the hole nothing ran in', () => {
    expect(run?.timeline.outage).toEqual({
      from: 0.2,
      width: 0.6,
      down: 'process down · 6.0 s',
      resumed: 'resumed by DBOS',
    });
  });

  it('places every bar as a fraction of the window', () => {
    expect(run?.timeline.bars.map((bar) => bar.at)).toEqual([
      { from: 0, width: 0.1 },
      { from: 0.1, width: 0.1 },
      { from: 0.8, width: 0.1 },
    ]);
  });

  /**
   * A step DBOS has not timed is drawn without a
   * bar rather than dropped: a step missing from
   * the chart is a step nobody knows ran.
   */
  it('keeps a step it cannot place, and gives it no bar', () => {
    const untimed = {
      ...step(3, 0, 0),
      startedAt: undefined,
      completedAt: undefined,
    };
    const shown = seeInit({
      run: RUN,
      steps: [...STEPS, untimed],
      selectedStep: undefined,
      note: undefined,
    });

    expect(shown.run?.timeline.bars).toHaveLength(4);
    expect(shown.run?.timeline.bars[3]?.at).toBeUndefined();
  });

  /**
   * The chart is about what the workflow did, so
   * the SDK's own rows get no bar and no chip. The
   * hole computation still sees them, and has to:
   * a wait the SDK wrote is what fills a gap that
   * would otherwise be read as a crash.
   */
  it('draws no bar for a row the SDK wrote, and still counts it', () => {
    const slept = seeInit({
      run: RUN,
      steps: [
        step(0, 0, 1000),
        { ...step(1, 1000, 9000), name: 'DBOS.sleep' },
        step(2, 9000, 10_000),
      ],
      selectedStep: undefined,
      note: undefined,
    });

    expect(slept.run?.timeline.bars.map((bar) => bar.name)).toEqual([
      'step_0',
      'step_2',
    ]);
    expect(slept.run?.chips.map((chip) => chip.name)).toEqual([
      'step_0',
      'step_2',
    ]);
    expect(slept.run?.timeline.outage).toBeUndefined();
  });

  /**
   * Two derived numbers, each its own line so the
   * page can mark it derived beside the figure. A
   * number buried in a paragraph wears no chip, and
   * a derived number a person reads as a recorded
   * one is the whole failure mode of a flight
   * recorder.
   */
  it('says what the crash cost, out of what the ledger holds', () => {
    expect(run?.recovered?.heading).toBe(
      'Recovered — completed durable operations were not re-executed',
    );
    expect(run?.recovered?.figures?.down).toContain('6.0 s');
    expect(run?.recovered?.figures?.reused).toContain('2 durable operations');
    expect(run?.recovered?.body).not.toContain('6.0 s');
  });

  /**
   * `recovery_attempts` is a count and no column
   * holds the moment a process died, so a run whose
   * steps run straight into each other has a crash
   * that cannot be placed — and says so rather than
   * drawing a band somewhere plausible.
   */
  it('admits when it cannot say where the crash was', () => {
    const unplaced = seeInit({
      run: RUN,
      steps: [step(0, 0, 1000), step(1, 1000, 2000)],
      selectedStep: undefined,
      note: undefined,
    });

    expect(unplaced.run?.timeline.outage).toBeUndefined();
    expect(unplaced.run?.recovered?.body).toContain('too closely together');

    // Nothing to place is nothing to chip.
    expect(unplaced.run?.recovered?.figures).toBeUndefined();
  });

  it('draws no banner over a run that never crashed', () => {
    const quiet = seeInit({
      run: { ...RUN, recoveryAttempts: 1 },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
    });

    expect(quiet.run?.recovered).toBeUndefined();
  });

  /**
   * The raw panel is a picture of the table, so it
   * shows the bytes the column holds — and no
   * attempts column, because DBOS records no
   * per-step attempt count anywhere for one to be
   * read out of.
   */
  it('shows the table as the table, output and all', () => {
    expect(run?.raw[0]?.stepId).toBe(0);
    expect(run?.raw[0]?.fn).toBe('step_0');
    expect(run?.raw[0]?.output).toBe('{"n":0}');
    expect(run?.raw[0]?.committedAt).toMatch(/^\d{1,2}:\d{2}:\d{2}/);

    expect(Object.keys(init.strings.columns)).toEqual([
      'stepId',
      'fn',
      'output',
      'committedAt',
    ]);
  });

  it('cuts an output too long for a cell to carry', () => {
    const long = seeInit({
      run: RUN,
      steps: [{ ...step(0, 0, 1), output: 'x'.repeat(400) }],
      selectedStep: undefined,
      note: undefined,
    });

    const shown = long.run?.raw[0]?.output ?? '';
    expect(shown.length).toBeLessThan(400);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('carries the step a replay would fork from', () => {
    expect(run?.selectedStep).toBe(2);
  });

  it('has nothing to draw before a run is picked', () => {
    const empty = seeInit(undefined);

    expect(empty.run).toBeUndefined();
    expect(empty.strings.nothingSelected).toBeTypeOf('string');
  });

  /**
   * The rail is composed of both, so both have to
   * survive the trip: the controls decide which of
   * the two buttons is offered, and the lineage is
   * the tree drawn above them.
   */
  it('carries the controls and the lineage in seeInit', () => {
    const stopped = seeInit({
      run: { ...RUN, status: 'CANCELLED' },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
      cancelledHere: true,
      lineage: {
        parent: undefined,
        forks: [
          {
            run: { ...RUN, workflowId: 'wf_fork1' },
            startStep: 1,
            boundary: 'Find a slot',
          },
        ],
      },
    });

    expect(stopped.run?.controls).toMatchObject({
      cancel: false,
      resume: true,
      lastRecorded: messages.runLastRecorded('step_2', 2),
    });
    expect(stopped.run?.controls.cancelled).toContain('by you');
    expect(stopped.run?.lineage?.here).toBe(true);
    expect(stopped.run?.lineage?.forks.map((one) => one.workflowId)).toEqual([
      'wf_fork1',
    ]);
  });

  /**
   * The card the rail draws about a block is the
   * Inspector's own component, and a webview
   * resolves no word of its own — so the Inspector's
   * bag rides on the run page's init too.
   */
  it("carries the words the run page's evidence card reads", () => {
    expect(init.inspector.runStates.failed).toBeTypeOf('string');
    expect(init.inspector.kinds.step).toBeTypeOf('string');
  });
});

/**
 * The two controls a person has over a run.
 *
 * Which of them is on offer is the status column's
 * answer and nothing else's: DBOS's own statements
 * leave `SUCCESS` and `ERROR` alone, cancel is
 * meaningless once a run has stopped, and resume is
 * meaningless while one is still going. So the page
 * offers at most one of them, ever.
 *
 * "by you" is this window's own memory of having
 * asked. Nothing is written down anywhere, and the
 * page says it only when it is told to.
 */
describe('the two controls over one run', () => {
  function controls(
    over: Partial<Run>,
    view: Partial<SeeView> = {},
  ): SeeRun['controls'] {
    const shown = seeInit({
      run: { ...RUN, ...over },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
      ...view,
    });

    // Every case here builds a run, so the page is
    // never the empty one.
    return shown.run?.controls as SeeRun['controls'];
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
   * A run DBOS gave up recovering is the other run
   * resume is for: its statement leaves only
   * `SUCCESS` and `ERROR` alone, and picking one of
   * those back up would be offering to restart a
   * run that is over.
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
   * carries the time alone however it got that way.
   */
  it('says "by you" only when told', () => {
    const mine = controls({ status: 'CANCELLED' }, { cancelledHere: true });
    const theirs = controls({ status: 'CANCELLED' });

    expect(mine.cancelled).toContain('by you');
    expect(theirs.cancelled).not.toContain('by you');
    expect(theirs.cancelled).toBeTypeOf('string');
  });

  it('says nothing about a cancellation on a run nobody cancelled', () => {
    expect(controls({ status: 'ERROR' }).cancelled).toBeUndefined();
  });

  /**
   * What the run got as far as, so somebody deciding
   * whether to pick it back up can see where it
   * would carry on from.
   */
  it('names the last durable operation the run recorded', () => {
    expect(controls({ status: 'CANCELLED' }).lastRecorded).toBe(
      'step_2 · step 2',
    );
    expect(
      controls({ status: 'CANCELLED' }, { steps: [] }).lastRecorded,
    ).toBeUndefined();
  });
});

/**
 * What a row says about where a run got to.
 *
 * Worked out from the last operation the run
 * recorded of its own, which is the only thing the
 * ledger holds about where a run is — nothing marks
 * a run as "at" a block. So the line says so:
 * everything here is derived, and the row wears
 * that word.
 */
describe('the line under a run', () => {
  it('says which block a failure stopped at', () => {
    const row = rowOf({
      ...RUN,
      status: 'ERROR',
      lastOperation: 'charge_card.r2',
      lastOperationAt: 1000,
    });

    expect(row.severity).toBe('failed');
    expect(row.summary).toBe('failed · charge_card');
  });

  it('says which block a run is waiting on, and since when', () => {
    const row = rowOf({
      ...RUN,
      status: 'PENDING',
      completedAt: undefined,
      lastOperation: 'await_reply.register',
      lastOperationAt: 1000,
    });

    expect(row.severity).toBe('waiting');
    expect(row.summary).toContain('waiting · await_reply · ');
    expect(row.stoppedAt).toBeDefined();
    expect(row.summary).toContain(row.stoppedAt ?? 'no time');
  });

  it('says which block a running run got past', () => {
    const row = rowOf({
      ...RUN,
      status: 'PENDING',
      completedAt: undefined,
      lastOperation: 'find_slot',
      lastOperationAt: 1000,
    });

    expect(row.severity).toBe('running');
    expect(row.summary).toBe('running · after find_slot');
  });

  it('counts the durable operations a finished run recorded', () => {
    const row = rowOf({ ...RUN, operationCount: 7 });

    expect(row.severity).toBe('ok');
    expect(row.summary).toBe('done · 7 durable operations');
  });

  it('says nothing about a run that recorded nothing of its own', () => {
    const row = rowOf({ ...RUN, status: 'PENDING', completedAt: undefined });

    expect(row.summary).toBeUndefined();
    expect(row.stoppedAt).toBeUndefined();
  });
});

describe('a run waiting on a person', () => {
  /**
   * Only the shape of the last operation says so.
   * A run is `PENDING` whether it is executing a
   * step or parked on somebody's inbox, and telling
   * those apart is the whole reason the list reads
   * the other table at all.
   */
  it('calls a run waiting only when its last operation says so', () => {
    const inFlight = {
      ...RUN,
      status: 'PENDING',
      completedAt: undefined,
      lastOperationAt: 1000,
    };

    expect(rowOf({ ...inFlight, lastOperation: 'x.register' }).severity).toBe(
      'waiting',
    );
    expect(rowOf({ ...inFlight, lastOperation: 'x.resend.2' }).severity).toBe(
      'waiting',
    );
    expect(rowOf({ ...inFlight, lastOperation: 'x.clear' }).severity).toBe(
      'running',
    );
    expect(rowOf({ ...inFlight, lastOperation: 'find_slot' }).severity).toBe(
      'running',
    );

    // A run that has ended is not waiting for
    // anybody, whatever its last row was.
    expect(
      rowOf({ ...RUN, lastOperation: 'x.register', lastOperationAt: 1000 })
        .severity,
    ).toBe('ok');
  });

  it('takes the moment a run last recorded something', () => {
    const row = rowOf({ ...RUN, lastOperationAt: 1_739_880_139_200 });

    expect(row.stoppedAt).toBe(
      new Date(1_739_880_139_200).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('has no such moment for a run with no operation of its own', () => {
    expect(rowOf(RUN).stoppedAt).toBeUndefined();
  });

  /**
   * The two readers hold different evidence and ask
   * the question of what they have. The list has one
   * recorded name per run; the page has every row the
   * run wrote, read through a query that does not
   * select that column at all — so a page that asked
   * the list's question could only ever answer
   * `running`, however long the run had been sitting
   * in somebody's inbox.
   */
  it('says a parked run is waiting on the page as well as in the list', () => {
    const parked = {
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'find_slot.register' },
      ],
      selectedStep: undefined,
      note: undefined,
    };

    expect(seeInit(parked).run?.severity).toBe('waiting');
  });

  it('says a run whose blocks all cleared is running', () => {
    const woken = {
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'find_slot.register' },
        { ...step(1, 1000, 2000), name: 'find_slot.clear' },
      ],
      selectedStep: undefined,
      note: undefined,
    };

    expect(seeInit(woken).run?.severity).toBe('running');
  });
});

/**
 * The run page's own half of the message: the
 * saved workflow, the trace grouped as it happened,
 * and what the run was started with.
 */
describe('one run, as the run page draws it', () => {
  const IR = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      { id: 'find_slot', kind: 'step', title: 'Find a slot', config: {} },
    ],
    edges: [],
  } as unknown as WorkflowIR;

  const BOXES = {
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 120, w: 230, h: 64 },
  };

  /** The same run, created after its first step had
   *  already finished — which is what a fork looks
   *  like from inside. */
  const REPLAY: Run = {
    ...RUN,
    createdAt: 1500,
    forkedFrom: 'wf_a1b4e7',
  };

  function page(over: Partial<SeeView> = {}): SeeRun {
    const shown = seeInit({
      run: {
        ...RUN,
        input: { shape: 'payload', value: { email: 'ada@example.com' } },
      },
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'find_slot' },
      ],
      selectedStep: 1,
      note: undefined,
      ir: IR,
      boxes: BOXES,
      ...over,
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  /**
   * Every row a person can see carries whether a
   * replay may begin there, so a chip or a trace row
   * with no button says why instead of leaving a
   * gap.
   */
  it('says which rows a replay could start from', () => {
    const shown = page();

    expect(
      shown.groups
        .flatMap((group) => group.operations)
        .map((one) => [one.name, one.replayable]),
    ).toEqual([
      ['parse_request', true],
      ['find_slot', true],
    ]);
    expect(shown.chips.map((chip) => chip.replayable)).toEqual([true, true]);
  });

  it('says why a row is not one', () => {
    const shown = page({
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        { ...step(1, 1000, 2000), name: 'DBOS.sleep' },
      ],
      raw: true,
    });
    const rows = shown.groups.flatMap((group) => group.operations);
    const withheld = rows.find((one) => one.name === 'DBOS.sleep');

    expect(withheld?.replayable).toBe(false);
    expect(withheld?.because).toBe(messages.replayRowSdkOwned());
  });

  /**
   * The rule is asked of a drawing, so a page with
   * no document beside it can offer no point at all
   * — and says so rather than offering every row.
   */
  it('offers no point at all without a document', () => {
    const shown = page({ ir: undefined, boxes: undefined });
    const rows = shown.groups.flatMap((group) => group.operations);

    expect(rows.map((one) => one.replayable)).toEqual([false, false]);
    expect(rows[0]?.because).toBe(messages.replayNotOffered());
  });

  /**
   * A fork carries over every operation the run it
   * came from had already finished, timestamps and
   * all — so a row that completed before its own
   * run was created is one of those. Nothing in the
   * schema marks a row as copied, and this is the
   * only evidence there is.
   */
  it('marks a reused row recorded', () => {
    const shown = page({ run: REPLAY });

    expect(
      shown.groups
        .flatMap((group) => group.operations)
        .map((one) => [one.name, one.reused]),
    ).toEqual([
      ['parse_request', true],
      ['find_slot', false],
    ]);
    expect(seeInit(undefined).strings.recorded).toBe('↺ recorded');
  });

  it('marks a reused chip and bar reused, and an own row not', () => {
    const shown = page({ run: REPLAY });

    expect(shown.chips.map((chip) => chip.reused)).toEqual([true, false]);
    expect(shown.timeline.bars.map((bar) => bar.reused)).toEqual([true, false]);
  });

  it('carries the groups, the graph, the selection and the input', () => {
    const shown = page({ selectedNode: 'find_slot', following: 'following' });

    expect(shown.graph?.caption).toBe('workflow as saved · revision 4');
    expect(shown.noGraph).toBeUndefined();
    expect(shown.graph?.ir.name).toBe('groom_booking');
    expect(shown.groups.map((group) => group.nodeId)).toEqual([
      'parse_request',
      'find_slot',
    ]);
    expect(shown.selected).toEqual({
      nodeId: 'find_slot',
      functionId: 1,
    });
    expect(shown.following).toBe('following');
    expect(shown.input?.text).toContain('ada@example.com');
  });

  /**
   * With no document nothing tells one row's block
   * from another's, so the trace is one flat group
   * of unattributed rows — which is exactly what a
   * trace with no picture beside it is.
   *
   * And that group is nameless. Only the document
   * says what a block is called, so a group with no
   * block behind it has nothing to be called: naming
   * it after whichever row came first would tell
   * somebody a group of fifty rows was
   * `parse_request`. The badge beside it says what
   * it is instead.
   */
  it('draws no graph for a run whose workflow the project lost', () => {
    const shown = page({ ir: undefined, boxes: undefined });

    expect(shown.graph).toBeUndefined();
    expect(shown.noGraph).toBe(
      'no saved workflow named groom_booking · trace only',
    );
    expect(shown.groups).toHaveLength(1);
    expect(shown.groups[0]?.operations).toHaveLength(2);
    expect(shown.groups[0]?.nodeId).toBeUndefined();
    expect(shown.groups[0]?.title).toBe('');
  });

  it('projects a group of one own row as that row', () => {
    const [first] = page().groups;

    expect(first?.title).toBe('Parse');
    expect(first?.qualifier).toBeUndefined();
    expect(first?.operations).toHaveLength(1);
    expect(first?.operations[0]?.owner).toBe('node');
    expect(first?.operations[0]?.at).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  /**
   * Collapsed by default, except where somebody is
   * most likely to be going: the turn that failed,
   * and the one holding the block they picked.
   */
  it('opens a failed group, and the one holding the selected block', () => {
    const plain = page();
    expect(plain.groups.map((group) => group.open)).toEqual([false, false]);

    const picked = page({ selectedNode: 'find_slot' });
    expect(picked.groups.map((group) => group.open)).toEqual([false, true]);

    const broken = page({
      steps: [
        { ...step(0, 0, 1000), name: 'parse_request' },
        {
          ...step(1, 1000, 2000),
          name: 'find_slot',
          failure: { message: 'no slot' },
        },
      ],
    });
    expect(broken.groups.map((group) => group.open)).toEqual([false, true]);
  });

  /**
   * The banner used to say steps "came back instead
   * of running again", which reads as though DBOS
   * decided not to execute something. What happened
   * is narrower, and the gap is an inference rather
   * than a moment anything wrote down.
   */
  it('says what a recovery cost without claiming code was skipped', () => {
    const shown = seeInit({
      run: { ...RUN, recoveryAttempts: 2 },
      steps: STEPS,
      selectedStep: undefined,
      note: undefined,
    }).run;

    expect(shown?.recovered?.heading).toBe(
      'Recovered — completed durable operations were not re-executed',
    );
    expect(shown?.recovered?.body).toContain('derived from the widest gap');
    expect(shown?.recovered?.body).toContain('rather than run again');
    expect(shown?.recovered?.body).not.toContain('instead of running again');
  });
});

/**
 * When a run wakes, drawn only where the project's
 * SDK records the row it is read off.
 */
describe('when a run wakes', () => {
  /** One step, then a wait on whichever source the
   *  case is about. */
  function waitingOn(source: unknown): WorkflowIR {
    return {
      $schema: 'https://mboss.dev/schemas/workflow-v1.json',
      version: 1,
      revision: 2,
      name: 'expense_claim',
      nodes: [
        { id: 'file_it', kind: 'step', title: 'File it', config: {} },
        {
          id: 'hold_on',
          kind: 'durableWait',
          title: 'Hold on',
          config: { source, onTimeout: 'abort' },
        },
      ],
      edges: [
        {
          id: 'e1',
          from: { node: 'file_it', port: 'out' },
          to: { node: 'hold_on' },
        },
      ],
    } as unknown as WorkflowIR;
  }

  const WAITING = waitingOn({ kind: 'timer', seconds: 60 });

  function sleeping(over: Partial<SeeView> = {}): SeeRun {
    const shown = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'file_it' },
        { ...step(1, 1000, 90_000), name: 'DBOS.sleep', output: '90000' },
      ],
      selectedStep: 0,
      note: undefined,
      ir: WAITING,
      boxes: {
        file_it: { x: 0, y: 0, w: 230, h: 64 },
        hold_on: { x: 0, y: 120, w: 230, h: 64 },
      },
      ...over,
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  it('says when a sleeping block wakes, under the gate', () => {
    expect(sleeping({ timing: true }).groups[0]?.wakes).toContain(
      'asleep until',
    );
  });

  it('says nothing about it below the gate', () => {
    expect(sleeping({ timing: false }).groups[0]?.wakes).toBeUndefined();
    expect(sleeping().groups[0]?.wakes).toBeUndefined();
  });

  /**
   * A bare sleep inside a block that branches
   * afterwards says nothing about where the run
   * goes next, and guessing would be the page
   * making something up.
   */
  it('says nothing where the block has more than one way onward', () => {
    const forked = {
      ...WAITING,
      edges: [
        ...WAITING.edges,
        {
          id: 'e2',
          from: { node: 'file_it', port: 'out' },
          to: { node: 'hold_on' },
        },
      ],
    } as unknown as WorkflowIR;

    expect(
      sleeping({ timing: true, ir: forked }).groups[0]?.wakes,
    ).toBeUndefined();
  });

  /**
   * `asleep until` is a sentence about a timer. A
   * wait on a person or an event has a deadline
   * too, but it is the moment the wait gives up
   * rather than the moment the run comes back —
   * somebody answering is what wakes that one, and
   * no row says when they will.
   */
  it('says nothing where the wait ahead is not a timer', () => {
    for (const source of [
      { kind: 'form', email: 'file_it' },
      { kind: 'event', topic: 'x', correlationPath: 'a', correlateWith: 'b' },
    ]) {
      expect(
        sleeping({ timing: true, ir: waitingOn(source) }).groups[0]?.wakes,
      ).toBeUndefined();
    }
  });

  it('says when a parked block gives up, wherever one is recorded', () => {
    const shown = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        { ...step(0, 0, 1000), name: 'manager_ok.register' },
        { ...step(1, 1000, 1000), name: 'DBOS.sleep', output: '90000' },
      ],
      selectedStep: 0,
      note: undefined,
      timing: true,
    }).run;

    expect(shown?.groups[0]?.wakes).toContain('times out');
  });
});

/**
 * The two readings a parked run needs at once.
 *
 * One walk over the same rows answers two different
 * questions: which arm a branch took, read out of
 * what a step returned, and whether the run is
 * asleep, read off a sleep row's deadline. Each is
 * covered on its own; this is the run that asks
 * both, because the rows they read sit side by side
 * in one ledger.
 */
describe('a run that decided and then went to sleep', () => {
  const BRANCHING = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 5,
    name: 'expense_claim',
    nodes: [
      {
        id: 'how_big',
        kind: 'branch',
        title: 'How big',
        config: {
          cases: [
            { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
          ],
          elsePort: 'small',
        },
      },
      { id: 'charge_it', kind: 'step', title: 'Charge it', config: {} },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'how_big', port: 'large' },
        to: { node: 'charge_it' },
      },
    ],
  } as unknown as WorkflowIR;

  /** The branch's own row as DBOS stores it, beside
   *  a sleep row whose deadline is `wakesAt`. */
  function parked(wakesAt: number): SeeRun {
    const shown = seeInit({
      run: { ...RUN, status: 'PENDING', completedAt: undefined },
      steps: [
        {
          ...step(0, 0, 1000),
          name: 'how_big',
          output: JSON.stringify({
            json: { amount: 900 },
            __dbos_serializer: 'superjson',
          }),
        },
        {
          ...step(1, wakesAt - 120_000, wakesAt),
          name: 'DBOS.sleep',
          output: String(wakesAt),
        },
      ],
      selectedStep: 0,
      note: undefined,
      ir: BRANCHING,
      boxes: {
        how_big: { x: 0, y: 0, w: 230, h: 64 },
        charge_it: { x: 0, y: 160, w: 230, h: 64 },
      },
    }).run;

    if (shown === undefined) throw new Error('no run to draw');

    return shown;
  }

  it('reads the arm it took and reports it still asleep', () => {
    const shown = parked(Date.now() + 120_000);

    expect(shown.graph?.decided).toEqual({ how_big: 'large' });
    expect(shown.live?.outcome).toBe('waiting');
  });

  it('keeps the arm once the deadline has passed', () => {
    const shown = parked(Date.now() - 1000);

    expect(shown.graph?.decided).toEqual({ how_big: 'large' });
    expect(shown.live?.outcome).toBe('running');
  });
});
