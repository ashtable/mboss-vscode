import { describe, expect, it } from 'vitest';

import type { Run, Step } from './rows.js';
import type { SessionRun } from './sessionLog.js';
import { rowOf, seeInit, sessionRowOf } from './view.js';
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
  },
  {
    name: 'expense_claim',
    title: 'Expense claim',
    trigger: { mode: 'event', topic: 'expense.filed', keyPath: 'claimId' },
  },
  // An event workflow that names no key: every
  // send of it is a run of its own.
  {
    name: 'door_opened',
    title: 'Door opened',
    trigger: { mode: 'event', topic: 'door.opened' },
  },
  // Listed so a person can see it exists; not
  // started by hand.
  {
    name: 'nightly_sweep',
    title: 'Nightly sweep',
    trigger: { mode: 'schedule' },
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

  it('draws a run that has not finished as still going', () => {
    for (const status of ['PENDING', 'ENQUEUED', 'DELAYED']) {
      expect(rowOf({ ...RUN, status }).severity).toBe('running');
    }
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

  it('says what the crash cost, out of what the ledger holds', () => {
    expect(run?.recovered?.heading).toBe('Crash recovered — exactly-once held');
    expect(run?.recovered?.body).toContain('6.0 s');
    expect(run?.recovered?.body).toContain('2 steps');
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
});
