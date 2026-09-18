import type { ToolLine } from '../acp/transcript.js';
import {
  canvasWords,
  durationWords,
  kindWords,
  sizeWords,
} from '../canvas/words.js';
import { replayBoundaries, type Unoffered } from '../core/index.js';
import {
  ownerOf,
  type NodeBox,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import { messages } from '../messages.js';
import { filled } from '../webview/fill.js';
import { shortRunId } from '../webview/ids.js';
import {
  glyphStateOf,
  runWord,
  settled,
  type RunWord,
} from '../webview/states.js';
import { clock, duration, fine, when } from '../webview/time.js';
import type {
  InspectorMode,
  ShownRun,
  RunLevel,
  RunLineage,
  RunRow,
  SeeGraph,
  SeeInit,
  SeeRun,
  SessionRow,
  TraceDetail,
  TraceRowView,
} from '../webview/protocol.js';

import type {
  OperationEvidence,
  RecordedRunEvidence,
  RefusedRunEvidence,
  RunEvidence,
} from './evidence.js';
import type { Lineage } from './openRun.js';
import { runWords, seeWords } from './words.js';
import { decidedArms, wakeOf, type Wake } from './operations.js';
import { IN_FLIGHT_STATUSES } from './queries.js';
import { replayRowReason } from './replayZone.js';
import {
  headlineRow,
  readRun,
  traceOf,
  type Operation,
  type Reading,
} from './reading.js';
import {
  hasRecovered,
  inlineJson,
  recoveriesOf,
  type Run,
  type RunInput,
  type Step,
  recordedValue,
  type RecordedValue,
} from './rows.js';
import type { SessionRun } from './sessionLog.js';
import { inspectedRunOf, liveRunOf, type LiveRun } from './watch.js';
import type { ProjectWorkflow } from './workflows.js';

/**
 * A row of the run history, a row of this session,
 * and one run in detail, in the words the views
 * draw.
 *
 * What a person reads on a row is resolved here,
 * because a webview has no localization bundle;
 * the store that holds the rows renders the list
 * from these, and the run tab draws its trace from
 * the rows worded here.
 */

/** Statuses that mean the run has not finished:
 *  the set the Active filter asks for, so the
 *  control a row offers and the filter it is shown
 *  under cannot disagree. */
const IN_FLIGHT = new Set<string>(IN_FLIGHT_STATUSES);

/**
 * Statuses a run can be picked back up from.
 *
 * DBOS's own resume statement leaves `SUCCESS` and
 * `ERROR` alone, so those two are out; a run still
 * going has nothing to resume. What is left is the
 * run somebody stopped and the run DBOS gave up
 * recovering, which is exactly what the verb is
 * for.
 */
const RESUMABLE = new Set(['CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED']);

/** What DBOS writes when it stops restarting a run:
 *  it dead-letters it, and writes no error row. */
const GAVE_UP = 'MAX_RECOVERY_ATTEMPTS_EXCEEDED';

export type SeeView = {
  run: Run;

  steps: Step[];

  selectedStep: number | undefined;

  /** What the last replay did. */
  note: string | undefined;

  /** Where the run came from and what came out of
   *  it, where either is anything. */
  lineage?: Lineage;

  /** The workflow as it is saved, where the project
   *  still has one of that name. */
  ir?: WorkflowIR;

  /** Where each of its blocks goes, from core's own
   *  layout. */
  boxes?: Record<string, NodeBox>;

  /** The block a person picked, shared by both
   *  views of the run. */
  selectedNode?: string;

  /**
   * Which of the Inspector's faces a person picked
   * for that block.
   *
   * Absent until somebody picks one, which is not
   * the same as either: a block picked on a run is
   * picked to see what the run recorded, until the
   * person says otherwise.
   */
  face?: InspectorMode;

  /** Whether a watch is still reading this run. */
  following?: 'following' | 'waiting' | 'quiet';

  /** Whether the project's SDK records the rows the
   *  wake and timeout lines are read off. The host
   *  answers this; nothing browser-side can. */
  timing?: boolean;

  /**
   * Whether this window is what cancelled the run.
   *
   * Handed in rather than derived, because no column
   * anywhere records who cancelled a run. The list
   * remembers the ids this window asked about, for
   * as long as the window is open, and that
   * remembering is the whole of the evidence there
   * is for "by you".
   */
  cancelledHere?: boolean;
};

/**
 * One session run, in the words the panel draws.
 *
 * `keyed` comes from the document rather than from
 * the run: whether sending this input again is the
 * same run is a fact about the workflow's trigger,
 * and it is what decides which of the two actions
 * the row offers.
 */
export function sessionRowOf(
  run: SessionRun,
  workflows: readonly ProjectWorkflow[],
): SessionRow {
  const trigger = workflows.find((flow) => flow.name === run.workflow)?.trigger;

  return {
    workflowId: run.workflowId,
    workflow: run.workflow,
    outcome: run.outcome,
    when: sessionWhen(run),
    stepCount: run.stepCount,
    recovered: run.recovered,
    error: run.failedStep?.error ?? run.error,
    keyed: trigger?.mode === 'event' && trigger.keyPath !== undefined,
    via: run.via,
  };
}

function sessionWhen(run: SessionRun): string {
  const at = clock(run.startedAt);

  return run.durationMs === undefined
    ? at
    : `${at} · ${lasted(run.durationMs)}`;
}

/**
 * The editor tab's title for a run: the workflow
 * and the whole id.
 *
 * The one place the whole id is read on the run
 * tab, where it costs the page nothing and can be
 * copied; the header names the run by its short
 * id.
 */
export function seeTitle(run: Pick<SeeRun, 'name' | 'workflowId'>): string {
  return messages.runTabLine(run.name, run.workflowId);
}

export function seeInit(
  view: SeeView | undefined,
  showing: 'graph' | 'trace' = 'graph',
): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeWords(),
    run: view === undefined ? undefined : seeRun(view),
    showing,
  };
}

