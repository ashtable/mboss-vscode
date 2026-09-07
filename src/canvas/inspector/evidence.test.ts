import { describe, expect, it } from 'vitest';

import { stepError } from '../../runs/rows.js';
import { liveRun, liveStep } from '../../test-support/runs.js';

import { evidenceOf, runCardOf } from './evidence.js';

/**
 * What one run recorded about one block.
 *
 * The rows are the whole of it. A block that ran
 * three times wrote three of them, a wait wrote the
 * two halves of parking, and a block the generated
 * code decided without asking anybody wrote none —
 * so what is asked here is that each of those reads
 * back as what it is, rather than as an absence.
 */

/**
 * A run of a workflow with a fan-out, a loop and a
 * wait in it.
 *
 * The names are the ones the emitter writes and the
 * ledger keeps: a block's id, then the region it
 * ran in. `nodeId` beside each is what the reading
 * already worked out from that name, which is what
 * a canvas is handed.
 */
const RUN = liveRun({
  workflowId: 'wf_c9d2f3',
  recoveryAttempts: 2,
  applicationVersion: '1',
  input: '{ "orderId": "ord_123" }',
  steps: [
    liveStep({ name: 'parse_request', nodeId: 'parse_request', functionId: 0 }),
    liveStep({ name: 'pack[0]', nodeId: 'pack', functionId: 1 }),
    liveStep({ name: 'pack[1]', nodeId: 'pack', functionId: 2 }),
    liveStep({ name: 'pack[2]', nodeId: 'pack', functionId: 3 }),
    liveStep({ name: 'find_slot.r1', nodeId: 'find_slot', functionId: 4 }),
    liveStep({ name: 'find_slot.r2', nodeId: 'find_slot', functionId: 5 }),
    liveStep({
      name: 'await_reply.ask',
      nodeId: 'await_reply',
      functionId: 6,
      startedAt: 8000,
      completedAt: 8100,
    }),
    liveStep({
      name: 'await_reply.register',
      nodeId: 'await_reply',
      functionId: 7,
      state: 'waiting',
      startedAt: 8200,
      completedAt: 8300,
    }),
  ],
});

describe('what a run recorded about one block', () => {
  it('groups a block’s rows under it', () => {
    const found = evidenceOf(RUN, 'pack');

    expect(found.rows.map((row) => row.functionId)).toEqual([1, 2, 3]);
    expect(evidenceOf(RUN, 'parse_request').rows).toHaveLength(1);
  });

  it('lists a fan-out’s items', () => {
    expect(evidenceOf(RUN, 'pack').rows.map((row) => row.part)).toEqual([
      '[0]',
      '[1]',
      '[2]',
    ]);
  });

  it('lists a loop’s rounds', () => {
    expect(evidenceOf(RUN, 'find_slot').rows.map((row) => row.part)).toEqual([
      '.r1',
      '.r2',
    ]);
  });

  /**
   * The registration is the row that says the run
   * parked, so the moment it landed is the moment
   * the waiting started. Nothing counts up from it:
   * the fact is a time, and a panel that ticked
   * would be drawing a run nothing is reading any
   * more.
   */
  it('reads a wait’s since from the register row', () => {
    expect(evidenceOf(RUN, 'await_reply').waitingSince).toBe(8300);
  });

  /** And says nothing about a block that is not
   *  parked, however many registrations it once
   *  wrote. */
  it('says nothing about a block the run is not parked on', () => {
    expect(evidenceOf(RUN, 'pack').waitingSince).toBeUndefined();
  });

  it('gives a predicate branch no rows', () => {
    const found = evidenceOf(RUN, 'reply_decision');

    expect(found.rows).toEqual([]);
    expect(found.headline).toBeUndefined();
  });

  /**
   * DBOS stores the wrapper it threw over a step
   * that ran out of tries, and the wrapper's own
   * sentence names no cause. The reading already
   * takes the headline off the last try; what is
   * held here is that the card reads that headline
   * rather than the wrapper's.
   */
  it('takes an exhausted step’s headline from the last attempt', () => {
    const failed = liveRun({
      steps: [
        liveStep({
          name: 'find_slot',
          nodeId: 'find_slot',
          state: 'failed',
          error: stepError({
            name: 'DBOSMaxStepRetriesError',
            message: 'Step find_slot has exceeded its maximum of 3 retries',
            errors: [
              { name: 'StripeTimeoutError', message: 'timed out once' },
              { name: 'StripeTimeoutError', message: 'timed out again' },
            ],
          }),
        }),
      ],
    });

    const headline = evidenceOf(failed, 'find_slot').headline;

    expect(headline?.error?.message).toBe('timed out again');
    expect(headline?.error?.retriesExhausted).toBe(true);
  });

  /**
   * A loop is generated as the control flow around
   * its body, so the ledger holds nothing under its
   * name. How far round the run went is read off the
   * rows the body wrote, which is the only evidence
   * there is.
   */
  it('says a loop has no row of its own', () => {
    const found = evidenceOf(RUN, 'each_slot');

    expect(found.rows).toEqual([]);
    expect(found.rounds).toBe(2);
  });

  describe('the run-level card', () => {
    it('carries the workflow input, the recovery and the version', () => {
      expect(runCardOf(RUN)).toMatchObject({
        workflowId: 'wf_c9d2f3',
        workflow: 'groom_booking',
        input: '{ "orderId": "ord_123" }',
        recoveries: 1,
        applicationVersion: '1',
      });
    });

    /** The column counts dispatches rather than
     *  crashes, so an ordinary run that worked first
     *  time already carries one. */
    it('says a run nobody picked back up was never recovered', () => {
      expect(runCardOf(liveRun({ recoveryAttempts: 1 })).recoveries).toBe(0);
    });

    it('times the run where the ledger timed it', () => {
      expect(
        runCardOf(liveRun({ startedAt: 1000, completedAt: 6200 })).durationMs,
      ).toBe(5200);
      expect(runCardOf(liveRun({ completedAt: undefined })).durationMs).toBe(
        undefined,
      );
    });
  });
});

/**
 * A row a replay carried over.
 *
 * The card marks it `↺ recorded` rather than
 * drawing the block differently: what the earlier
 * run recorded is this run's evidence too, and the
 * block did what it did.
 */
describe('a row a replay carried over', () => {
  it('carries whether the row was reused', () => {
    const replayed = liveRun({
      forkedFrom: 'wf_a1b4e7',
      steps: [
        liveStep({
          name: 'parse_request',
          nodeId: 'parse_request',
          reused: true,
        }),
        liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId: 1 }),
      ],
    });

    expect(evidenceOf(replayed, 'parse_request').headline?.reused).toBe(true);
    expect(evidenceOf(replayed, 'find_slot').headline?.reused).toBe(false);
  });
});
