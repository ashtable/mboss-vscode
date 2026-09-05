import { messages } from '../messages.js';
import type {
  RunRow,
  RunSeverity,
  RunsInit,
  RunsState,
  SeeBar,
  SeeChip,
  SeeInit,
  SeeOutage,
  SeeRawRow,
  SeeRun,
  SeeTimeline,
  SessionRow,
} from '../webview/protocol.js';

import { runsWords, seeWords } from './words.js';
import type { RunFilter } from './queries.js';
import {
  hasRecovered,
  recoveriesOf,
  type Run,
  type RunCounts,
  type Step,
} from './rows.js';
import type { SessionRun } from './sessionLog.js';
import type { StackStatus } from './stack.js';
import type { StackAction } from './store.js';
import { runTimeline, type Timeline } from './timeline.js';
import type { LiveRun } from './watch.js';
import type { ProjectWorkflow } from './workflows.js';

/**
 * A run history, in the words and shapes the two
 * views draw.
 *
 * Everything a person reads is resolved here,
 * because a webview has no localization bundle.
 * And every position is a fraction of the chart's
 * own window rather than a pixel, because the
 * panel is resizable and the host has no idea how
 * wide it is — so the arithmetic is done once, in
 * one place with a test around it, instead of in a
 * renderer that would need to be handed the window
 * to do it.
 */

/** Statuses that mean the run has not finished. */
const IN_FLIGHT = new Set(['PENDING', 'ENQUEUED', 'DELAYED']);

/**
 * How much of an output one cell carries.
 *
 * The raw panel is a table, and a step that
 * returned a document would otherwise be one row a
 * screen tall. The whole value is a click away in
 * the database this panel names.
 */
const OUTPUT_CELL = 120;

export type RunsView = {
  /** As a person reads it: the folder's own name. */
  project: string | undefined;

  state: RunsState;

  /** Why there is nothing to show. */
  detail: string | undefined;

  /** Host and database, never the credentials. */
  database: string | undefined;

  filter: RunFilter;

  counts: RunCounts;

  runs: Run[];

  selected: string | undefined;

  /** What compose says about the project's own
   *  stack. */
  stack: StackStatus;

  /** Which stack command is going, while one is. */
  busy: StackAction | undefined;

  /** What the project has saved, and which of them
   *  the input box belongs to. */
  workflows: ProjectWorkflow[];
  workflow: string | undefined;

  /** The JSON text as it was last sent, held here
   *  so a repaint does not empty the box. */
  input: string;

  /** That the same input is the same run, where
   *  the trigger says so. */
  hint: string | undefined;

  /** Why the last start did not happen. */
  problem: TestRunProblem | undefined;

  /** The run being followed, if one is. */
  live: LiveRun | undefined;

  /** What this window has set going, newest
   *  first. */
  session: SessionRun[];
};

/**
 * Why a run did not start.
 *
 * `rebuildToRun` travels apart from the sentence
 * so the panel can offer the same Rebuild action
 * the stack zone's `app` row does, rather than
 * parsing the sentence to find out which problem
 * this was.
 */
export type TestRunProblem = {
  detail: string;

  rebuildToRun: boolean;
};

export type SeeView = {
  run: Run;

  steps: Step[];

  selectedStep: number | undefined;

  /** What the last replay did. */
  note: string | undefined;
};

export function runsInit(view: RunsView): RunsInit {
  return {
    type: 'init',
    view: 'runs',
    strings: runsWords(),
    source:
      view.database === undefined
        ? undefined
        : messages.runsSource(view.database),
    project: view.project,
    state: view.state,
    detail: view.detail,
    filter: view.filter,
    counts: view.counts,
    rows: view.runs.map(rowOf),
    selected: view.selected,
    stack: {
      available: view.stack.available,
      services: view.stack.services,
      busy: view.busy,
      detail: view.stack.detail,
    },
    testRun: {
      workflows: view.workflows.map((flow) => ({
        name: flow.name,
        title: flow.title,
        mode: flow.trigger.mode,
      })),
      selected: view.workflow,
      input: view.input,
      hint: view.hint,
      problem: view.problem,
    },
    live: view.live,
    session: view.session.map((run) => sessionRowOf(run, view.workflows)),
  };
}

/**
 * One session run, in the words the panel draws.
 *
 * `keyed` comes from the document rather than from
 * the run: whether sending this input again is the
 * same run is a fact about the workflow's trigger,
 * and it is what decides which of the two actions
 * the row offers.
 */
function sessionRowOf(
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
  };
}

function sessionWhen(run: SessionRun): string {
  const at = clock(run.startedAt);

  return run.durationMs === undefined
    ? at
    : `${at} · ${duration(run.durationMs)}`;
}

export function seeInit(view: SeeView | undefined): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeWords(),
    run: view === undefined ? undefined : seeRun(view),
  };
}

function seeRun(view: SeeView): SeeRun {
  const { run, steps } = view;
  const timeline = runTimeline(run, steps);

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
    severity: severityOf(run),
    span: spanOf(run),
    recovered: recoveredBanner(run, timeline),
    chips: timeline.steps.map(chipOf),
    timeline: chartOf(timeline),
    raw: steps.map(rawRowOf),
    rail: railOf(run),
    selectedStep: view.selectedStep,
    note: view.note,
  };
}

function rowOf(run: Run): RunRow {
  return {
    workflowId: run.workflowId,
    name: run.name,
    status: run.status,
    severity: severityOf(run),
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
  };
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
 */
function severityOf(run: Run): RunSeverity {
  if (run.status === 'MAX_RECOVERY_ATTEMPTS_EXCEEDED') return 'exhausted';
  if (run.status === 'ERROR' || run.status === 'CANCELLED') return 'failed';

  return IN_FLIGHT.has(run.status) ? 'running' : 'ok';
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
function recoveredBanner(
  run: Run,
  timeline: Timeline,
): { heading: string; body: string } | undefined {
  if (!hasRecovered(run)) return undefined;

  const restored = timeline.steps.filter((step) => step.restored).length;
  const outage = timeline.outage;

  return {
    heading: messages.runRecoveredHeading(),
    body:
      outage === undefined
        ? messages.runRecoveredUnplaced()
        : messages.runRecoveredBody(
            duration(outage.to - outage.from),
            restored,
          ),
  };
}

function chipOf(step: Timeline['steps'][number]): SeeChip {
  return {
    functionId: step.functionId,
    name: step.name,
    restored: step.restored,
    failed: step.error !== undefined,
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
 */
function chartOf(timeline: Timeline): SeeTimeline {
  const span = timeline.to - timeline.from;
  const place = (at: number): number => round((at - timeline.from) / span);

  const bars: SeeBar[] = timeline.steps.map((step) => ({
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
    failed: step.error !== undefined,
  }));

  return {
    bars,
    outage: bandOf(timeline, place, span),
    ticks: ticksOf(timeline),
  };
}

function bandOf(
  timeline: Timeline,
  place: (at: number) => number,
  span: number,
): SeeOutage | undefined {
  const outage = timeline.outage;
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
function ticksOf(timeline: Timeline): { at: number; label: string }[] {
  const span = timeline.to - timeline.from;
  const marks = [
    timeline.from,
    ...(timeline.outage === undefined
      ? []
      : [timeline.outage.from, timeline.outage.to]),
    timeline.to,
  ];

  return marks.map((at) => ({
    at: round((at - timeline.from) / span),
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