/**
 * The open run's rows, read against the document
 * the page was laid out from.
 *
 * `lost` rather than nothing where the project no
 * longer has a document of this name: that is an
 * answer, and it is why the trace draws every row
 * apart, under no block. One call for every reader
 * of the run page's rows, so the page, the
 * selection and the Inspector cannot attribute a
 * row three ways.
 */
export function readView(view: SeeView, now: number): Reading {
  return readRun(
    view.run,
    view.steps,
    view.ir ?? 'lost',
    hasRecovered(view.run),
    now,
    view.ir,
  );
}

/**
 * The run tab's run, as the Inspector reads it:
 * projected once, at the moment the pane passed,
 * for the card about the whole run and for the
 * block picked on it alike.
 *
 * One projection rather than two, because the card
 * and the block used to be projected at two clocks
 * in two modules, and a run read twice is how two
 * answers come to disagree. `now` is a parameter
 * for the reason it is one on `readRun`: the window
 * a row is drawn in is the reader's, and a moment
 * kept here would freeze a timer's wait.
 */
export type RunTab = {
  workflowId: string;

  /** The workflow the run is a run of, by name. */
  name: string;

  /** The run as a canvas draws one, for the card. */
  run: LiveRun;

  /** The same run with the SDK's own rows put back
   *  under the blocks they ran in, for a block. */
  inspected: ShownRun;

  /** Which way out each decided block took, read
   *  against the saved drawing the page drew, so
   *  the card and the graph beside it agree. */
  decided: Record<string, string>;

  recovery: string[] | undefined;
  lineage: RunLineage[];
  note: string | undefined;

  /** The saved drawing the rows were read against,
   *  for the replay's refusal. */
  ir: WorkflowIR | undefined;

  /** Whether this window cancelled the run. */
  cancelledHere: boolean;

  /** The block and row picked on the tab, and the
   *  face somebody picked for that block. */
  picked: {
    nodeId: string | undefined;
    functionId: number | undefined;
    face: InspectorMode | undefined;
  };
};

export function runTabOf(view: SeeView, now: number): RunTab {
  const reading = readView(view, now);

  return {
    workflowId: view.run.workflowId,
    name: view.run.name,
    run: liveRunOf(view.run, reading),
    inspected: inspectedRunOf(view.run, reading),
    decided: Object.fromEntries(decidedArms(reading.steps, view.ir)),
    recovery: recoverySentences(view.run, reading),
    lineage: runLineageOf(view.lineage),
    note: view.note,
    ir: view.ir,
    cancelledHere: view.cancelledHere ?? false,
    picked: {
      nodeId: view.selectedNode,
      functionId: view.selectedStep,
      face: view.face,
    },
  };
}

function seeRun(view: SeeView): SeeRun {
  const { run } = view;

  // One clock for the whole page, so that where the
  // run is, whether a timer has run out and whether
  // a row says the run woke are all answered about
  // the same moment.
  const now = Date.now();
  const reading = readView(view, now);
  const graph = graphOf(view, reading.steps);

  // Which rows a replay could start from, asked once
  // for the page: the rule is core's and it is asked
  // of the document as it is saved now, so a run
  // whose workflow is gone offers nothing rather
  // than everything.
  const points = boundariesOf(view);
  const page: TracePage = { view, points, now };
  const trace = traceOf(reading.steps, reading.owners);

  return {
    workflowId: run.workflowId,
    short: shortRunId(run.workflowId),
    name: run.name,
    // The reading answered where the run is, with
    // every row the page holds; the header says that
    // word rather than asking the steps again, in
    // the line the Inspector's card says it in.
    state: glyphStateOf(reading.outcome),
    line: messages.runTabLine(
      run.name,
      runLine({
        word: reading.outcome,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        recovered: reading.recovered,
      }),
    ),
    graph,
    // Decided by the same call, so the sentence is
    // there exactly when the picture is not.
    noGraph:
      graph === undefined ? messages.runGraphMissing(run.name) : undefined,
    live: liveRunOf(run, reading),
    trace: trace.rows.map((row) =>
      traceRowOf(row.operation, row.nodeId, row.sdk, page),
    ),
    unattributed: trace.unattributed.map((one) =>
      traceRowOf(one, undefined, [], page),
    ),
    selected: {
      nodeId: view.selectedNode,
      functionId: markedRow(view, reading),
    },
    following: view.following ?? 'quiet',
  };
}

