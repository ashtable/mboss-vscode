import { describe, expect, it } from 'vitest';

import {
  SESSION_LOG_LIMIT,
  refusedRunId,
  sessionLog,
  type SessionRun,
} from './sessionLog.js';

/**
 * What this window has set going.
 *
 * A list in memory, so most of what is worth
 * asserting is what it refuses to forget and what
 * it refuses to unsay: the oldest rows go when the
 * list is full, and a run that recovered keeps
 * saying so however many times it is written to
 * afterwards.
 */

function run(over: Partial<SessionRun> = {}): SessionRun {
  return {
    workflowId: 'run_1_a1b2',
    workflow: 'groom_booking',
    input: { bookingId: 7 },
    startedAt: 1000,
    outcome: 'running',
    stepCount: 0,
    recovered: false,
    ...over,
  };
}

describe('the session log', () => {
  it('lists what it was given, newest first', () => {
    const log = sessionLog();

    log.record(run({ workflowId: 'run_1', startedAt: 1000 }));
    log.record(run({ workflowId: 'run_2', startedAt: 2000 }));

    expect(log.list().map((row) => row.workflowId)).toEqual(['run_2', 'run_1']);
  });

  it('finds one run by the id it was recorded under', () => {
    const log = sessionLog();
    log.record(run({ workflowId: 'run_1' }));

    expect(log.find('run_1')?.workflow).toBe('groom_booking');
    expect(log.find('run_9')).toBeUndefined();
  });

  it('patches a row in place, leaving the rest of it alone', () => {
    const log = sessionLog();
    log.record(run({ workflowId: 'run_1' }));

    log.update('run_1', { outcome: 'done', durationMs: 8200, stepCount: 3 });

    const row = log.find('run_1');
    expect(row?.outcome).toBe('done');
    expect(row?.durationMs).toBe(8200);
    expect(row?.input).toEqual({ bookingId: 7 });
  });

  it('says nothing about a run it never recorded', () => {
    const log = sessionLog();

    log.update('run_9', { outcome: 'done' });

    expect(log.list()).toEqual([]);
  });

  /**
   * A window somebody leaves open all week starts a
   * lot of runs, and this list is memory that is
   * never handed back. The durable record is the
   * ledger; this is only what has happened since
   * the window opened.
   */
  it('keeps the newest runs and drops the oldest past its limit', () => {
    const log = sessionLog();

    for (let at = 0; at < SESSION_LOG_LIMIT + 5; at += 1) {
      log.record(run({ workflowId: `run_${at}` }));
    }

    const listed = log.list();
    expect(listed).toHaveLength(SESSION_LOG_LIMIT);
    expect(listed[0]?.workflowId).toBe(`run_${SESSION_LOG_LIMIT + 4}`);
    expect(log.find('run_0')).toBeUndefined();
    expect(log.find('run_5')).toBeDefined();
  });

  /**
   * Recovery is the product's whole argument, and a
   * run that crashed and then finished green would
   * otherwise be indistinguishable from one that
   * never crashed at all.
   */
  it('never unsays that a run recovered', () => {
    const log = sessionLog();
    log.record(run({ workflowId: 'run_1' }));

    log.update('run_1', { recovered: true });
    log.update('run_1', { outcome: 'done', recovered: false });

    expect(log.find('run_1')?.recovered).toBe(true);
  });

  /**
   * A manual run is recorded before the request
   * goes, so a start the app refuses lands on a row
   * that is already on screen — which is what keeps
   * the reason in the list instead of in a toast
   * that vanishes.
   */
  it('keeps a refused manual start in the list, saying why', () => {
    const log = sessionLog();
    log.record(run({ workflowId: 'run_1_a1b2' }));

    log.update('run_1_a1b2', {
      outcome: 'failed',
      error: 'The app is not up, so there is nothing to run on.',
    });

    const row = log.find('run_1_a1b2');
    expect(row?.outcome).toBe('failed');
    expect(row?.error).toContain('not up');
    expect(row?.input).toEqual({ bookingId: 7 });
  });

  /**
   * An event run has no id until the app echoes
   * one, so a refused one is remembered under an id
   * this side made up — and the row sits in the
   * list like the others, with the input a resend
   * would use.
   */
  it('remembers a refused event start under an id of its own', () => {
    const log = sessionLog();
    const id = refusedRunId();

    log.record(
      run({ workflowId: id, outcome: 'failed', error: 'no EVENTS_SECRET' }),
    );

    expect(id.startsWith('refused_')).toBe(true);
    expect(log.find(id)?.error).toBe('no EVENTS_SECRET');
    expect(refusedRunId()).not.toBe('');
  });
});
