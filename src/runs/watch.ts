import { ownerOf } from '../core/rules.js';

import type { Database, OpenDatabase } from './db.js';
import { FAILED_STATUSES, runQuery, stepsQuery } from './queries.js';
import { parkedNodes } from './operations.js';
import {
  hasRecovered,
  outputIn,
  stepError,
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type RunInput,
  type Step,
  type StepError,
  type WorkflowStatusRow,
} from './rows.js';
import { runTimeline } from './timeline.js';

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
 * What the ledger can say about one step.
 *
 * There is no `running`: `dbos.operation_outputs`
 * records a step when it completes, never when it
 * starts. Where a run has got to is derived from
 * the edges of the graph, by whoever is drawing
 * one.
 */
export type StepState = 'done' | 'failed' | 'waiting';

export type LiveStep = {
  /** The name the ledger recorded, rounds, item
   *  indexes and wait suffixes and all. */
  name: string;

  /** The block it belongs to. */
  nodeId: string;

  state: StepState;

  /** DBOS's own numbering, which is the order the
   *  steps ran in and the handle a replay takes. */
  functionId: number;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** What it returned, cut where it was long. */
  output: string | undefined;

  outputCut: boolean;

  outputBytes: number;

  error: StepError | undefined;

  childWorkflowId: string | undefined;

  /**
   * Whether this row came from the run this one was
   * forked from rather than from this run. A forked
   * run inherits the rows before the fork point,
   * timestamps and all, so a row completed before
   * this run was created is one of them.
   */
  reused: boolean;

  /** Whether this row came back from the ledger
   *  rather than running again after a crash. */
  restored: boolean;
};

/**
 * Where the watch left the run.
 *
 * `waiting` and `quiet` are both stopped watches
 * and are kept apart on purpose. A parked run is
 * waiting on a person and will move when they act;
 * a quiet one is waiting on nobody and the watch
 * simply let go of it. Telling somebody a quiet run
 * is waiting would send them looking for an email
 * that was never sent.
 */
export type LiveOutcome =
  'running' | 'done' | 'failed' | 'waiting' | 'quiet' | 'cancelled';