/**
 * The row the trace marks: the one picked, else the
 * one the picked block is headed by.
 *
 * Asked of the rows the Inspector is handed for the
 * same run, by the same rule, so the row marked in
 * the trace is the row the pane draws in full.
 */
function markedRow(view: SeeView, reading: Reading): number | undefined {
  if (view.selectedStep !== undefined) return view.selectedStep;
  if (view.selectedNode === undefined) return undefined;

  const rows = inspectedRunOf(view.run, reading).steps.filter(
    (step) => step.nodeId === view.selectedNode,
  );

  return headlineRow(rows)?.functionId;
}

/** What every row of the trace is worded against:
 *  the page, the rows a replay may start from, and
 *  the page's one clock. */
type TracePage = {
  view: SeeView;
  points: ReplayPoints;
  now: number;
};

/** The name the SDK records a sleep under. */
const SLEEP = 'DBOS.sleep';

/**
 * One row of the trace, in the words it is drawn
 * in, with the SDK's rows beside it.
 *
 * Every row carries the block it is drawn under, so
 * the line under an SDK row can name the block it
 * ran in, and picking any row selects that block.
 */
function traceRowOf(
  operation: Operation,
  nodeId: string | undefined,
  sdk: readonly Operation[],
  page: TracePage,
): TraceRowView {
  const node = page.view.ir?.nodes.find((one) => one.id === nodeId);
  const beside = sdk.map((one) => traceRowOf(one, nodeId, [], page));

  return {
    functionId: operation.functionId,
    name: operation.name,
    owner: operation.owner,
    state: operation.state,
    reused: operation.reused,
    ...offerOf(page.points, operation.functionId),
    childWorkflowId: operation.childWorkflowId,
    nodeId,
    duration: durationOf(operation),
    detail: detailOf(operation, node, page),
    detailTone: operation.state === 'failed' ? 'fail' : 'faint',
    sdkLabel:
      beside.length === 0
        ? undefined
        : sdkLabelOf(operation, node, beside.length),
    sdk: beside,
  };
}

/**
 * How long a row took, where that is a length of
 * time at all.
 *
 * A child start is written with one clock read for
 * both ends, so its length would always read as
 * none; a sleep's end is the deadline it was given,
 * which may not have come yet.
 */
function durationOf(operation: Operation): string | undefined {
  const { startedAt, completedAt } = operation;

  if (startedAt === undefined || completedAt === undefined) return undefined;
  if (operation.childWorkflowId !== undefined) return undefined;
  if (operation.name === SLEEP) return undefined;

  return lasted(completedAt - startedAt);
}

/**
 * The line under a trace row. The first rule that
 * fits is the line.
 *
 * A row that threw says what it threw. A wait still
 * registered says since when, and when it gives up
 * where the document says. A sleep says when the
 * run wakes, or woke, or when a wait times out —
 * only where the host has said the project's SDK
 * writes the row that is read from, and always as a
 * moment rather than the number the SDK stored.
 * Anything else says what it returned, after
 * whether it came back from the ledger or from the
 * run it was replayed from; and where it returned
 * nothing, the block it ran in.
 */
function detailOf(
  operation: Operation,
  node: WorkflowNode | undefined,
  page: TracePage,
): TraceDetail {
  const words = seeWords();

  if (operation.state === 'failed') {
    return {
      derived: undefined,
      plain: operation.error?.name,
      verbatim: operation.error?.message,
    };
  }

  if (
    operation.state === 'waiting' &&
    operation.segments.at(-1)?.kind === 'register'
  ) {
    return {
      derived: parkedLine(operation, node),
      plain: undefined,
      verbatim: undefined,
    };
  }

  if (operation.name === SLEEP) {
    const wake = page.view.timing === true ? wakeOf(operation) : undefined;

    return {
      derived: wake === undefined ? undefined : wakeLine(wake, page.now),
      plain: wake === undefined ? node?.title : undefined,
      verbatim: undefined,
    };
  }

  const copied = [
    ...(operation.restored ? [words.restored] : []),
    ...(operation.reused ? [words.reused] : []),
  ];
  const returned = operation.absent ? undefined : operation.shown;

  return {
    derived:
      copied.length === 0
        ? undefined
        : copied.map((word) => `${word} · `).join(''),
    plain: returned === undefined ? node?.title : undefined,
    verbatim: returned,
  };
}

/** Since when a wait has been registered, and after
 *  how long it gives up, where either is known. */
