import { traceGrammar, traceOwners, type RecordedRow } from '../core/index.js';
import {
  ownerOf,
  type RecordedSegment,
  type WorkflowIR,
} from '../core/rules.js';
import { runWord, type RunWord } from '../webview/states.js';

import { FAILED_STATUSES, SUCCEEDED_STATUS } from './queries.js';
import {
  stepError,
  storedValue,
  type Run,
  type Step,
  type StepError,
} from './rows.js';
import { runTimeline, type Outage } from './timeline.js';

/**
 * One reading of a run: its rows, attributed, and
 * where it has got to — answered once.
 *
 * A run is nothing but the rows it wrote as it went,
 * and every question anybody asks about one is a
 * projection of those rows. This is the only place
 * that projection is made. Three used to exist —
 * one for the chart, one for the trace, one for the
 * canvas overlay — each deriving the same facts from
 * the same rows and each reading its own clock, so
 * the page could in principle draw a bar ending at
 * one moment and a timer running out at another.
 *
 * `now` is therefore a parameter and not a default.
 * A default is what let three callers take three
 * clocks without any of them saying so, and the one
 * answer that turns on it — whether a run is still
 * sitting out a timer — decides whether a watch
 * keeps reading somebody's database.
 *
 * Host-only, where it used to be browser-safe: a
 * block that writes no row of its own is found by
 * the compiler's own walk over the document, and
 * that walk sits behind the barrel that reaches the
 * layout engine. Nothing on the browser side loses
 * by it — every frame is handed a reading rather
 * than making one.
 *
 * No database and no clock of its own. Whether the
 * run recovered is sticky state the watch holds
 * across ticks, so it arrives as an answer rather
 * than being re-derived here.
 */

/**
 * What the ledger can say about one row.
 *
 * There is no `running`: `dbos.operation_outputs`
 * records a step when it completes, never when it
 * starts. Where a run has got to is derived from the
 * edges of the graph, by whoever is drawing one.
 */
export type StepState = 'done' | 'failed' | 'waiting';

/** Who a recorded row belongs to. */
export type OperationOwner = 'node' | 'sdk' | 'unmapped';

/**
 * What the reader knows about the drawing.
 *
 * Three answers, because `undefined` cannot carry
 * all of them and two callers used to mean opposite
 * things by it. A run page holds the document, or
 * knows the project no longer has one of that name.
 * A watch polls a database and never looked.
 *
 * `lost` and `unasked` differ in what they let a
 * name mean. With the document gone, a name that
 * parses is still a name for nothing anybody can
 * click, and a trace drawn from it would group rows
 * under blocks that no longer exist. With nobody
 * having asked, the grammar is the only evidence
 * there is, and refusing to use it would tell a
 * canvas that every row belongs to nothing.
 */
export type Drawing = WorkflowIR | 'lost' | 'unasked';

/** One recorded row, attributed and drawable. */
export type Operation = {
  /** The name the ledger recorded, rounds, item
   *  indexes and wait suffixes and all. */
  name: string;

  /** The block it belongs to, where it belongs to
   *  one this drawing still has. */
  nodeId: string | undefined;

  owner: OperationOwner;

  /** Where inside the block it ran: which round,
   *  which item, which part of a wait. */
  segments: readonly RecordedSegment[];

  state: StepState;

  /** DBOS's own numbering, which is the order the
   *  rows ran in and the handle a replay takes. */
  functionId: number;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** What it returned, as the bytes were stored, cut
   *  where they were long. */
  output: string | undefined;

  /** The same value with the serializer's wrapper
   *  off, printed on one line for a panel to draw. */
  shown: string | undefined;

  outputCut: boolean;

  /** How big the stored value was before any cut. */
  bytes: number;

  /** Whether the step returned nothing at all, which
   *  is not the same as returning `null`. */
  absent: boolean;

  error: StepError | undefined;

  childWorkflowId: string | undefined;

  /** Whether this row came back from the ledger
   *  rather than running again after a crash. */
  restored: boolean;

  /** Whether it was carried over from the run this
   *  one was replayed from. See `reusedRow`. */
  reused: boolean;
};

/**
 * Whether a row came over from the run this one was
 * replayed from.
 *
 * A fact about timestamps and nothing else. A fork
 * copies every operation the run it came from had
 * already finished, keeping the moments they were
 * first written with, so a row that completed
 * before its own run was created is one of the
 * copied ones. Nothing in the schema marks a row as
 * copied, and this is the same comparison the fork
 * query makes in the database.
 *
 * Not the same as `restored`, which is about a
 * crash inside one run. This is about two runs.
 */
export function reusedRow(step: Step, createdAt: number): boolean {
  return step.completedAt !== undefined && step.completedAt < createdAt;
}

