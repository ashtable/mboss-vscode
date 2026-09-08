import type { Database, OpenDatabase } from './db.js';
import { queueCountsQuery, runQuery, stepsQuery } from './queries.js';
import {
  readRun,
  type LiveOutcome,
  type Operation,
  type Reading,
} from './reading.js';
import {
  hasRecovered,
  toRun,
  toStep,
  type BigIntColumn,
  type OperationOutputRow,
  type Run,
  type RunInput,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';

export type { SourceFrame, StepError } from './rows.js';

/**
 * Following one run while it is going.
 *
 * The ledger is the only witness. There is no
 * stream to subscribe to and no callback the app
 * could make into an editor, so this polls — which
 * is a cost somebody else's database pays, and the
 * reason every ending here is a bound rather than a
 * hope. A watch stops when the run is over, when it
 * has parked on a person, or when nothing has moved
 * for long enough that watching is no longer
 * telling anyone anything.
 *
 * Nothing re-arms a stopped watch by itself. The
 * Runs view's refresh button does, which is the
 * whole of the deal: an editor polls while a person
 * is watching a run they started, and never on a
 * timer nobody asked for.
 */

/**
 * One row of a run, as it crosses to a webview.
 *
 * The reading's own step, less the two things only
 * the trace needs: which of the three kinds of owner
 * wrote the row, and where inside its block it ran.
 * A canvas paints blocks and needs neither.
 */
export type LiveStep = Omit<Operation, 'owner' | 'segments'>;

/**
 * One queue block of the workflow being watched:
 * the block, and the name its children register
 * under.
 *
 * Handed in rather than derived here, because a
 * watch polls a database and never looked for a
 * document — the name only the document can give
 * has to come with the arming.
 */
export type QueueNode = { nodeId: string; queuedName: string };

/** What one queue block's children are doing. */
export type QueueCounts = {
  /** `ENQUEUED` + `DELAYED`: the block line's
   *  second number. */
  queued: number;

  /** `DELAYED` alone. */
  delayed: number;

  /** `PENDING`: claimed and running. */
  active: number;

  done: number;

  failed: number;
};

export type LiveRun = {
  workflowId: string;

  /** The workflow's name — how a canvas knows a run
   *  is about its document. */
  workflow: string;

  /** DBOS's own word, shown as it is. */
  status: string;

  steps: LiveStep[];

  /** What each of this workflow's queue blocks is
   *  doing, under the block's own id. Absent for a
   *  workflow that has none. */
  queues?: Record<string, QueueCounts>;

  /** Sticky: once the ledger has said a run was
   *  picked back up, it stays said. */
  recovered: boolean;

  /** The raw column, which counts dispatches rather
   *  than crashes. */
  recoveryAttempts: number;

  outcome: LiveOutcome;

  error?: string;

  applicationVersion: string | undefined;

  createdAt: number;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** What the run was started with, printed. */
  input: string | undefined;

  forkedFrom: string | undefined;
};

/** The rows one tick read, handed over beside the
 *  reading made of them so nothing has to ask the
 *  database again for what is already in hand. */
export type LedgerRead = { run: Run; steps: Step[] };

/**
 * The outcomes a run will not move on from.
 *
 * Not the question of when a watch lets go, which
 * is any outcome but `running` — `waiting` and
 * `quiet` stop one too, over runs that may yet
 * move. This is what a session row asks before it
 * stamps how long the run took and stops being
 * re-armed.
 */
export const SETTLED: readonly LiveOutcome[] = ['done', 'failed', 'cancelled'];

export type RunWatcher = { stop(): void };

/**
 * Arming a watch, as whoever arms one takes it.
 *
 * The panel's store holds a database opener
 * already, so it hands over its own rather than
 * carrying a second — which is what lets the real
 * `watchRun` be passed straight in and a spec pass
 * a function that arms nothing.
 */
export type RunWatch = (
  open: OpenDatabase,
  url: string,
  workflowId: string,
  queueNodes: readonly QueueNode[],
  onChange: (run: LiveRun, read: LedgerRead) => void,
) => RunWatcher;

/**
 * Often enough that a step landing looks immediate,
 * and slow enough that a run of a hundred steps is
 * still a couple of hundred reads.
 */
export const WATCH_INTERVAL_MS = 500;

/**
 * How long a run may say nothing before the watch
 * lets go.
 *
 * The bound that keeps an extension from reading
 * somebody's database all afternoon over a run that
 * is stuck, or over an app that died without
 * writing an ending.
 */
export const WATCH_QUIET_MS = 15_000;

export function watchRun(
  open: OpenDatabase,
  url: string,
  workflowId: string,
  queueNodes: readonly QueueNode[],
  onChange: (run: LiveRun, read: LedgerRead) => void,
): RunWatcher {
  /**
   * One connection for the life of the watch.
   *
   * The panel's other reads open and close around
   * each question, because a connection held for as
   * long as an editor window keeps a slot on
   * somebody's database all day. A watch is not
   * that: it lasts as long as one run a person
   * started is moving, and opening a pool twice a
   * second would cost more than the slot it saves.
   */
  let held: Database | undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let recovered = false;
  let last: LiveRun | undefined;
  let lastRead: LedgerRead | undefined;
  let movedAt = Date.now();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;

    clearTimeout(timer);
    timer = undefined;

    const connection = held;
    held = undefined;
    void connection?.close().catch(() => undefined);
  };

  const report = (run: LiveRun, read: LedgerRead): void => {
    last = run;
    lastRead = read;
    movedAt = Date.now();
    onChange(run, read);
  };

  const connect = async (): Promise<Database | undefined> => {
    if (held !== undefined) return held;

    let opened: Database;

    try {
      opened = await open(url);
    } catch {
      return undefined;
    }

    // A stop that landed while this was connecting
    // owns nothing to close, so close it here.
    if (stopped) {
      void opened.close().catch(() => undefined);

      return undefined;
    }

    held = opened;

    return held;
  };

  /**
   * What every queue block of this run is doing, on
   * the connection the tick already holds.
   *
   * One read per block rather than one for all of
   * them: a block's children are found through the
   * name they register under, and a workflow has
   * one or two queue blocks rather than dozens.
   *
   * This is also the only thing a run draining a
   * queue says while it drains — the parent records
   * every child start at once and then waits — so
   * it is what keeps such a run from being read as
   * having gone quiet.
   */
  const queueCountsOn = async (
    database: Database,
  ): Promise<Record<string, QueueCounts> | undefined> => {
    if (queueNodes.length === 0) return undefined;

    const counts: Record<string, QueueCounts> = {};

    for (const node of queueNodes) {
      const query = queueCountsQuery(workflowId, node.queuedName);
      const rows = await database.query<QueueCountsRow>(
        query.text,
        query.values,
      );

      counts[node.nodeId] = toQueueCounts(rows[0]);
    }

    return counts;
  };

  const readTick = async (): Promise<
    { live: LiveRun; read: LedgerRead } | undefined
  > => {
    const database = await connect();
    if (database === undefined) return undefined;

    try {
      const one = runQuery(workflowId);
      const rows = await database.query<WorkflowStatusRow>(
        one.text,
        one.values,
      );
      const row = rows[0];

      // Not written yet. A manual run is recorded
      // under an id this side minted, so the panel
      // knows about it before the app does.
      if (row === undefined) return undefined;

      const steps = stepsQuery(workflowId);
      const recorded = (
        await database.query<OperationOutputRow>(steps.text, steps.values)
      ).map(toStep);

      const run = toRun(row);
      recovered = recovered || hasRecovered(run);

      const queues = await queueCountsOn(database);

      // A watch polls a database and never looked
      // for a document, so the grammar's answer
      // about which block a row names is the only
      // one there is.
      const reading = readRun(run, recorded, 'unasked', recovered, Date.now());

      return {
        live: {
          ...liveRunOf(run, reading),
          ...(queues === undefined ? {} : { queues }),
        },
        read: { run, steps: recorded },
      };
    } catch {
      // A read that did not answer is a tick that
      // said nothing. If the database never comes
      // back, the quiet bound ends the watch.
      return undefined;
    }
  };

  const tick = async (): Promise<void> => {
    const seen = await readTick();
    if (stopped) return;

    if (seen !== undefined && !same(seen.live, last)) {
      report(seen.live, seen.read);

      if (seen.live.outcome !== 'running') return stop();
    } else if (Date.now() - movedAt >= WATCH_QUIET_MS) {
      // Nothing to say about a run whose row never
      // appeared — only that nobody is watching it
      // any more.
      if (last !== undefined && lastRead !== undefined) {
        report({ ...last, outcome: 'quiet' }, lastRead);
      }

      return stop();
    }

    timer = setTimeout(() => void tick(), WATCH_INTERVAL_MS);
  };

  // The first read goes on the same path as every
  // other one, so that a watch is a loop with one
  // entrance rather than a read plus a loop.
  timer = setTimeout(() => void tick(), 0);

  return { stop };
}

