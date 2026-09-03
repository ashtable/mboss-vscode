import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenDatabase } from './db.js';
import type { OperationOutputRow, WorkflowStatusRow } from './rows.js';
import {
  WATCH_INTERVAL_MS,
  WATCH_QUIET_MS,
  watchRun,
  type LiveRun,
} from './watch.js';

/**
 * Following one run, against a ledger a spec writes
 * by hand.
 *
 * Everything worth asserting here is about when the
 * poller lets go: a run that finished, a run parked
 * on a person, and a run that has gone quiet are
 * three different endings and the panel says three
 * different things about them. So the fake database
 * below is mutable — a spec changes what the ledger
 * holds between ticks, the way an app writing rows
 * would — and the clock is the one the timers run
 * on.
 */

const URL = 'postgres://app@localhost:5432/sys';

const RUN_ID = 'run_1700000000000_a1b2c3d4';

/** One row of `dbos.operation_outputs`, in the two
 *  fields these specs care about. */
type Recorded = { name: string; error?: string };

type Ledger = {
  open: OpenDatabase;

  /** The run's row, or nothing where the app has
   *  not written it yet. */
  status: WorkflowStatusRow | undefined;

  steps: Recorded[];

  /** Every connection string opened, so a spec can
   *  say how many were. */
  opened: string[];

  closed: number;

  /** What every read fails with, while it is set. */
  fail: string | undefined;
};

function ledger(status: WorkflowStatusRow = runRow()): Ledger {
  const state: Ledger = {
    status,
    steps: [],
    opened: [],
    closed: 0,
    fail: undefined,
    open: async (url) => {
      state.opened.push(url);

      return {
        query: async <Row>(text: string): Promise<Row[]> => {
          if (state.fail !== undefined) throw new Error(state.fail);

          if (text.includes('operation_outputs')) {
            return state.steps.map(stepRow) as Row[];
          }

          return (state.status === undefined ? [] : [state.status]) as Row[];
        },
        close: async () => {
          state.closed += 1;
        },
      };
    },
  };

  return state;
}

function runRow(patch: Partial<WorkflowStatusRow> = {}): WorkflowStatusRow {
  return {
    workflow_uuid: RUN_ID,
    name: 'counter',
    status: 'PENDING',
    recovery_attempts: '1',
    executor_id: 'local-dev',
    application_version: 'v0.1.0',
    created_at: '1000',
    started_at_epoch_ms: '1000',
    completed_at: null,
    error: null,
    serialization: null,
    ...patch,
  };
}

/** The steps are numbered by where they sit, which
 *  is the order the statement asks for them in. */
function stepRow(step: Recorded, index: number): OperationOutputRow {
  return {
    function_id: index,
    function_name: step.name,
    started_at_epoch_ms: '1000',
    completed_at_epoch_ms: '1200',
    output: '{}',
    error: step.error ?? null,
    child_workflow_id: null,
    serialization: null,
  };
}