/**
 * One run, read.
 *
 * `steps` is every row, the SDK's own included, in
 * the order DBOS numbered them — a wait the SDK
 * wrote is what fills a hole that would otherwise be
 * read as a crash, and what says a block is parked.
 * Whoever draws only a workflow's own work filters
 * on `owner`.
 *
 * `from`, `to` and `outage` are the window those
 * rows are drawn in, spelled the way `runTimeline`
 * answers them, because that is the module that owns
 * the outage inference and this one only asks it.
 */
export type Reading = {
  steps: Operation[];

  from: number;

  to: number;

  outage: Outage | undefined;

  /** Whether the run is sitting on somebody — a
   *  block parked on a person, or a timer still
   *  ahead of now — answered once with every row
   *  the run wrote, and carried so that nobody who
   *  draws the run asks the steps the same question
   *  again and gets half the answer. */
  parked: boolean;

  /** Where the run is, in the one word every
   *  surface says it in. Never `quiet`: that is the
   *  watch's word, and the watch adds it. */
  outcome: RunWord;

  /** Sticky: once the ledger has said a run was
   *  picked back up, it stays said. */
  recovered: boolean;
};

/** DBOS's own three and the one that worked, so a
 *  status read out of a row can be asked whether the
 *  run is over at all. */
const ENDED: readonly string[] = [SUCCEEDED_STATUS, ...FAILED_STATUSES];

/**
 * Whether the ledger says this run is over.
 *
 * Asked of the status column and nothing else, so it
 * answers about a run nobody has read the steps of —
 * which is what deciding whether to poll one needs.
 */
export function finished(run: Run): boolean {
  return ENDED.includes(run.status);
}

/**
 * The run, read.
 *
 * `drawing` and `document` are two arguments and
 * not one because they answer different questions.
 * The drawing decides whether a name a row carries
 * still belongs to a block anybody can click, and a
 * watch has deliberately not looked. The document
 * is where a row carrying no name at all is placed,
 * and a watch is handed one for exactly that.
 */
export function readRun(
  run: Run,
  steps: Step[],
  drawing: Drawing,
  recovered: boolean,
  now: number,
  document: WorkflowIR | undefined,
): Reading {
  // The blocks the drawing has; the empty set where
  // the project lost it, which attributes nothing;
  // and nothing at all where nobody asked, which
  // gates nothing. See `attributed`.
  const known =
    drawing === 'unasked'
      ? undefined
      : drawing === 'lost'
        ? new Set<string>()
        : new Set(drawing.nodes.map((node) => node.id));

  const parked = parkedNodes(steps.map((step) => step.name));
  const timers = timerRows(document, steps, now);
  const timeline = runTimeline(run, steps, now);
  const restored = new Map(
    timeline.steps.map((step) => [step.functionId, step.restored]),
  );

  const operations = steps.map((step) =>
    attributed(
      step,
      known,
      parked,
      timers.get(step.functionId),
      restored.get(step.functionId) ?? false,
      run.createdAt,
    ),
  );

  // A step that threw is not an ending: DBOS may
  // retry it, and only the status column says the
  // run is over. What this reader adds to the
  // status is whether the run is parked, which it
  // alone can see: a block waiting on a person, or
  // a timer still ahead of now.
  const parkedRun =
    operations.some((one) => one.state === 'waiting') || asleep(steps, now);

  return {
    steps: operations,
    from: timeline.from,
    to: timeline.to,
    outage: timeline.outage,
    parked: parkedRun,
    outcome: runWord({
      status: run.status,
      recoveryAttempts: run.recoveryAttempts,
      parked: parkedRun,
    }),
    recovered,
  };
}

/**
 * One row, attributed.
 *
 * Two questions are kept apart here on purpose.
 * Which block a row belongs to is a question about
 * the row's *name*, and the compiler's own grammar
 * answers it without seeing a document. Whether that
 * block still exists is a question about the
 * *document*, and only the document answers it — a
 * workflow somebody edited between the run and the
 * reading has rows naming blocks that are gone, and
 * a panel that threw on one would fail exactly when
 * somebody needs it.
 *
 * So `unmapped` means the drawing was consulted and
 * does not have this block — including the case
 * where the project lost the document altogether —
 * or the grammar could not read the name at all.
 * Where nobody consulted a drawing there is no such
 * answer to give, and `known` is left undefined so
 * the grammar's answer stands.
 *
 * Whether the block is parked is asked of the name
 * either way. A run sitting in somebody's inbox is
 * sitting there whether or not the block is still
 * drawn, and the row that says so is the only
 * evidence there is.
 *
 * `timer` is the third answer, and the only one the
 * name cannot give at all: a row the walk placed
 * inside a wait on the clock. See `timerRows`.
 */