/** A row of the counting statement, as selected. */
type QueueCountsRow = {
  queued: BigIntColumn;
  delayed: BigIntColumn;
  active: BigIntColumn;
  done: BigIntColumn;
  failed: BigIntColumn;
};

/**
 * The five numbers, as `node-postgres` hands them
 * over.
 *
 * The statement is an ungrouped aggregate, so it
 * answers exactly one row — all zeros for a block
 * the run has not reached yet. The fallback is for
 * a driver that answered with none at all.
 */
function toQueueCounts(row: QueueCountsRow | undefined): QueueCounts {
  return {
    queued: Number(row?.queued ?? 0),
    delayed: Number(row?.delayed ?? 0),
    active: Number(row?.active ?? 0),
    done: Number(row?.done ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

/**
 * A reading, as it crosses to a webview.
 *
 * `steps` keeps the rows a block owns. Everything
 * the SDK recorded for itself was read — the outage
 * inference and the outcome both needed it — but a
 * canvas has no block to put it on.
 */
export function liveRunOf(run: Run, reading: Reading): LiveRun {
  return {
    workflowId: run.workflowId,
    workflow: run.name,
    status: run.status,
    steps: reading.steps.filter((one) => one.owner !== 'sdk').map(liveStepOf),
    recovered: reading.recovered,
    recoveryAttempts: run.recoveryAttempts,
    outcome: reading.outcome,
    error: run.error,
    applicationVersion: run.applicationVersion,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    input: printed(run.input),
    forkedFrom: run.forkedFrom,
  };
}

/** Named field by field rather than spread, so that
 *  widening the reading is a decision about what
 *  crosses rather than something that just happens. */
function liveStepOf(operation: Operation): LiveStep {
  return {
    name: operation.name,
    nodeId: operation.nodeId,
    state: operation.state,
    functionId: operation.functionId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    output: operation.output,
    outputCut: operation.outputCut,
    error: operation.error,
    childWorkflowId: operation.childWorkflowId,
    restored: operation.restored,
    reused: operation.reused,
  };
}

/** What a run was started with, as text a panel can
 *  put in a cell. */
function printed(input: RunInput | undefined): string | undefined {
  if (input === undefined || input.shape === 'none') return undefined;

  return input.shape === 'payload'
    ? JSON.stringify(input.value, null, 2)
    : input.text;
}

/**
 * Whether two readings say the same thing.
 *
 * Compared as text because both sides are built
 * field by field by the same function, so their
 * shapes match and this is the deep comparison it
 * looks like.
 */
function same(run: LiveRun, last: LiveRun | undefined): boolean {
  return last !== undefined && JSON.stringify(run) === JSON.stringify(last);
}
