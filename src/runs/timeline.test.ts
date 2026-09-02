import { describe, expect, it } from 'vitest';

import type { Run, Step } from './rows.js';
import { runTimeline } from './timeline.js';

/**
 * The one place the drawing rule lives.
 *
 * Nothing in `dbos.workflow_status` or
 * `dbos.operation_outputs` marks a step as
 * restored-from-the-ledger rather than
 * freshly-run, and no column anywhere records the
 * moment a process died. Two things *are* known:
 * `recovery_attempts` says a run was picked back
 * up at some point, and a restored step keeps the
 * timestamps it was first written with, so the
 * ordered steps fall into a before-the-crash half
 * and an after-it half with a hole between them.
 *
 * (`recovery_attempts` counts dispatches, so a run
 * that never crashed already reads one — the
 * fixtures below use two.)
 *
 * So the rule is: on a run that recovered, the
 * widest hole between one step finishing and the
 * next one starting is where the process was down.
 * That is an inference, and this is the one
 * function making it, so there is one place to
 * argue with — and one place a better signal would
 * be plumbed into if DBOS ever records one.
 */

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recoveryAttempts: 2,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 1000,
  startedAt: 1000,
  completedAt: 9000,
  error: undefined,
};

function step(functionId: number, from: number, to: number): Step {
  return {
    functionId,
    name: `step_${functionId}`,
    startedAt: from,
    completedAt: to,
    output: '{}',
    error: undefined,
    childWorkflowId: undefined,
  };
}

/** Two quick steps, a long hole, then two more. */
const CRASHED = [
  step(0, 1000, 1200),
  step(1, 1200, 1500),
  step(2, 4400, 4700),
  step(3, 4700, 5000),
];

describe('a run that never recovered', () => {
  const quiet: Run = { ...RUN, recoveryAttempts: 1 };

  /**
   * A workflow that waits — for a form, for a
   * timer, for a person — has holes in it that mean
   * nothing went wrong. Drawing a crash across one
   * of those would be asserting something false
   * about a run that worked, so the only runs that
   * can carry a band are the ones DBOS says were
   * picked back up.
   */
  it('has no outage however long its gaps are', () => {
    const timeline = runTimeline(quiet, CRASHED);

    expect(timeline.outage).toBeUndefined();
    expect(timeline.steps.every((one) => !one.restored)).toBe(true);
  });
});

describe('a run that recovered', () => {
  const timeline = runTimeline(RUN, CRASHED);

  it('puts the outage in the widest hole between steps', () => {
    expect(timeline.outage).toEqual({ from: 1500, to: 4400 });
  });

  /**
   * Every step that had already finished when the
   * process died comes back from the ledger on the
   * replay rather than running again — which is the
   * whole claim this view exists to show.
   */
  it('marks everything finished before it restored', () => {
    expect(timeline.steps.map((one) => one.restored)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('spans from the run starting to the run ending', () => {
    expect(timeline.from).toBe(1000);
    expect(timeline.to).toBe(9000);
  });

  /**
   * A run still going has no end, and a bar drawn
   * against an unknown end would be drawn against
   * nothing. The last thing that happened is the
   * right edge until something later happens.
   */
  it('ends at the last thing that happened while it is still going', () => {
    const going = runTimeline(
      { ...RUN, status: 'PENDING', completedAt: undefined },
      CRASHED,
    );

    expect(going.to).toBe(5000);
  });
});

describe('what the rule cannot answer', () => {
  /**
   * `recovery_attempts` is a count, not a list of
   * moments. A run picked back up twice has two
   * outages in it and the schema records neither,
   * so one band is drawn and the count in the rail
   * is what says there were more. The timeline
   * never claims to show every one.
   */
  it('draws one band however many times a run recovered', () => {
    const twice = runTimeline({ ...RUN, recoveryAttempts: 3 }, CRASHED);

    expect(twice.outage).toEqual({ from: 1500, to: 4400 });
  });

  it('draws none when there is no hole to put one in', () => {
    const unbroken = [step(0, 1000, 1200), step(1, 1200, 1500)];

    const timeline = runTimeline(RUN, unbroken);

    expect(timeline.outage).toBeUndefined();
    expect(timeline.steps.every((one) => !one.restored)).toBe(true);
  });

  it('draws none when there is only one step to hold it', () => {
    const timeline = runTimeline(RUN, [step(0, 1000, 1200)]);

    expect(timeline.outage).toBeUndefined();
  });

  /**
   * A step still in flight, or one DBOS has not
   * timed, cannot bound a hole. It is drawn without
   * a bar rather than dropped, because a step
   * missing from the strip is a step nobody knows
   * ran.
   */
  it('keeps an untimed step and lets it bound nothing', () => {
    const untimed: Step = {
      ...step(1, 0, 0),
      startedAt: undefined,
      completedAt: undefined,
    };

    const timeline = runTimeline(RUN, [
      step(0, 1000, 1200),
      untimed,
      step(2, 4400, 4700),
    ]);

    expect(timeline.steps).toHaveLength(3);
    expect(timeline.steps[1]?.startedAt).toBeUndefined();
    expect(timeline.outage).toEqual({ from: 1200, to: 4400 });
  });

  it('draws nothing at all for a run with no steps', () => {
    const timeline = runTimeline(RUN, []);

    expect(timeline.steps).toEqual([]);
    expect(timeline.outage).toBeUndefined();
    expect(timeline.to).toBeGreaterThan(timeline.from);
  });
});
