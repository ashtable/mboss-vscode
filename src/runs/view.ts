import { paletteLabels, canvasWords, inspectorWords } from '../canvas/words.js';
import { replayBoundaries, type Unoffered } from '../core/index.js';
import { ownerOf, type NodeBox, type WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import { fine } from '../webview/time.js';
import type {
  RunRow,
  RunSeverity,
  SeeBar,
  SeeChip,
  SeeGraph,
  SeeInit,
  SeeLineageRun,
  SeeOutage,
  SeeRawRow,
  SeeRun,
  SeeTimeline,
  SessionRow,
  TraceGroupView,
  TraceOpView,
} from '../webview/protocol.js';

import type {
  OperationEvidence,
  RecordedRunEvidence,
  RefusedRunEvidence,
  RunEvidence,
} from './evidence.js';
import type { Lineage, LineageRun } from './openRun.js';
import { seeWords } from './words.js';
import { decidedArms, groupsOf, type TraceGroup } from './operations.js';
import { replayRowReason } from './replayZone.js';
import { readRun, type Operation, type Reading } from './reading.js';
import { hasRecovered, recoveriesOf, type Run, type Step } from './rows.js';
import type { SessionRun } from './sessionLog.js';
import { liveRunOf } from './watch.js';
import type { ProjectWorkflow } from './workflows.js';

/**
 * A row of the run history, a row of this session,
 * and one run in detail, in the words the views
 * draw.
 *
 * What a person reads on a row is resolved here,
 * because a webview has no localization bundle;
 * the store that holds the rows renders the list
 * from these. And every position on the chart is
 * a fraction of its own window rather than a
 * pixel, because the panel is resizable and the
 * host has no idea how wide it is — so the
 * arithmetic is done once, in one place with a
 * test around it, instead of in a renderer that
 * would need to be handed the window to do it.
 */

/** Statuses that mean the run has not finished. */
const IN_FLIGHT = new Set(['PENDING', 'ENQUEUED', 'DELAYED']);

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

/**
 * How much of an output one cell carries.
 *
 * The raw panel is a table, and a step that
 * returned a document would otherwise be one row a
 * screen tall. The whole value is a click away in
 * the database this panel names.
 */
const OUTPUT_CELL = 120;

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

  /** Whether the rows DBOS wrote for itself are
   *  shown. */
  raw?: boolean;

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
    : `${at} · ${duration(run.durationMs)}`;
}

export function seeInit(
  view: SeeView | undefined,
  showing: 'graph' | 'trace' = 'graph',
): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeWords(),
    // The card the rail draws about a block is the
    // Inspector's, so its words travel with the run
    // rather than being written a second time here.
    inspector: inspectorWords(),
    run: view === undefined ? undefined : seeRun(view),
    showing,
  };
}