export type LiveRun = {
  workflowId: string;

  /** The workflow's name — how a canvas knows a run
   *  is about its document. */
  workflow: string;

  /** DBOS's own word, shown as it is. */
  status: string;

  steps: LiveStep[];

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

/** The one status that means it worked. */
const SUCCEEDED = 'SUCCESS';

/** One of the three DBOS calls failed, told apart
 *  because somebody asked for it. */
const CANCELLED = 'CANCELLED';

/** DBOS's own three, widened so a status read out
 *  of a row can be compared against them. */
const FAILED: readonly string[] = FAILED_STATUSES;

export function watchRun(
  open: OpenDatabase,
  url: string,
  workflowId: string,
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

  const readRun = async (): Promise<
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

      return {
        live: toLiveRun(run, recorded, recovered),
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
    const seen = await readRun();
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

/**
 * One reading of a run, from the rows a tick read.
 *
 * `steps` keeps the rows a block owns. Everything
 * the SDK recorded for itself is still read — the
 * outage inference and the outcome both need it —
 * but a canvas has no block to put it on.
 *
 * `now` is taken once and passed down, the way
 * `runTimeline` takes one, so that a bar's end and
 * whether a timer has run out are answered about
 * the same moment.
 */
export function toLiveRun(
  run: Run,
  steps: Step[],
  recovered: boolean,
  now = Date.now(),
): LiveRun {
  const own = steps.filter((step) => ownerOf(step.name).kind !== 'sdk');

  // Computed over every row, because a wait the SDK
  // wrote fills a hole that would otherwise look
  // like an outage, and then attached to the rows a
  // block owns by the number DBOS gave them.
  const restored = new Map(
    runTimeline(run, steps, now).steps.map((step) => [
      step.functionId,
      step.restored,
    ]),
  );

  const live = liveSteps(own, run, restored);

  return {
    workflowId: run.workflowId,
    workflow: run.name,
    status: run.status,
    steps: live,
    recovered,
    recoveryAttempts: run.recoveryAttempts,
    outcome: outcomeOf(run, live, steps, now),
    error: run.error,
    applicationVersion: run.applicationVersion,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    input: printed(run.input),
    forkedFrom: run.forkedFrom,
  };
}

function liveSteps(
  steps: Step[],
  run: Run,
  restored: ReadonlyMap<number, boolean>,
): LiveStep[] {
  const parked = parkedNodes(steps.map((one) => one.name));

  return steps.map((step) => {
    const owner = ownerOf(step.name);
    const nodeId = owner.kind === 'node' ? owner.nodeId : step.name;
    const output = outputIn(step.output ?? null);

    return {
      name: step.name,
      nodeId,
      state: stateOf(step, parked.has(nodeId)),
      functionId: step.functionId,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      output: step.output === undefined ? undefined : output.text,
      outputCut: output.cut,
      outputBytes: output.bytes,
      error: stepError(step.failure),
      childWorkflowId: step.childWorkflowId,
      reused: reusedFrom(step, run),
      restored: restored.get(step.functionId) ?? false,
    };
  });
}

/**
 * Whether a row belongs to the run this one was
 * forked from.
 *
 * A fork inherits the rows before the fork point
 * with the timestamps they were first written with,
 * so a row that finished before this run was even
 * created never ran here.
 */
function reusedFrom(step: Step, run: Run): boolean {
  return (
    run.forkedFrom !== undefined &&
    step.completedAt !== undefined &&
    step.completedAt < run.createdAt
  );
}

/** What a run was started with, as text a panel can
 *  put in a cell. */
function printed(input: RunInput | undefined): string | undefined {
  if (input === undefined || input.shape === 'none') return undefined;

  return input.shape === 'payload'
    ? JSON.stringify(input.value, null, 2)
    : input.text;
}

function stateOf(step: Step, parked: boolean): StepState {
  if (step.error !== undefined) return 'failed';

  return parked ? 'waiting' : 'done';
}

/**
 * Where the run is, as the ledger has it.
 *
 * A step that threw is not an ending: DBOS may
 * retry it, and only the status column says the run
 * is over.
 */
function outcomeOf(
  run: Run,
  steps: LiveStep[],
  all: readonly Step[],
  now: number,
): LiveOutcome {
  if (run.status === SUCCEEDED) return 'done';

  // Before the failed set, which contains it.
  // Somebody asked for this one; it is not a failure
  // anybody has to look into.
  if (run.status === CANCELLED) return 'cancelled';
  if (FAILED.includes(run.status)) return 'failed';
  if (steps.some((step) => step.state === 'waiting')) return 'waiting';

  return asleep(all, now) ? 'waiting' : 'running';
}

/**
 * Whether the run is sitting out a timer *now*.
 *
 * A sleep row records the wake deadline as its
 * completion and is written once, before the wait,
 * and never rewritten — so a deadline later than the
 * row's own start says the run slept, not that it is
 * still sleeping. Asked against the clock instead:
 * a run whose deadline has passed has woken and may
 * well be working, and answering `waiting` for it
 * would stop the watch and send somebody looking for
 * an email that was never sent.
 *
 * A deadline still ahead is the case worth stopping
 * for. Nothing is happening in that run, so the
 * watch may let go rather than reading somebody's
 * database every half second for a day.
 *
 * Ungated on purpose. An older SDK does not write a
 * row of this shape at all, so the rule is simply
 * inert there and needs no version check to make it
 * safe. Only the words a page draws about it are
 * gated, and those are drawn where a lockfile can be
 * read.
 */
function asleep(steps: readonly Step[], now: number): boolean {
  return steps.some(
    (step) =>
      step.name === 'DBOS.sleep' &&
      step.completedAt !== undefined &&
      step.completedAt > now,
  );
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
