import type { Database, OpenDatabase } from './db.js';
import { FAILED_STATUSES, runQuery, stepsQuery } from './queries.js';
import {
  hasRecovered,
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';

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
export type LiveOutcome = 'running' | 'done' | 'failed' | 'waiting' | 'quiet';

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

  outcome: LiveOutcome;

  error?: string;
};

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
  onChange: (run: LiveRun) => void,
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

/** DBOS's own three, widened so a status read out
 *  of a row can be compared against them. */
const FAILED: readonly string[] = FAILED_STATUSES;

/** Steps the SDK records for its own bookkeeping —
 *  `DBOS.sleep`, `DBOS.recv`, `DBOS.setEvent` —
 *  which belong to no block on any canvas. */
const SDK_PREFIX = 'DBOS.';

/** The two steps a durable wait is made of: the row
 *  that says which run is parked, and its deletion
 *  once the run wakes. */
const REGISTERED = '.register';

const CLEARED = '.clear';

export function watchRun(
  open: OpenDatabase,
  url: string,
  workflowId: string,
  onChange: (run: LiveRun) => void,
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

  const report = (run: LiveRun): void => {
    last = run;
    movedAt = Date.now();
    onChange(run);
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

  const readRun = async (): Promise<LiveRun | undefined> => {
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

      return liveRun(run, recorded, recovered);
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

    if (seen !== undefined && !same(seen, last)) {
      report(seen);

      if (seen.outcome !== 'running') return stop();
    } else if (Date.now() - movedAt >= WATCH_QUIET_MS) {
      // Nothing to say about a run whose row never
      // appeared — only that nobody is watching it
      // any more.
      if (last !== undefined) report({ ...last, outcome: 'quiet' });

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

function liveRun(run: Run, steps: Step[], recovered: boolean): LiveRun {
  const own = steps.filter((step) => !step.name.startsWith(SDK_PREFIX));
  const live = liveSteps(own);

  return {
    workflowId: run.workflowId,
    workflow: run.name,
    status: run.status,
    steps: live,
    recovered,
    outcome: outcomeOf(run, live),
    error: run.error,
  };
}

function liveSteps(steps: Step[]): LiveStep[] {
  const parked = parkedNodes(steps);

  return steps.map((step) => {
    const nodeId = nodeOf(step.name);

    return {
      name: step.name,
      nodeId,
      state: stateOf(step, parked.has(nodeId)),
    };
  });
}

/**
 * The blocks a run is parked on.
 *
 * A wait writes `.register` when the run parks and
 * `.clear` when it wakes, and can write a reminder
 * in between — so the question is whether a block's
 * latest registration has been cleared, and not
 * whether its latest row happens to be one.
 */
function parkedNodes(steps: Step[]): Set<string> {
  const registered = new Map<string, number>();
  const cleared = new Map<string, number>();

  steps.forEach((step, index) => {
    const nodeId = nodeOf(step.name);

    if (step.name.endsWith(REGISTERED)) registered.set(nodeId, index);
    if (step.name.endsWith(CLEARED)) cleared.set(nodeId, index);
  });

  const parked = new Set<string>();

  for (const [nodeId, at] of registered) {
    if ((cleared.get(nodeId) ?? -1) < at) parked.add(nodeId);
  }

  return parked;
}

function stateOf(step: Step, parked: boolean): StepState {
  if (step.error !== undefined) return 'failed';

  return parked ? 'waiting' : 'done';
}

/**
 * The block a recorded step belongs to.
 *
 * The compiler names a step for its block and then
 * appends where it ran — `.r${round}` for a loop,
 * `[${index}]` for a fan-out, `.register`,
 * `.clear`, `.ask` and `.resend.${n}` for the parts
 * of a wait — so everything up to the first `.` or
 * `[` is the block's id.
 */
function nodeOf(name: string): string {
  const cut = name.search(/[.[]/);

  return cut === -1 ? name : name.slice(0, cut);
}

/**
 * Where the run is, as the ledger has it.
 *
 * A step that threw is not an ending: DBOS may
 * retry it, and only the status column says the run
 * is over.
 */
function outcomeOf(run: Run, steps: LiveStep[]): LiveOutcome {
  if (run.status === SUCCEEDED) return 'done';
  if (FAILED.includes(run.status)) return 'failed';
  if (steps.some((step) => step.state === 'waiting')) return 'waiting';

  return 'running';
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