function seeRun(view: SeeView): SeeRun {
  const { run, steps } = view;

  // One clock for the whole page, so that a bar's
  // end and whether a timer has run out are answered
  // about the same moment. And `lost` rather than
  // nothing where the project no longer has a
  // document of this name: that is an answer, and it
  // is why the trace draws one nameless group.
  const reading = readRun(
    run,
    steps,
    view.ir ?? 'lost',
    hasRecovered(run),
    Date.now(),
  );
  const graph = graphOf(view, reading.steps);

  // Which rows a replay could start from, asked once
  // for the page: the rule is core's and it is asked
  // of the document as it is saved now, so a run
  // whose workflow is gone offers nothing rather
  // than everything.
  const points = boundariesOf(view);

  // The chart and the strip above it are about what
  // the workflow did, so the SDK's own rows are not
  // drawn on either. The reading still holds them,
  // and has to: a wait the SDK wrote is what fills a
  // gap that would otherwise be read as a crash.
  const drawn = reading.steps.filter((step) => step.owner !== 'sdk');

  return {
    workflowId: run.workflowId,
    name: run.name,
    breadcrumb: messages.runBreadcrumb(run.name, run.workflowId),
    headline:
      run.completedAt === undefined
        ? messages.runHeadlineRunning(run.status)
        : messages.runHeadline(
            run.status,
            duration(run.completedAt - run.createdAt),
          ),
    // The page holds every row, so it asks the
    // reading whether a block is parked rather than
    // the list's question about one recorded name.
    severity: severityOf(
      run,
      reading.steps.some((step) => step.state === 'waiting'),
    ),
    span: spanOf(run),
    recovered: recoveredBanner(run, reading),
    chips: drawn.map((step) => chipOf(step, points)),
    timeline: chartOf(reading, drawn),
    raw: steps.map(rawRowOf),
    rail: railOf(run),
    controls: controlsOf(run, drawn, view.cancelledHere ?? false),
    selectedStep: view.selectedStep,
    note: view.note,
    graph,
    // Decided by the same call, so the sentence is
    // there exactly when the picture is not.
    noGraph:
      graph === undefined ? messages.runGraphMissing(run.name) : undefined,
    live: liveRunOf(run, reading),
    groups: groupsOf(reading.steps, { timing: view.timing ?? false }).map(
      (group) => groupOf(group, view, points),
    ),
    selected: {
      nodeId: view.selectedNode,
      functionId: view.selectedStep,
    },
    showRaw: view.raw ?? false,
    following: view.following ?? 'quiet',
    input: inputOf(run),
    lineage: lineageOf(view),
  };
}

/**
 * The lineage tree, from its top.
 *
 * Drawn from whichever end of a fork the page is
 * showing, so the run it came from is the root when
 * there is one and this run is the root when there
 * is not. The fork point is worded onto the run
 * below it, which is the run that started there.
 */
function lineageOf(view: SeeView): SeeLineageRun | undefined {
  const found = view.lineage;
  if (found === undefined) return undefined;

  const here: SeeLineageRun = {
    ...lineageRunOf(view.run),
    startStep: found.parent?.startStep,
    from: found.parent === undefined ? undefined : replayFrom(found.parent),
    here: true,
    forks: found.forks.map((fork) => ({
      ...lineageRunOf(fork.run),
      startStep: fork.startStep,
      from: replayFrom(fork),
      here: false,
      forks: [],
    })),
  };

  if (found.parent === undefined) return here;

  return {
    ...lineageRunOf(found.parent.run),
    // Nothing was read about what the parent itself
    // came out of, so the top of the tree says
    // nothing about it rather than guessing.
    startStep: undefined,
    from: undefined,
    here: false,
    forks: [here],
  };
}

/**
 * One run of the tree, in the words a row draws.
 *
 * `severity` is the list's own question asked with
 * the evidence this read has, which is no recorded
 * name for the other run — so nothing here can say
 * it is parked, and it does not.
 */
function lineageRunOf(
  run: Run,
): Pick<SeeLineageRun, 'workflowId' | 'status' | 'severity'> {
  return {
    workflowId: run.workflowId,
    status: run.status,
    severity: severityOf(run, false),
  };
}