function attributed(
  step: Step,
  known: ReadonlySet<string> | undefined,
  parked: ReadonlySet<string>,
  timer: TimerRow | undefined,
  restored: boolean,
  createdAt: number,
): Operation {
  const named = ownerOf(step.name);
  const value = storedValue(step.output ?? null);
  const failure = stepError(step.failure);

  const nodeId =
    timer?.nodeId ??
    (named.kind !== 'node'
      ? undefined
      : known === undefined || known.has(named.nodeId)
        ? named.nodeId
        : undefined);

  // Where the run is sitting: a block whose latest
  // registration nobody has cleared, or a timer
  // whose deadline is still ahead.
  const waiting =
    timer !== undefined
      ? timer.waiting
      : named.kind === 'node' && parked.has(named.nodeId);

  return {
    name: step.name,
    nodeId,
    owner:
      nodeId !== undefined ? 'node' : named.kind === 'sdk' ? 'sdk' : 'unmapped',
    segments: named.kind === 'node' ? named.segments : [],
    state: failure !== undefined ? 'failed' : waiting ? 'waiting' : 'done',
    functionId: step.functionId,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    output: step.output === undefined ? undefined : value.raw,
    shown: step.output === undefined ? undefined : value.shown,
    outputCut: value.cut,
    bytes: value.bytes,
    absent: value.absent,
    error: failure,
    childWorkflowId: step.childWorkflowId,
    restored,
    reused: reusedRow(step, createdAt),
  };
}

/** One recorded row a wait on the clock wrote, and
 *  whether the run is still sitting it out. */
type TimerRow = { nodeId: string; waiting: boolean };

/** The name the SDK records a durable pause under,
 *  which is the same string whichever block asked
 *  for it. */
const SLEEP = 'DBOS.sleep';

/**
 * Which rows are a wait-on-the-clock's own.
 *
 * Such a wait compiles to a bare `await
 * DBOS.sleep(ms)` and writes nothing under its own
 * name, so the SDK's row is the only evidence the
 * block ran at all. Which wait wrote it cannot be
 * read off the name — two waits in one document
 * write the identical string — so it is asked of
 * where the row fell, which only the walk over the
 * saved document knows.
 *
 * Only a wait on the clock. A wait on a form and an
 * approval park on `DBOS.recv` with a sleep beside
 * it timing the park out, and both already write
 * rows of their own; giving them the SDK's pair as
 * well would draw one block twice.
 *
 * No cache. The walk is an in-memory plan of one
 * document, and every caller that reaches here has
 * just read somebody's database.
 */
function timerRows(
  document: WorkflowIR | undefined,
  steps: readonly Step[],
  now: number,
): ReadonlyMap<number, TimerRow> {
  const rows = new Map<number, TimerRow>();
  if (document === undefined) return rows;

  const timers = new Set(
    document.nodes
      .filter(
        (node) =>
          node.kind === 'durableWait' && node.config.source.kind === 'timer',
      )
      .map((node) => node.id),
  );

  if (timers.size === 0) return rows;

  let owners: ReadonlyMap<number, string>;

  try {
    owners = traceOwners(traceGrammar(document), steps.map(recordedRow));
  } catch {
    // The compiler refuses a document it cannot
    // describe, and a run of one is still a run. A
    // panel that threw over it would go blank
    // exactly where somebody needs to read what
    // happened.
    return rows;
  }

  for (const step of steps) {
    if (step.name !== SLEEP) continue;

    const nodeId = owners.get(step.functionId);
    if (nodeId === undefined || !timers.has(nodeId)) continue;

    rows.set(step.functionId, {
      nodeId,
      // The row records the wake deadline as its
      // completion and is written before the sleep,
      // so only the clock says whether the run is
      // still sitting it out.
      waiting: step.completedAt !== undefined && step.completedAt > now,
    });
  }

  return rows;
}

/** A row as the compiler's walk reads one: the
 *  handle, the name, and whether it finished. */
export function recordedRow(step: Step): RecordedRow {
  return {
    functionId: step.functionId,
    name: step.name,
    completedAt: step.completedAt,
    failed: step.error !== undefined,
  };
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
export function parkedNodes(names: readonly string[]): Set<string> {
  const registered = new Map<string, number>();
  const cleared = new Map<string, number>();

  names.forEach((name, index) => {
    const owner = ownerOf(name);
    if (owner.kind !== 'node') return;

    const last = owner.segments.at(-1)?.kind;

    if (last === 'register') registered.set(owner.nodeId, index);
    if (last === 'clear') cleared.set(owner.nodeId, index);
  });

  const parked = new Set<string>();

  for (const [nodeId, at] of registered) {
    if ((cleared.get(nodeId) ?? -1) < at) parked.add(nodeId);
  }

  return parked;
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
      step.name === SLEEP &&
      step.completedAt !== undefined &&
      step.completedAt > now,
  );
}