function parkedLine(
  operation: Operation,
  node: WorkflowNode | undefined,
): string | undefined {
  const words = seeWords();

  // The rule the pane reads a wait's since by, so
  // the two say the same moment.
  const since = operation.completedAt ?? operation.startedAt;
  const days =
    node?.kind === 'durableWait' || node?.kind === 'approval'
      ? node.config.timeoutDays
      : undefined;

  const parts = [
    ...(since === undefined ? [] : [filled(words.waitingSince, fine(since))]),
    ...(days === undefined ? [] : [filled(words.timeout, String(days))]),
  ];

  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** A sleep row's moment, said against the page's
 *  clock. */
function wakeLine(wake: Wake, now: number): string {
  const words = seeWords();
  const at = fine(wake.at);

  if (wake.kind === 'timeout') return filled(words.timesOut, at);

  return filled(wake.at > now ? words.wakes : words.woke, at);
}

/**
 * What opens the SDK's rows beside a block row.
 *
 * Named after the function the block runs, since
 * that is the code those rows were written for, and
 * after the row itself where the block runs none.
 */
function sdkLabelOf(
  operation: Operation,
  node: WorkflowNode | undefined,
  count: number,
): string {
  const words = seeWords();
  const named = node?.handler?.export ?? operation.name;

  return count === 1
    ? filled(words.sdkRow, named)
    : filled(words.sdkRows, named, String(count));
}

/**
 * The saved workflow, laid out, with the arms the
 * run is known to have taken.
 *
 * Absent where the project no longer has a document
 * of that name. The caption says which of the two
 * it is, because a page drawing no graph and saying
 * nothing about why looks broken.
 */
function graphOf(
  view: SeeView,
  operations: readonly Operation[],
): SeeGraph | undefined {
  const { ir, boxes } = view;
  if (ir === undefined || boxes === undefined) return undefined;

  return {
    ir,
    boxes,
    kindWords: kindWords(),
    triggerPhrases: canvasWords().triggerPhrases,
    unassigned: canvasWords().unassigned,
    queueCounts: canvasWords().queueCounts,
    caption: messages.runGraphCaption(ir.revision),
    // A record rather than a map: this crosses
    // `postMessage`, and a map does not survive
    // being JSON.
    decided: Object.fromEntries(decidedArms(operations, ir)),
  };
}

/**
 * Which rows a replay may start from, and why the
 * rest may not.
 *
 * Nothing at all where the project no longer has
 * the document: the rule is asked of a drawing, and
 * a page with no drawing beside it cannot honestly
 * offer any point.
 */
type ReplayPoints = {
  offered: ReadonlySet<number>;
  withheld: Map<number, Unoffered>;
  ir: WorkflowIR | undefined;
};

function boundariesOf(view: SeeView): ReplayPoints {
  const ir = view.ir;

  if (ir === undefined) {
    return { offered: new Set(), withheld: new Map(), ir: undefined };
  }

  const found = replayBoundaries(
    ir,
    view.steps.map((step) => ({
      functionId: step.functionId,
      name: step.name,
      completedAt: step.completedAt,
      failed: step.error !== undefined,
    })),
  );

  return {
    offered: new Set(found.offered.map((one) => one.functionId)),
    withheld: new Map(found.unoffered.map((one) => [one.functionId, one])),
    ir,
  };
}

/** What one row says about being replayed from. */
function offerOf(
  points: ReplayPoints,
  functionId: number,
): { replayable: boolean; because: string | undefined } {
  if (points.offered.has(functionId)) {
    return { replayable: true, because: undefined };
  }

  const withheld = points.withheld.get(functionId);

  return {
    replayable: false,
    because:
      withheld === undefined
        ? messages.replayNotOffered()
        : replayRowReason(withheld, points.ir),
  };
}

/**
 * One run of the history, in the words the list
 * draws.
 *
 * `page` is the rest of what the list is holding,
 * and it is the only place a replay's lineage
 * comes from: `forked_from` is a column every row
 * already selects, so a replay on screen is a line
 * drawn for free and one that is not is a query
 * nobody asked for. An empty page is a row drawn
 * on its own.
 *
 * Neither `now` nor `locale` has a default, for the
 * reason the reading's clock has none: the list is
 * one page read at one moment, and whether a sleep
 * has ended and which day a clock is on are both
 * answered against it — in the editor's language,
 * which a function reading the machine's would
 * not be.
 */
export function rowOf(
  run: Run,
  page: readonly Run[],
  now: number,
  locale: string,
): RunRow {
  const word = listedWord(run, now);
  const { cancel, resume } = runControlsOf(run, false);

  return {
    workflowId: run.workflowId,
    name: run.name,
    status: run.status,
    state: glyphStateOf(word),
    line: lineOf(run, word, now, locale),
    recovered: hasRecovered(run),
    // Only past the first: the line already says
    // the run recovered, so the number is worth
    // its space only when it is more than one.
    // Worked out from a column that counts
    // dispatches, and marked so.
    recoveredNote:
      recoveriesOf(run) > 1
        ? messages.runLevelDerived(
            messages.runsRecoveredNote(recoveriesOf(run)),
          )
        : undefined,
    error: run.error,
    stoppedAt:
      run.lastOperationAt === undefined
        ? undefined
        : clock(run.lastOperationAt),
    operations: run.operationCount,
    lineage: lineageOf(run, page, now),
    // The list asks every run where it began, and
    // a run that is not a replay began at the top.
    startStep: run.forkedFrom === undefined ? undefined : run.startStep,
    failedStep: run.failedStep,
    controls: { cancel, resume },
  };
}

/**
 * The word for a listed run, with the list's
 * evidence for whether it is parked: its last
 * recorded name, and whether a sleep it began is
 * still to end. A run asleep on the clock writes
 * nothing of its own while it sleeps, so its name
 * alone would call it running.
 */
function listedWord(run: Run, now: number): RunWord {
  const asleep = run.sleepingUntil !== undefined && run.sleepingUntil > now;

  return wordOf(run, parked(run.lastOperation) || asleep);
}

/**
 * A listed run in one line: its word, the run it
 * is a replay of, whatever its word has to say,
 * and whether DBOS picked it back up.
 */
function lineOf(run: Run, word: RunWord, now: number, locale: string): string {
  return [
    runWords()[word],
    ...(run.forkedFrom === undefined
      ? []
      : [messages.runsReplayOf(shortRunId(run.forkedFrom))]),
    ...partsOf(run, word, now, locale),
    ...recoveredAfter(word, hasRecovered(run)),
  ].join(' · ');
}

/**
 * What each word says after itself.
 *
 * The clock is when the run started, except where
 * the question is how long it has waited or when
 * it wakes. How long a run took only where it
 * ended by finishing or by throwing: a run DBOS
 * gave up on or somebody cancelled was stopped
 * rather than finished, and a length of time for a
 * run still going would be stale as soon as it was
 * drawn.
 */
function partsOf(
  run: Run,
  word: RunWord,
  now: number,
  locale: string,
): string[] {
  const started = when(run.createdAt, now, locale);
  const block = blockOf(run.lastOperation);
  const named = block === undefined ? [] : [block];
  const after = said(block, messages.runsAfter);

  switch (word) {
    case 'done':
      return [started, ...tookOf(run), ...stepsOf(run.operationCount)];
    case 'failed':
      return [...named, started, ...tookOf(run)];
    case 'gaveUp':
    case 'running':
    case 'recovering':
      return [...after, started];
    case 'queued':
    case 'cancelled':
      return [started];
    case 'waiting':
      // Parked on a person: the block that asked,
      // and since when. Otherwise asleep on the
      // clock: the block it got past, and when the
      // sleep ends.
      return parked(run.lastOperation)
        ? [
            ...named,
            ...said(run.lastOperationAt, (at) =>
              messages.runsSince(when(at, now, locale)),
            ),
          ]
        : [
            ...after,
            ...said(run.sleepingUntil, (at) =>
              messages.runsWakes(when(at, now, locale)),
            ),
          ];
  }
}

/** A part, where there is anything to say it
 *  about. */
function said<Value>(
  value: Value | undefined,
  say: (value: Value) => string,
): string[] {
  return value === undefined ? [] : [say(value)];
}

/** The block a recorded name belongs to, else the
 *  name as it was recorded. */
function blockOf(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;

  const owner = ownerOf(name);

  return owner.kind === 'node' ? owner.nodeId : name;
}

function tookOf(run: Run): string[] {
  return said(run.completedAt, (at) => lasted(at - run.createdAt));
}

/** How many blocks a run ran, where it ran any. */
function stepsOf(count: number | undefined): string[] {
  if (count === undefined || count === 0) return [];

  return [count === 1 ? messages.runsOneStep() : messages.runsSteps(count)];
}

/**
 * Where the run came from and what came out of it
 * that is on this page, as the Inspector's lineage
 * lines are built.
 *
 * Only runs whose start step was read: a lineage
 * line says where the replay began, and the list
 * read asks that of every run. A replay's word is
 * asked with the list's own evidence, which it has
 * for every run on the page.
 */
function lineageOf(run: Run, page: readonly Run[], now: number): RunLineage[] {
  const parent: RunLineage[] =
    run.forkedFrom === undefined || run.startStep === undefined
      ? []
      : [
          {
            direction: 'of',
            workflowId: run.forkedFrom,
            short: shortRunId(run.forkedFrom),
            startStep: run.startStep,
          },
        ];

  const replays = page.flatMap((one): RunLineage[] =>
    one.forkedFrom !== run.workflowId || one.startStep === undefined
      ? []
      : [
          {
            direction: 'to',
            workflowId: one.workflowId,
            short: shortRunId(one.workflowId),
            startStep: one.startStep,
            word: runWords()[listedWord(one, now)],
          },
        ],
  );

  return [...parent, ...replays];
}

/**
 * The word for a run this module read, with the
 * evidence it holds for whether the run is parked.
 *
 * The crossing is one function everywhere; what
 * differs by reader is the evidence, and this is
 * where a row's is put together.
 */
function wordOf(run: Run, parked: boolean): RunWord {
  return runWord({
    status: run.status,
    recoveryAttempts: run.recoveryAttempts,
    parked,
  });
}

/**
 * Whether the run's last operation says it is parked
 * on somebody — the list's evidence, which is one
 * name.
 *
 * The status column cannot say: a run is `PENDING`
 * whether it is executing a step or sitting in
 * somebody's inbox, and telling those apart is the
 * whole reason the list reads the other table. The
 * two shapes a wait leaves are the row that says
 * which run is parked, and a reminder counted after
 * it — the row that clears the registration means
 * the run woke up.
 */
function parked(lastOperation: string | undefined): boolean {
  if (lastOperation === undefined) return false;

  const owner = ownerOf(lastOperation);
  if (owner.kind !== 'node') return false;

  const last = owner.segments.at(-1)?.kind;

  return last === 'register' || last === 'resend';
}

/** What a run's one line is composed from: the
 *  word its reader worked out, with whatever
 *  evidence that reader had, and the run's own
 *  times. */
export type RunLineOf = {
  word: RunWord;
  createdAt: number;
  completedAt: number | undefined;
  recovered: boolean;
};

/**
 * A run summed up in one line: "done · 1.6 s",
 * "waiting", "done · 9.1 s · ↻ recovered".
 *
 * How long it took only once DBOS has written
 * `completed_at`, which it does for every way a run
 * ends and clears on a resume; a length of time for
 * a run still going would be stale as soon as it
 * was drawn.
 */
export function runLine(run: RunLineOf): string {
  const { word, createdAt, completedAt, recovered } = run;
  const parts = [runWords()[word]];

  if (completedAt !== undefined) parts.push(lasted(completedAt - createdAt));

  return [...parts, ...recoveredAfter(word, recovered)].join(' · ');
}

/**
 * The recovered tag, where a line should end with
 * it: on a run that is over, because one still
 * being picked back up already says "recovering" —
 * and never after "gave up", which is a word for
 * being restarted until DBOS stopped. One rule for
 * the list's line and the run tab's.
 */
function recoveredAfter(word: RunWord, recovered: boolean): string[] {
  return recovered && settled(word) && word !== 'gaveUp'
    ? [messages.runsRecoveredTag()]
    : [];
}

/**
 * What a recovery cost, as the Inspector's card
 * about a whole run lists it: sentence by sentence,
 * each marked derived, because every one of them is
 * worked out from the rows rather than read off one.
 *
 * Two forms, because there are two things that can
 * honestly be said. When the steps leave a hole
 * wide enough to place, the sentences name what
 * that cost and how many operations were reused
 * rather than run again. When they do not, the
 * count is all there is — `recovery_attempts` is a
 * number, and no column anywhere holds the moment a
 * process died. A run DBOS gave up on says neither:
 * it never finished, so there is nothing reused to
 * report, and how many restarts it took is the part
 * worth reading.
 */
export function recoverySentences(
  run: Run,
  reading: Reading,
): string[] | undefined {
  if (run.status === GAVE_UP) {
    return [
      messages.runLevelDerived(messages.runLevelGaveUp(recoveriesOf(run))),
    ];
  }

  if (!hasRecovered(run)) return undefined;

  const heading = messages.runRecoveredHeading();
  const outage = reading.outage;

  const said =
    outage === undefined
      ? [heading, messages.runRecoveredUnplaced()]
      : [
          heading,
          messages.runRecoveredBody(),
          messages.runRecoveredDown(lasted(outage.to - outage.from)),
          messages.runRecoveredReused(
            reading.steps.filter((step) => step.restored).length,
          ),
        ];

  return said.map(messages.runLevelDerived);
}

/**
 * Where a run came from and what came out of it, one
 * line each: the run it was replayed from first,
 * then each replay of it.
 *
 * The replay's word is asked with the evidence this
 * read has, which is no recorded name for the other
 * run — so none of them can be said to be parked.
 */
export function runLineageOf(lineage: Lineage | undefined): RunLineage[] {
  if (lineage === undefined) return [];

  const parent: RunLineage[] =
    lineage.parent === undefined
      ? []
      : [
          {
            direction: 'of',
            workflowId: lineage.parent.run.workflowId,
            short: shortRunId(lineage.parent.run.workflowId),
            startStep: lineage.parent.startStep,
          },
        ];

  return [
    ...parent,
    ...lineage.forks.map((fork): RunLineage => ({
      direction: 'to',
      workflowId: fork.run.workflowId,
      short: shortRunId(fork.run.workflowId),
      startStep: fork.startStep,
      word: runWords()[wordOf(fork.run, false)],
    })),
  ];
}

/**
 * What a run was started with, as a card draws a
 * recorded value: whole on one line where it is
 * short, and named with its size where it is not.
 *
 * The payload itself rather than the argument array
 * DBOS stores it in; text that was not that array is
 * shown as it was stored. The preview keeps as much
 * as a panel holds, which is more than one line
 * shows. The size is the value's own, written as
 * compactly as JSON writes it.
 */
export function recordedValueOf(
  input: RunInput | undefined,
): RecordedValue | undefined {
  if (input === undefined || input.shape === 'none') return undefined;

  const shown =
    input.shape === 'payload' ? inlineJson(input.value) : input.text;
  const stored =
    input.shape === 'payload'
      ? (JSON.stringify(input.value) ?? '')
      : input.text;

  return recordedValue(
    shown,
    new TextEncoder().encode(stored).length,
    sizeWords(),
  );
}

/**
 * The run as `dbos.workflow_status` holds it, each
 * row under its column's own name and holding the
 * column's own value — `SUCCESS` rather than
 * "done", because this is the one place a person
 * reads the ledger itself.
 *
 * Four columns, plus the version when DBOS recorded
 * one: it is what decides whether a replay of this
 * run can reach a worker at all, so it belongs
 * beside the button that makes one. Read off either
 * a run the ledger was asked for or a run a watch
 * follows, which carry these columns alike.
 */
export function ledgerOf(
  run: Pick<
    Run,
    | 'workflowId'
    | 'status'
    | 'recoveryAttempts'
    | 'executorId'
    | 'applicationVersion'
  >,
): { label: string; value: string }[] {
  const rows = [
    { label: 'workflow_uuid', value: run.workflowId },
    { label: 'status', value: run.status },
    { label: 'recovery_attempts', value: String(run.recoveryAttempts) },
    { label: 'executor_id', value: run.executorId },
  ];

  return run.applicationVersion === undefined
    ? rows
    : [
        ...rows,
        { label: 'application_version', value: run.applicationVersion },
      ];
}

/**
 * Which of the two controls a run is open to, when
 * it was cancelled and whether it gave up — the
 * Inspector's card about a whole run.
 *
 * Both answers come off the status column and
 * nothing else, because that is the column DBOS's
 * own statements are conditioned on: cancel and
 * resume both end in `status NOT IN
 * ('SUCCESS','ERROR')`. Offering either where the
 * statement would change nothing is offering a
 * button that does nothing and says so afterwards.
 * Never both, and the two sets cannot overlap: a run
 * is either still going or it has stopped.
 *
 * `completed_at` is what cancelling writes, so it is
 * the moment shown, in the fine form every recorded
 * time on the card is written in. "by you" is this
 * window's memory and nothing else.
 */
export function runControlsOf(
  run: Pick<Run, 'status' | 'createdAt' | 'completedAt'>,
  cancelledHere: boolean,
): RunLevel['controls'] {
  const at = fine(run.completedAt ?? run.createdAt);

  return {
    cancel: IN_FLIGHT.has(run.status),
    resume: RESUMABLE.has(run.status),
    cancelledAt:
      run.status !== 'CANCELLED'
        ? undefined
        : cancelledHere
          ? messages.runCancelledByYou(at)
          : at,
    gaveUp: run.status === GAVE_UP,
  };
}

/** How long something took, said in the host's
 *  words. The scale is the one every panel reads,
 *  so a step is rounded the same way here and in
 *  the frame that draws its own. */
function lasted(ms: number): string {
  return duration(ms, durationWords());
}

/**
 * The run evidence, said three times: as a summary
 * a person reads in the transcript, as the sentence
 * the agent is asked, and as that sentence the way
 * the transcript shows it.
 *
 * All are assembled clause by clause from what the
 * record carries. A fact the record does not have
 * is left out rather than printed as a label with
 * nothing after it — the record is built not to
 * invent, and words wrapped around it may not
 * either.
 *
 * The agent looks a run up by its full id and reads
 * DBOS's own status word, so its sentence keeps
 * both. A person knows a run by its short id and
 * reads the word every panel says, so what the
 * transcript shows says those instead.
 */

/** The summary folded under the transcript row. */
export function evidenceLines(evidence: RunEvidence): ToolLine[] {
  return evidence.at === 'refused'
    ? refusedLines(evidence)
    : recordedLines(evidence);
}

/** What the agent is asked, with the record
 *  attached. */
export function evidenceSentence(evidence: RunEvidence): string {
  if (evidence.at === 'refused') {
    return messages.runAskAgentRefused(evidence.workflow, evidence.detail);
  }

  return askedAbout(evidence, evidence.workflowId, evidence.status);
}

/** The same question about a run the ledger has,
 *  as the transcript shows it. */
export function evidenceEcho(evidence: RecordedRunEvidence): string {
  return askedAbout(
    evidence,
    shortRunId(evidence.workflowId),
    runWords()[evidenceWord(evidence)],
  );
}

/** The question's clauses, with the run and its
 *  status spelled for whoever reads them. */
function askedAbout(
  evidence: RecordedRunEvidence,
  run: string,
  status: string,
): string {
  return [
    headlineOf(evidence, run, status),
    codeBehind(evidence),
    messages.runAskAgentEvidence(
      evidence.reader.database,
      evidence.reader.from,
    ),
  ]
    .filter((clause) => clause !== undefined)
    .join(' ');
}

/**
 * The word the run is said in.
 *
 * Parked when a row it carries is waiting on
 * somebody — the record's own evidence, and the
 * same rows the run tab reads it off.
 */
function evidenceWord(evidence: RecordedRunEvidence): RunWord {
  return runWord({
    status: evidence.status,
    recoveryAttempts: evidence.recoveryAttempts,
    parked: evidence.operations.some((one) => one.state === 'waiting'),
  });
}

/**
 * Which run failed, and where.
 *
 * A block where the record names one, the run
 * itself where it does not, and neither where the
 * run recorded no failure at all — any run the
 * ledger has can be asked about, and one that
 * succeeded has to be described as one.
 */
function headlineOf(
  evidence: RecordedRunEvidence,
  run: string,
  status: string,
): string {
  const said = observed(evidence);

  if (said === undefined) {
    return messages.runAskAgentNoFailure(run, evidence.workflow, status);
  }

  const title = evidence.node?.title ?? evidence.failedStep?.name;

  return title === undefined
    ? messages.runAskAgentWith(run, evidence.workflow, said)
    : messages.runAskAgentAtBlock(run, evidence.workflow, title, said);
}

/**
 * The code the block runs and how hard it was
 * allowed to try, in the one line a person would
 * have read off the card.
 *
 * Joined rather than templated, so that a block
 * with no handler, or a handler the last scan
 * never found, simply says less.
 */
function codeBehind(evidence: RecordedRunEvidence): string | undefined {
  const parts: string[] = [];
  const handler = evidence.handler;
  const retry = evidence.node?.retry;

  if (handler !== undefined) parts.push(`ƒ ${handler.export}`);
  if (handler?.file !== undefined) parts.push(handler.file);

  if (retry !== undefined && retry.declared) {
    parts.push(messages.runAskAgentRetry(String(retry.maxAttempts)));
  }

  return parts.length === 0 ? undefined : `${parts.join(' · ')}.`;
}

/**
 * One run, as the summary lists it.
 *
 * The error is the run's own words, which can quote
 * anything, so it is kept apart from the label in
 * front of it rather than written into it.
 */
function recordedLines(evidence: RecordedRunEvidence): ToolLine[] {
  const said = observed(evidence);
  const handler = evidence.handler;
  const retry = evidence.node?.retry;

  const error =
    said === undefined
      ? []
      : [{ text: messages.runEvidenceError(''), recorded: said }];

  const facts = [
    evidence.failedStep === undefined
      ? undefined
      : messages.runEvidenceFailedAt(operationText(evidence.failedStep)),
    retry === undefined || !retry.declared
      ? undefined
      : messages.runEvidenceRetry(String(retry.maxAttempts)),
    handler === undefined
      ? undefined
      : handler.inManifest
        ? messages.runEvidenceHandler(handler.signature ?? handler.export)
        : messages.runEvidenceHandlerMissing(handler.export),
    handler?.file === undefined
      ? undefined
      : messages.runEvidenceSource(
          handler.line === undefined
            ? handler.file
            : `${handler.file}:${String(handler.line)}`,
        ),
    messages.runEvidenceStatus(runWords()[evidenceWord(evidence)]),
    evidence.recoveryAttempts === 0
      ? undefined
      : messages.runEvidenceRecovered(String(evidence.recoveryAttempts)),
    evidence.applicationVersion === undefined
      ? undefined
      : messages.runEvidenceVersion(evidence.applicationVersion),
    messages.runEvidenceReader(evidence.reader.database, evidence.reader.from),
    messages.runEvidenceOperations(
      String(evidence.operations.length),
      String(evidence.operationsTotal),
    ),
  ];

  return [
    ...error,
    ...facts.flatMap((text) => (text === undefined ? [] : [{ text }])),
  ];
}

/** A run that never started, as the summary lists
 *  it: what it was going to be, when, and why not —
 *  the last in the app's own words. */
function refusedLines(evidence: RefusedRunEvidence): ToolLine[] {
  return [
    {
      text: messages.runEvidenceRefused(
        evidence.workflow,
        fine(evidence.refusedAt),
      ),
    },
    ...(evidence.detail === ''
      ? []
      : [
          {
            text: messages.runEvidenceDetail(''),
            recorded: evidence.detail,
          },
        ]),
  ];
}

/**
 * The failure in one line: the class where the
 * record kept one, and the sentence either way.
 *
 * The run's own error first, because that is the
 * column DBOS writes when a run ends badly; the
 * failed row's is what a run still in flight has.
 */
function observed(evidence: RecordedRunEvidence): string | undefined {
  const error = evidence.error ?? evidence.failedStep?.error;

  if (error === undefined) return undefined;

  return error.name === undefined
    ? error.message
    : `${error.name}: ${error.message}`;
}

/** One recorded row, named the way the trace names
 *  it — by what ran and which row it was. */
function operationText(operation: OperationEvidence): string {
  const spent =
    operation.durationMs === undefined
      ? undefined
      : lasted(operation.durationMs);

  return [`${operation.name} · #${String(operation.functionId)}`, spent]
    .filter((part) => part !== undefined)
    .join(' · ');
}
