import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenDatabase } from './db.js';
import type { OperationOutputRow, WorkflowStatusRow } from './rows.js';
import {
  SETTLED,
  WATCH_INTERVAL_MS,
  WATCH_QUIET_MS,
  watchRun,
  type LedgerRead,
  type LiveRun,
  type LiveStep,
  type QueueCounts,
} from './watch.js';
import type { StepState } from './reading.js';

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

/** One queue block of the workflow being watched,
 *  and the name its children register under. */
const INDEX_PAGES = {
  nodeId: 'index_pages',
  queuedName: 'index_pages.queued.document_ingestion_queued',
};

/** One row of `dbos.operation_outputs`, in the
 *  fields these specs care about. The timings are
 *  the fixture's unless a case is about them. */
type Recorded = {
  name: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

type Ledger = {
  open: OpenDatabase;

  /** The run's row, or nothing where the app has
   *  not written it yet. */
  status: WorkflowStatusRow | undefined;

  steps: Recorded[];

  /** What each queue block's children are doing,
   *  under the name those children register with. */
  counts: Record<string, QueueCounts>;

  /** Every statement read, so a spec can say which
   *  questions were asked and which were not. */
  asked: string[];

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
    counts: {},
    asked: [],
    opened: [],
    closed: 0,
    fail: undefined,
    open: async (url) => {
      state.opened.push(url);

      return {
        query: async <Row>(text: string, values: unknown[]): Promise<Row[]> => {
          state.asked.push(text);

          if (state.fail !== undefined) throw new Error(state.fail);

          // Told apart before the step read, because
          // a block's counts join the same table the
          // steps are in.
          if (text.includes('AS delayed')) {
            return [countsRow(state.counts[String(values[1])])] as Row[];
          }

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
    started_at_epoch_ms: String(step.startedAt ?? 1000),
    completed_at_epoch_ms: String(step.completedAt ?? 1200),
    output: '{}',
    error: step.error ?? null,
    child_workflow_id: null,
    serialization: null,
  };
}

/**
 * One live step, at the values `stepRow` above puts
 * in the ledger. Spelled once so a widening of the
 * reading is one edit rather than one per exact
 * comparison, and so what each case is actually
 * about stays legible in its own literal.
 */
function recordedStep(over: {
  name: string;
  nodeId?: string;
  state?: StepState;
  functionId?: number;
}): LiveStep {
  return {
    name: over.name,
    nodeId: over.nodeId ?? over.name,
    state: over.state ?? 'done',
    functionId: over.functionId ?? 0,
    startedAt: 1000,
    completedAt: 1200,
    output: '{}',
    outputCut: false,
    error: undefined,
    childWorkflowId: undefined,
    restored: false,
    reused: false,
  };
}

/** The five numbers, with a zero for whatever a
 *  case is not saying anything about. */
function counts(over: Partial<QueueCounts> = {}): QueueCounts {
  return { queued: 0, delayed: 0, active: 0, done: 0, failed: 0, ...over };
}

/** One row of the counting statement, as
 *  `node-postgres` hands a `bigint` over. */
function countsRow(over: QueueCounts = counts()): Record<string, string> {
  return {
    queued: String(over.queued),
    delayed: String(over.delayed),
    active: String(over.active),
    done: String(over.done),
    failed: String(over.failed),
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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen).toEqual([
      {
        workflowId: RUN_ID,
        workflow: 'counter',
        status: 'SUCCESS',
        outcome: 'done',
        recovered: false,
        recoveryAttempts: 1,
        error: undefined,
        applicationVersion: 'v0.1.0',
        createdAt: 1000,
        startedAt: 1000,
        completedAt: 2000,
        input: undefined,
        forkedFrom: undefined,
        steps: [recordedStep({ name: 'parse_request' })],
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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('waiting');
    expect(seen[0]?.steps).toEqual([
      recordedStep({ name: 'parse_request' }),
      recordedStep({
        name: 'await_reply.register',
        nodeId: 'await_reply',
        state: 'waiting',
        functionId: 1,
      }),
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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('running');
    expect(seen[0]?.steps.map((step) => step.state)).toEqual(['done', 'done']);

    db.status = runRow({ status: 'SUCCESS' });
    await settle(WATCH_INTERVAL_MS);

    expect(seen[1]?.outcome).toBe('done');
  });

  /**
   * A sleep row is written once, before the wait,
   * with the wake deadline as its completion, and is
   * never rewritten. So a run that has woken carries
   * exactly the row a run still asleep carries, and
   * the only thing that tells them apart is the
   * clock.
   */
  it('lets go of a run sitting out a timer', async () => {
    const db = ledger();
    const started = Date.now();
    db.steps = [
      { name: 'before_wait' },
      {
        name: 'DBOS.sleep',
        startedAt: started,
        completedAt: started + 120_000,
      },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('waiting');
    expect(db.closed).toBe(1);
  });

  it('keeps watching a run whose timer has run out', async () => {
    const db = ledger();
    const woke = Date.now() - 1000;
    db.steps = [
      { name: 'before_wait' },
      { name: 'DBOS.sleep', startedAt: woke - 120_000, completedAt: woke },
      { name: 'after_wait' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen[0]?.outcome).toBe('running');
    expect(db.closed).toBe(0);
  });

  it("leaves out the SDK's own bookkeeping", async () => {
    const db = ledger();
    db.steps = [
      { name: 'DBOS.sleep' },
      { name: 'parse_request' },
      { name: 'DBOS.recv' },
    ];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen[0]?.steps).toEqual([
      recordedStep({ name: 'parse_request', functionId: 1 }),
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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle(WATCH_INTERVAL_MS * 5);

    expect(seen).toHaveLength(1);
    expect(db.opened).toEqual([URL]);
  });

  it('gives up when nothing has moved for long enough', async () => {
    const db = ledger();
    db.steps = [{ name: 'parse_request' }];

    const seen: LiveRun[] = [];
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

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
    watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle(WATCH_QUIET_MS);

    expect(seen).toEqual([]);
    expect(db.closed).toBe(1);
  });

  it('stops when it is told to', async () => {
    const db = ledger();

    const seen: LiveRun[] = [];
    const watcher = watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

    await settle();

    expect(seen).toHaveLength(1);

    watcher.stop();
    db.status = runRow({ status: 'SUCCESS' });
    await settle(WATCH_INTERVAL_MS * 5);

    expect(seen).toHaveLength(1);
    expect(db.closed).toBe(1);
  });

  /**
   * What a widened reading carries, and where it
   * stops.
   *
   * A run page draws far more than a list row does —
   * what each step returned, what a failure actually
   * said, which steps came back from the ledger — and
   * all of it is read on the same tick. So the tick
   * hands over the rows it read as well as the
   * reading it made of them, rather than making the
   * page ask the database a second time for something
   * that was in hand.
   */
  describe('what one tick carries', () => {
    it('hands the callback the rows the tick read', async () => {
      const db = ledger(runRow({ status: 'SUCCESS', completed_at: '2000' }));
      db.steps = [{ name: 'parse_request' }];

      const reads: LedgerRead[] = [];
      watchRun(db.open, URL, RUN_ID, [], (_run, read) => reads.push(read));

      await settle();

      expect(reads[0]?.run.workflowId).toBe(RUN_ID);
      expect(reads[0]?.steps.map((step) => step.name)).toEqual([
        'parse_request',
      ]);
    });

    /**
     * A step that ran out of retries stores one error
     * whose message is DBOS's own sentence about the
     * retries. That sentence is bookkeeping; what
     * failed is the last attempt, so that is what the
     * headline says — with every attempt kept
     * underneath it.
     */
    it('reports the last attempt when a step ran out of retries', async () => {
      const db = ledger();
      db.steps = [
        {
          name: 'find_slot',
          error: JSON.stringify({
            json: {
              name: 'Error',
              message:
                'Step find_slot has exceeded its maximum of 2 retries. ' +
                'Previous errors: Error 1: first. Error 2: second',
              errors: [
                { name: 'SlotTaken', message: 'first' },
                {
                  name: 'SlotTaken',
                  message: 'second',
                  // The path a container writes: the
                  // app runs from the directory the
                  // image copied it to, not from
                  // anywhere on this machine.
                  stack:
                    'SlotTaken: second\n' +
                    '    at findSlot (/app/lib/slots.ts:14:9)',
                },
              ],
            },
            __dbos_serializer: 'superjson',
          }),
        },
      ];

      const seen: LiveRun[] = [];
      watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

      await settle();

      const failure = seen[0]?.steps[0]?.error;

      expect(failure?.message).toBe('second');
      expect(failure?.name).toBe('SlotTaken');
      expect(failure?.retriesExhausted).toBe(true);
      expect(failure?.errors).toHaveLength(2);
      expect(failure?.frame).toEqual({
        file: 'lib/slots.ts',
        line: 14,
        column: 9,
      });
    });

    /**
     * Cancelled is one of the three statuses DBOS
     * calls failed, and it is not a failure a person
     * needs to look into — somebody asked for it. It
     * is answered before that set is consulted.
     */
    it('lets go of a run somebody cancelled', async () => {
      const db = ledger(runRow({ status: 'CANCELLED' }));

      const seen: LiveRun[] = [];
      watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

      await settle();

      expect(seen[0]?.outcome).toBe('cancelled');

      await settle(WATCH_INTERVAL_MS * 4);

      expect(seen).toHaveLength(1);
      expect(db.closed).toBe(1);
    });

    /**
     * The three bounds, pinned as numbers rather than
     * only used as names. They are what keeps an
     * editor from reading somebody's database all
     * afternoon, and a change to either is a change
     * to that promise.
     */
    it('reads every half second', () => {
      expect(WATCH_INTERVAL_MS).toBe(500);
    });

    it('gives up after fifteen seconds of silence', () => {
      expect(WATCH_QUIET_MS).toBe(15_000);
    });

    /**
     * A different question from when the watch lets
     * go, which the two cases above it are about.
     * This is the list a session row consults, and
     * an outcome missing from it is a row that
     * never gets a duration and is re-armed by
     * every refresh for ever.
     */
    it('counts done, failed and cancelled as finished', () => {
      expect([...SETTLED].sort()).toEqual(['cancelled', 'done', 'failed']);
    });
  });
  /**
   * A block working through a queue writes no step
   * while it works. The parent records every child
   * start at once and then waits on them, so the
   * only thing that moves is the count of what its
   * children are doing — which is why the watch
   * reads it, and why it is what keeps the watch
   * awake.
   */
  describe('the blocks that queue work', () => {
    it('reads every queue block, and says so under its own id', async () => {
      const db = ledger();
      db.steps = [{ name: 'parse_request' }];
      db.counts = {
        [INDEX_PAGES.queuedName]: counts({
          queued: 42,
          delayed: 2,
          active: 8,
          done: 5,
          failed: 1,
        }),
        'thumbnail.queued.document_ingestion_queued': counts({
          active: 3,
          done: 9,
        }),
      };

      const seen: LiveRun[] = [];
      watchRun(
        db.open,
        URL,
        RUN_ID,
        [
          INDEX_PAGES,
          {
            nodeId: 'thumbnail',
            queuedName: 'thumbnail.queued.document_ingestion_queued',
          },
        ],
        (run) => seen.push(run),
      );

      await settle();

      expect(seen[0]?.queues).toEqual({
        index_pages: {
          queued: 42,
          delayed: 2,
          active: 8,
          done: 5,
          failed: 1,
        },
        thumbnail: counts({ active: 3, done: 9 }),
      });
    });

    it('asks nothing extra of a run with no queue block', async () => {
      const db = ledger();
      db.steps = [{ name: 'parse_request' }];

      const seen: LiveRun[] = [];
      watchRun(db.open, URL, RUN_ID, [], (run) => seen.push(run));

      await settle();

      expect(seen[0]).not.toHaveProperty('queues');
      expect(db.asked.filter((text) => text.includes('AS delayed'))).toEqual(
        [],
      );
    });

    /**
     * The quiet bound is about a run that has
     * stopped saying anything, and a run draining a
     * queue is saying something on every tick with
     * nothing else about it moving at all.
     */
    it('stays awake while the counts are moving', async () => {
      const db = ledger();
      db.steps = [{ name: 'parse_request' }];
      db.counts = { [INDEX_PAGES.queuedName]: counts({ queued: 42 }) };

      const seen: LiveRun[] = [];
      watchRun(db.open, URL, RUN_ID, [INDEX_PAGES], (run) => seen.push(run));

      await settle();

      expect(seen).toHaveLength(1);

      // Long enough that a watch reading only the
      // status column and the steps would have let
      // go twice over.
      for (let done = 1; done <= 40; done += 1) {
        db.counts = {
          [INDEX_PAGES.queuedName]: counts({ queued: 42 - done, done }),
        };
        await settle(WATCH_INTERVAL_MS);
      }

      expect(seen).toHaveLength(41);
      expect(seen.at(-1)?.outcome).toBe('running');
      expect(db.closed).toBe(0);
    });

    it('lets go when the counts stand still too', async () => {
      const db = ledger();
      db.steps = [{ name: 'parse_request' }];
      db.counts = { [INDEX_PAGES.queuedName]: counts({ queued: 42 }) };

      const seen: LiveRun[] = [];
      watchRun(db.open, URL, RUN_ID, [INDEX_PAGES], (run) => seen.push(run));

      await settle(WATCH_QUIET_MS);

      expect(seen[1]).toMatchObject({ outcome: 'quiet' });
      expect(db.closed).toBe(1);
    });
  });
});