/** Lets every read the poller started finish, after
 *  moving the clock on. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('watchRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops once the run has finished', async () => {
    const db = ledger(runRow({ status: 'SUCCESS', completed_at: '2000' }));
    db.steps = [{ name: 'parse_request' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen).toEqual([
      {
        workflowId: RUN_ID,
        workflow: 'counter',
        status: 'SUCCESS',
        outcome: 'done',
        recovered: false,
        error: undefined,
        steps: [
          { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
        ],
      },
    ]);

    await settle(WATCH_INTERVAL_MS * 10);

    expect(seen).toHaveLength(1);
    expect(db.closed).toBe(1);
  });

  it('reports a run that ended in an error, with what it said', async () => {
    const db = ledger(
      runRow({ status: 'ERROR', error: '{"message":"no slot"}' }),
    );

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]).toMatchObject({ outcome: 'failed', error: 'no slot' });
    expect(db.closed).toBe(1);
  });

  it('marks the step that failed', async () => {
    const db = ledger();
    db.steps = [
      { name: 'parse_request' },
      { name: 'charge_card', error: '{"message":"card declined"}' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.steps.map((step) => step.state)).toEqual([
      'done',
      'failed',
    ]);

    // The run itself is still going: a step that
    // threw may yet be retried, and the status
    // column is the only thing that says the run is
    // over.
    expect(seen[0]?.outcome).toBe('running');
  });

  it('lets go of a run parked on a person', async () => {
    const db = ledger();
    db.steps = [{ name: 'parse_request' }, { name: 'await_reply.register' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('waiting');
    expect(seen[0]?.steps).toEqual([
      { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
      { name: 'await_reply.register', nodeId: 'await_reply', state: 'waiting' },
    ]);

    await settle(WATCH_QUIET_MS * 2);

    expect(seen).toHaveLength(1);
    expect(db.closed).toBe(1);
  });

  it('is still parked when a reminder has gone out', async () => {
    const db = ledger();
    db.steps = [
      { name: 'await_form.register' },
      { name: 'await_form.resend.1' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('waiting');
    expect(seen[0]?.steps.map((step) => step.state)).toEqual([
      'waiting',
      'waiting',
    ]);
  });

  it('counts a wait that ended as done, and keeps watching', async () => {
    const db = ledger();
    db.steps = [
      { name: 'await_reply.register' },
      { name: 'await_reply.clear' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('running');
    expect(seen[0]?.steps.map((step) => step.state)).toEqual(['done', 'done']);

    db.status = runRow({ status: 'SUCCESS' });
    await settle(WATCH_INTERVAL_MS);

    expect(seen[1]?.outcome).toBe('done');
  });

  it("leaves out the SDK's own bookkeeping", async () => {
    const db = ledger();
    db.steps = [
      { name: 'DBOS.sleep' },
      { name: 'parse_request' },
      { name: 'DBOS.recv' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.steps).toEqual([
      { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
    ]);
  });

  it('names each step for the block it belongs to', async () => {
    const db = ledger();
    db.steps = [
      { name: 'charge_each.r2[3]' },
      { name: 'find_slot.r1' },
      { name: 'manager_ok.ask' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.steps.map((step) => step.nodeId)).toEqual([
      'charge_each',
      'find_slot',
      'manager_ok',
    ]);
  });

  it('keeps `recovered` once the ledger has said so', async () => {
    const db = ledger(runRow({ recovery_attempts: '2' }));

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.recovered).toBe(true);

    // The ledger is made to contradict itself, so
    // that the latch is the only thing that could
    // still answer true.
    db.status = runRow({ recovery_attempts: '1', status: 'SUCCESS' });
    await settle(WATCH_INTERVAL_MS);

    expect(seen[1]?.recovered).toBe(true);
  });

  it('says nothing while nothing changes', async () => {
    const db = ledger();
    db.steps = [{ name: 'parse_request' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle(WATCH_INTERVAL_MS * 5);

    expect(seen).toHaveLength(1);
    expect(db.opened).toEqual([URL]);
  });

  it('gives up when nothing has moved for long enough', async () => {
    const db = ledger();
    db.steps = [{ name: 'parse_request' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('running');

    await settle(WATCH_QUIET_MS);

    expect(seen[1]).toMatchObject({ outcome: 'quiet' });
    expect(db.closed).toBe(1);

    await settle(WATCH_QUIET_MS);

    expect(seen).toHaveLength(2);
  });

  it('starts the quiet clock again when a step lands', async () => {
    const db = ledger();
    db.steps = [{ name: 'parse_request' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle(WATCH_QUIET_MS - WATCH_INTERVAL_MS);

    expect(seen).toHaveLength(1);

    db.steps = [...db.steps, { name: 'charge_card' }];
    await settle(WATCH_INTERVAL_MS);

    expect(seen).toHaveLength(2);

    await settle(WATCH_QUIET_MS - WATCH_INTERVAL_MS);

    expect(seen).toHaveLength(2);
    expect(db.closed).toBe(0);
  });

  it('waits for a row the app has not written yet', async () => {
    const db = ledger();
    db.status = undefined;

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle(WATCH_INTERVAL_MS * 2);

    expect(seen).toEqual([]);

    db.status = runRow();
    await settle(WATCH_INTERVAL_MS);

    expect(seen).toHaveLength(1);
  });

  it('waits out a database that will not answer', async () => {
    const db = ledger();
    db.fail = 'ECONNREFUSED 127.0.0.1:5432';

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle(WATCH_QUIET_MS);

    expect(seen).toEqual([]);
    expect(db.closed).toBe(1);
  });

  it('stops when it is told to', async () => {
    const db = ledger();

    const seen: LiveRun[] = [];
    const watcher = watchRun(db.open, URL, RUN_ID, (run) => seen.push(run));

    await settle();

    expect(seen).toHaveLength(1);

    watcher.stop();
    db.status = runRow({ status: 'SUCCESS' });
    await settle(WATCH_INTERVAL_MS * 5);

    expect(seen).toHaveLength(1);
    expect(db.closed).toBe(1);
  });
});