function replayFrom(entry: LineageRun): string {
  return entry.boundary === undefined
    ? messages.runReplayFromStep(entry.startStep)
    : messages.runReplayFrom(entry.boundary);
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
    labels: paletteLabels(),
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
 * One block's turn, in the words the page draws.
 *
 * Only the document says what a block is called, so
 * a group with no block behind it is drawn nameless
 * and the `not a block in the saved workflow` badge
 * carries it. Naming such a group after its first
 * row would be a guess with nothing behind it: rows
 * with no block merge into one group whatever they
 * name, so a run whose document is gone would draw
 * as a single collapsible called after whatever
 * happened to run first.
 */
function groupOf(
  group: TraceGroup,
  view: SeeView,
  points: ReplayPoints,
): TraceGroupView {
  const node = view.ir?.nodes.find((one) => one.id === group.nodeId);
  const failed = group.operations.some((one) => one.state === 'failed');

  return {
    nodeId: group.nodeId,
    title: node?.title ?? '',
    qualifier: qualifierOf(group),
    wakes: wakesOf(group, view),
    // Closed by default, and open where a person is
    // most likely to be going: the turn that failed,
    // and the one holding the block they picked.
    open:
      failed ||
      (group.nodeId !== undefined && group.nodeId === view.selectedNode),
    failed,
    operations: group.operations.map((one) => opOf(one, points)),
  };
}

/**
 * When this block wakes, in words.
 *
 * A timeout marker is drawn wherever one is
 * recorded: the block is parked and the marker says
 * when it stops being. A real sleep is drawn only
 * where the block has exactly one way onward and
 * that way is a timer wait — a bare sleep inside a
 * block that branches afterwards says nothing about
 * where the run goes next, and guessing would be
 * the page making something up.
 */
function wakesOf(group: TraceGroup, view: SeeView): string | undefined {
  const wakes = group.wakesAt;
  if (wakes === undefined) return undefined;

  if (wakes.kind === 'timeout') return messages.runTimesOut(fine(wakes.at));

  return timerWaitAhead(group.nodeId, view)
    ? messages.runAsleepUntil(fine(wakes.at))
    : undefined;
}

function timerWaitAhead(nodeId: string | undefined, view: SeeView): boolean {
  const ir = view.ir;
  if (ir === undefined || nodeId === undefined) return false;

  const onward = ir.edges.filter((edge) => edge.from.node === nodeId);
  const [only] = onward;
  if (onward.length !== 1 || only === undefined) return false;

  const next = ir.nodes.find((node) => node.id === only.to.node);

  // Timer-sourced and no other kind: a wait on a
  // person or an event has a deadline too, but it
  // is the moment that wait gives up rather than
  // the moment the run comes back.
  return next?.kind === 'durableWait' && next.config.source.kind === 'timer';
}

function qualifierOf(group: TraceGroup): string | undefined {
  if (group.items !== undefined) return messages.runGroupItems(group.items);

  return group.round === undefined
    ? undefined
    : messages.runGroupRound(group.round);
}

function opOf(operation: Operation, points: ReplayPoints): TraceOpView {
  return {
    functionId: operation.functionId,
    name: operation.name,
    owner: operation.owner,
    state: operation.state,
    at:
      operation.completedAt === undefined
        ? undefined
        : fine(operation.completedAt),
    output: operation.output === undefined ? undefined : cut(operation.output),
    outputCut: operation.outputCut,
    error: operation.error?.message,
    restored: operation.restored,
    reused: operation.reused,
    ...offerOf(points, operation.functionId),
    childWorkflowId: operation.childWorkflowId,
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

/** What the run was started with, cut like a cell. */
function inputOf(run: Run): { text: string; cut: boolean } | undefined {
  const input = run.input;
  if (input === undefined || input.shape === 'none') return undefined;

  const text =
    input.shape === 'payload'
      ? JSON.stringify(input.value, null, 2)
      : input.text;

  return { text: cut(text), cut: text.length > OUTPUT_CELL };
}

/**
 * One run of the history, in the words the list
 * draws.
 *
 * `page` is the rest of what the list is holding,
 * and it is the only place a fork line comes from:
 * `forked_from` is a column every row already
 * selects, so a child on screen is a line drawn for
 * free and a child that is not on screen is a query
 * nobody asked for. An empty page is therefore a row
 * drawn on its own, which is what a caller with no
 * others means.
 */
export function rowOf(run: Run, page: readonly Run[] = []): RunRow {
  const severity = severityOf(run, parked(run.lastOperation));

  return {
    workflowId: run.workflowId,
    name: run.name,
    status: run.status,
    severity,
    when: whenOf(run),
    recovered: hasRecovered(run),
    // Only past the first: the tag beside it
    // already says the run recovered, so the
    // number is worth its space only when it is
    // more than one.
    recoveredNote:
      recoveriesOf(run) > 1
        ? messages.runsRecoveredNote(recoveriesOf(run))
        : undefined,
    error: run.error,
    summary: summaryOf(run, severity),
    stoppedAt:
      run.lastOperationAt === undefined
        ? undefined
        : clock(run.lastOperationAt),
    operations: run.operationCount,
    replayOf:
      run.forkedFrom === undefined
        ? undefined
        : messages.runsReplayOf(run.forkedFrom),
    forks: page
      .filter((one) => one.forkedFrom === run.workflowId)
      .map((one) =>
        messages.runsReplayInto(
          one.workflowId,
          severityOf(one, parked(one.lastOperation)),
        ),
      ),
  };
}

/**
 * Where the run got to, in one line.
 *
 * Every form of it is worked out from the last
 * operation the run recorded of its own, because
 * nothing in the ledger marks a run as being *at* a
 * block. A run that has recorded nothing gets no
 * line: a projection over no rows is not a fact
 * worth drawing.
 */
function summaryOf(run: Run, severity: RunSeverity): string | undefined {
  if (severity === 'ok') {
    return run.operationCount === undefined
      ? undefined
      : messages.runDoneSummary(run.operationCount);
  }

  const at = run.lastOperation;
  if (at === undefined) return undefined;

  const owner = ownerOf(at);
  const nodeId = owner.kind === 'node' ? owner.nodeId : at;

  if (severity === 'waiting') {
    return run.lastOperationAt === undefined
      ? undefined
      : messages.runWaitingSummary(nodeId, clock(run.lastOperationAt));
  }

  return severity === 'running'
    ? messages.runRunningSummary(nodeId)
    : messages.runFailedSummary(nodeId);
}

/**
 * How loudly a run is drawn.
 *
 * `MAX_RECOVERY_ATTEMPTS_EXCEEDED` is its own
 * severity rather than one more failure. A run that
 * threw is a bug to read; a run DBOS restarted as
 * many times as it allows and then stopped
 * restarting is something that will keep happening
 * until somebody breaks the loop, and no mockup
 * draws that state for this to copy.
 *
 * Whether the run is parked arrives as an answer,
 * because the two readers hold different evidence.
 * The list has one recorded name per run and no rows
 * at all; the page has every row it wrote. Asking
 * the list's question of the page is what used to
 * make the page unable to say `waiting`: it reads
 * one run through a query that never selected the
 * column that question is asked of.
 */
function severityOf(run: Run, parked: boolean): RunSeverity {
  if (run.status === 'MAX_RECOVERY_ATTEMPTS_EXCEEDED') return 'exhausted';
  // Before the failed set, which holds it: somebody
  // asked for this one, so it is not a failure
  // anybody has to look into.
  if (run.status === 'CANCELLED') return 'cancelled';
  if (run.status === 'ERROR') return 'failed';
  if (!IN_FLIGHT.has(run.status)) return 'ok';

  return parked ? 'waiting' : 'running';
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

function whenOf(run: Run): string {
  const at = clock(run.createdAt);

  return run.completedAt === undefined
    ? at
    : `${at} · ${duration(run.completedAt - run.createdAt)}`;
}

function spanOf(run: Run): string {
  const started = precise(run.startedAt ?? run.createdAt);

  return run.completedAt === undefined
    ? messages.runSpanRunning(started)
    : messages.runSpan(started, precise(run.completedAt));
}

/**
 * The banner over a run DBOS picked back up.
 *
 * Two forms, because there are two things that can
 * honestly be said. When the steps leave a hole
 * wide enough to place, the sentence names what
 * that cost and how many steps came back instead
 * of running. When they do not, the count is all
 * there is — `recovery_attempts` is a number, and
 * no column anywhere holds the moment a process
 * died.
 */
function recoveredBanner(run: Run, reading: Reading): SeeRun['recovered'] {
  if (!hasRecovered(run)) return undefined;

  const heading = messages.runRecoveredHeading();
  const outage = reading.outage;

  if (outage === undefined) {
    return {
      heading,
      body: messages.runRecoveredUnplaced(),
      figures: undefined,
    };
  }

  const restored = reading.steps.filter((step) => step.restored).length;

  return {
    heading,
    body: messages.runRecoveredBody(),
    figures: {
      down: messages.runRecoveredDown(duration(outage.to - outage.from)),
      reused: messages.runRecoveredReused(restored),
    },
  };
}

function chipOf(step: Operation, points: ReplayPoints): SeeChip {
  return {
    functionId: step.functionId,
    name: step.name,
    restored: step.restored,
    reused: step.reused,
    failed: step.error !== undefined,
    ...offerOf(points, step.functionId),
  };
}

/**
 * The chart, in fractions of its own window.
 *
 * `0` is the left edge and `1` the right, rounded
 * to something a stylesheet can carry and a test
 * can state. A step DBOS did not time gets no bar
 * and is still drawn, because a step missing from
 * the chart is a step nobody knows ran.
 *
 * The window, the band and the axis come from the
 * whole reading; the bars come from `drawn`, which
 * is the rows a block owns.
 */
function chartOf(reading: Reading, drawn: readonly Operation[]): SeeTimeline {
  const span = reading.to - reading.from;
  const place = (at: number): number => round((at - reading.from) / span);

  const bars: SeeBar[] = drawn.map((step) => ({
    functionId: step.functionId,
    name: step.name,
    at:
      step.startedAt === undefined || step.completedAt === undefined
        ? undefined
        : {
            from: place(step.startedAt),
            width: round((step.completedAt - step.startedAt) / span),
          },
    restored: step.restored,
    reused: step.reused,
    failed: step.error !== undefined,
  }));

  return {
    bars,
    outage: bandOf(reading, place, span),
    ticks: ticksOf(reading),
  };
}

function bandOf(
  reading: Reading,
  place: (at: number) => number,
  span: number,
): SeeOutage | undefined {
  const outage = reading.outage;
  if (outage === undefined) return undefined;

  return {
    from: place(outage.from),
    width: round((outage.to - outage.from) / span),
    down: messages.runProcessDown(duration(outage.to - outage.from)),
    resumed: messages.runResumed(),
  };
}

/** The axis: where it started, where it ended, and
 *  the two edges of the hole if there is one. */
function ticksOf(reading: Reading): { at: number; label: string }[] {
  const span = reading.to - reading.from;
  const marks = [
    reading.from,
    ...(reading.outage === undefined
      ? []
      : [reading.outage.from, reading.outage.to]),
    reading.to,
  ];

  return marks.map((at) => ({
    at: round((at - reading.from) / span),
    label: precise(at),
  }));
}

function rawRowOf(step: Step): SeeRawRow {
  return {
    stepId: step.functionId,
    fn: step.name,
    output: cut(step.output ?? step.error ?? ''),
    committedAt:
      step.completedAt === undefined ? '' : precise(step.completedAt),
  };
}

/**
 * The run as `dbos.workflow_status` holds it.
 *
 * The four the design names, plus the version when
 * DBOS recorded one — it is what decides whether a
 * replay of this run can reach a worker at all, so
 * it belongs beside the button that makes one.
 */
function railOf(run: Run): { label: string; value: string }[] {
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
 * Which of the two controls the run is open to, and
 * what it already carries.
 *
 * Both answers come off the status column and
 * nothing else, because that is the column DBOS's
 * own statements are conditioned on: cancel and
 * resume both end in `status NOT IN
 * ('SUCCESS','ERROR')`. Offering either where the
 * statement would change nothing is offering a
 * button that does nothing and says so afterwards.
 *
 * Never both, and the two sets cannot overlap: a run
 * is either still going or it has stopped.
 */
function controlsOf(
  run: Run,
  drawn: readonly Operation[],
  cancelledHere: boolean,
): SeeRun['controls'] {
  const last = drawn.at(-1);

  return {
    cancel: IN_FLIGHT.has(run.status),
    resume: RESUMABLE.has(run.status),
    cancelled: cancelledAt(run, cancelledHere),
    lastRecorded:
      last === undefined
        ? undefined
        : messages.runLastRecorded(last.name, last.functionId),
  };
}

/**
 * When the run was cancelled, and whether this
 * window is what did it.
 *
 * `completed_at` is what cancelling writes, so it is
 * the moment to show. A cancelled run with no
 * completion recorded is a row this extension did
 * not write and cannot date, and it says the plain
 * status instead of guessing at a time.
 */
function cancelledAt(run: Run, cancelledHere: boolean): string | undefined {
  if (run.status !== 'CANCELLED') return undefined;

  const at = precise(run.completedAt ?? run.createdAt);

  return cancelledHere ? messages.runCancelledByYou(at) : at;
}

/** Seconds with one decimal, the way the design
 *  writes them, and milliseconds under a second. */
function duration(ms: number): string {
  return ms < 1000
    ? messages.runMilliseconds(Math.round(ms))
    : messages.runSeconds((ms / 1000).toFixed(1));
}

function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function precise(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function cut(value: string): string {
  return value.length <= OUTPUT_CELL
    ? value
    : `${value.slice(0, OUTPUT_CELL)}…`;
}

/** Four decimals is finer than a pixel on any
 *  panel, and keeps the numbers readable. */
function round(fraction: number): number {
  return Math.round(fraction * 10_000) / 10_000;
}

/**
 * The run evidence, said twice: once as a summary
 * a person reads in the transcript, and once as
 * the sentence the agent is asked.
 *
 * Both are assembled clause by clause from what the
 * record carries. A fact the record does not have
 * is left out rather than printed as a label with
 * nothing after it — the record is built not to
 * invent, and words wrapped around it may not
 * either.
 */

/** The summary folded under the transcript row. */
export function evidenceLines(evidence: RunEvidence): string[] {
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

  return [
    headlineOf(evidence),
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
 * Which run failed, and where.
 *
 * A block where the record names one, the run
 * itself where it does not, and neither where the
 * run recorded no failure at all — any run the
 * ledger has can be asked about, and one that
 * succeeded has to be described as one.
 */
function headlineOf(evidence: RecordedRunEvidence): string {
  const said = observed(evidence);

  if (said === undefined) {
    return messages.runAskAgentNoFailure(
      evidence.workflowId,
      evidence.workflow,
      evidence.status,
    );
  }

  const title = evidence.node?.title ?? evidence.failedStep?.name;

  return title === undefined
    ? messages.runAskAgentWith(evidence.workflowId, evidence.workflow, said)
    : messages.runAskAgentAtBlock(
        evidence.workflowId,
        evidence.workflow,
        title,
        said,
      );
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

/** One run, as the summary lists it. */
function recordedLines(evidence: RecordedRunEvidence): string[] {
  const said = observed(evidence);
  const handler = evidence.handler;
  const retry = evidence.node?.retry;

  return [
    said === undefined ? undefined : messages.runEvidenceError(said),
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
    messages.runEvidenceStatus(evidence.status),
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
  ].filter((line) => line !== undefined);
}

/** A run that never started, as the summary lists
 *  it: what it was going to be, when, and why not. */
function refusedLines(evidence: RefusedRunEvidence): string[] {
  return [
    messages.runEvidenceRefused(evidence.workflow, evidence.refusedAt),
    ...(evidence.detail === ''
      ? []
      : [messages.runEvidenceDetail(evidence.detail)]),
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
      : duration(operation.durationMs);

  return [`${operation.name} · #${String(operation.functionId)}`, spent]
    .filter((part) => part !== undefined)
    .join(' · ');
}
