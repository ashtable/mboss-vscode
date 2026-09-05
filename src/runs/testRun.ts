import type { Disposable } from 'vscode';

import type { DiagnosticEntry } from '../acp/transcript.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import type { RunsInit } from '../webview/protocol.js';

import type { OpenDatabase } from './db.js';
import { newRunId, type RunStart, type RunStarter } from './runner.js';
import {
  refusedRunId,
  type SessionLog,
  type SessionRun,
} from './sessionLog.js';
import { sessionRowOf, type TestRunProblem } from './view.js';
import type { LiveRun, RunWatch, RunWatcher } from './watch.js';
import { projectWorkflows, type ProjectWorkflow } from './workflows.js';

/**
 * What this window set going, as the panel shows
 * it.
 *
 * The workflows a project has saved and which of
 * them the input box belongs to; the runs this
 * window started, in the session log; the watch on
 * each of them while it moves; and the one run the
 * canvas draws itself against. A run somebody just
 * started is the one thing in the panel that is
 * followed rather than read on request — watched
 * until it stops moving, and re-armed by a refresh,
 * since a run parked on a person and a run that has
 * gone quiet both let go and nothing puts them back
 * on a timer.
 *
 * The problem shown under the input box is about
 * whichever workflow is picked, and about the stack
 * as it was: a new pick clears it, and so does a
 * stack command, since Rebuild is what one of them
 * asks for.
 */

/** The slice of the editor the zone needs. */
export type TestRunHost = {
  projects(): string[];
  isTrusted(): boolean;

  /** Puts what the extension did in the agent's
   *  transcript, beside what the agent did. */
  note(entry: DiagnosticEntry): void;

  /** Hands the agent something to answer. */
  notify(text: string): Promise<void>;
};

export type TestRunDeps = {
  host: TestRunHost;
  open: OpenDatabase;
  runner: RunStarter;
  watch: RunWatch;
  sessionLog: SessionLog;

  /** The connection string a watch reads the run
   *  from, quietly: none is a reason not to arm
   *  one. */
  ledger(): string | undefined;
};

/** What the list draws of this session. */
export type TestRunZone = Pick<RunsInit, 'testRun' | 'live' | 'session'>;

export type TestRun = Disposable & {
  /** Reads the saved workflows again and re-arms
   *  the watches on runs still moving, quietly:
   *  the panel is drawn again by whoever asked. */
  refresh(): void;

  /** Re-reads the project's saved workflows off
   *  disk and says so — what a command needs before
   *  it opens a picker, in a window where nothing
   *  has read them yet. */
  refreshWorkflows(): void;

  /** Which saved workflow the picker has open, so
   *  the hint beside the input box is about the
   *  right one. */
  selectWorkflow(workflow: string): void;

  /** Starts one run of a saved workflow, with
   *  whatever the input box holds. */
  runWorkflow(workflow: string, input: string): Promise<void>;

  /** Starts a run of the same workflow with the
   *  same input. */
  rerun(workflowId: string): Promise<void>;

  /** Hands a failed run to the agent. */
  askAgent(workflowId: string): Promise<void>;

  /** Drops the problem under the input box, quietly:
   *  a stack command that is about to say something
   *  itself is what asks. */
  clearProblem(): void;

  /** The run a canvas draws itself against, when
   *  one has been followed. */
  live(): LiveRun | undefined;

  render(): TestRunZone;

  onChanged(listener: () => void): Disposable;
};

/** Outcomes a watch has nothing left to say
 *  about. */
const SETTLED: readonly LiveRun['outcome'][] = ['done', 'failed'];

export function testRunZone(deps: TestRunDeps): TestRun {
  const changes = emitter();

  let workflows: ProjectWorkflow[] = [];
  let workflow: string | undefined;
  let input = '';
  let problem: TestRunProblem | undefined;
  let live: LiveRun | undefined;

  /** One watch per run, so that asking twice does
   *  not poll twice. */
  const watching = new Map<string, RunWatcher>();

  const changed = changes.fire;

  const project = (): string | undefined => deps.host.projects()[0];

  /** What the project has saved, and which of them
   *  the input box belongs to. */
  const readWorkflows = (): void => {
    const dir = project();

    workflows = dir === undefined ? [] : projectWorkflows(dir);

    if (workflows.some((flow) => flow.name === workflow)) return;

    workflow = workflows.find((flow) => flow.trigger.mode !== 'schedule')?.name;
  };

  /**
   * What the ledger says about a run somebody is
   * watching.
   *
   * The session row moves with it — that is what
   * keeps "this session" honest once the watch has
   * let go — and the run is what a canvas of the
   * same workflow draws itself against.
   */
  const heard = (run: LiveRun): void => {
    live = run;

    const row = deps.sessionLog.find(run.workflowId);
    const failed = run.steps.find((step) => step.state === 'failed');

    deps.sessionLog.update(run.workflowId, {
      outcome: run.outcome,
      stepCount: run.steps.length,
      recovered: run.recovered,
      ...(failed === undefined
        ? {}
        : { failedStep: { name: failed.name, error: run.error ?? '' } }),
      ...(SETTLED.includes(run.outcome) && row !== undefined
        ? { durationMs: Date.now() - row.startedAt }
        : {}),
    });

    // A watch stops itself on anything but
    // `running`, so what is held here has to go
    // with it or refresh would find a watcher that
    // is no longer watching.
    if (run.outcome !== 'running') watching.delete(run.workflowId);

    changed();
  };

  const arm = (workflowId: string): void => {
    if (watching.has(workflowId)) return;

    const url = deps.ledger();
    if (url === undefined) return;

    watching.set(workflowId, deps.watch(deps.open, url, workflowId, heard));
  };

  /** The runs that are still moving, watched
   *  again. */
  const rewatch = (): void => {
    for (const row of deps.sessionLog.list()) {
      if (!SETTLED.includes(row.outcome)) arm(row.workflowId);
    }
  };

  /** What the zone says when a start did not
   *  happen, and whether the same Rebuild action
   *  the stack zone offers fixes it. */
  const problemOf = (answer: RunStart & { ok: false }): TestRunProblem => ({
    detail:
      answer.because === 'rebuild-to-run'
        ? messages.runRebuildToRun()
        : answer.detail,
    rebuildToRun: answer.because === 'rebuild-to-run',
  });

  const row = (
    workflowId: string,
    name: string,
    payload: unknown,
    over: Partial<SessionRun> = {},
  ): SessionRun => ({
    workflowId,
    workflow: name,
    input: payload,
    startedAt: Date.now(),
    outcome: 'running',
    stepCount: 0,
    recovered: false,
    ...over,
  });

  /**
   * One run, started.
   *
   * A manual run's row exists before the request
   * does, under the id the request will carry, so
   * a start the app refuses lands on something
   * already on screen. An event run has no id
   * until the app echoes one, so its row is
   * recorded on the answer — and an echo naming a
   * run this session already has is the route's
   * own idempotency at work, so it selects that
   * row rather than recording a second.
   */
  const start = async (
    flow: ProjectWorkflow,
    payload: unknown,
  ): Promise<void> => {
    const dir = project();
    if (dir === undefined || !deps.host.isTrusted()) return;

    problem = undefined;
    workflow = flow.name;

    if (flow.trigger.mode === 'schedule') return void changed();

    if (flow.trigger.mode === 'manual') {
      const workflowId = newRunId();

      deps.sessionLog.record(row(workflowId, flow.name, payload));
      changed();

      const answer = await deps.runner({
        project: dir,
        workflow: flow.name,
        trigger: { mode: 'manual' },
        input: payload,
        workflowId,
      });

      if (answer.ok) {
        // The id the row is under, not the one that
        // came back: the route starts the run under
        // the id it was handed, and the row on
        // screen is the thing being followed.
        arm(workflowId);
      } else {
        deps.sessionLog.update(workflowId, {
          outcome: 'failed',
          error: answer.detail,
        });
        problem = problemOf(answer);
      }

      return void changed();
    }

    const answer = await deps.runner({
      project: dir,
      workflow: flow.name,
      trigger: { mode: 'event', topic: flow.trigger.topic },
      input: payload,
    });

    if (!answer.ok) {
      // A start nothing can follow is remembered
      // the same way a refused one is: the row and
      // its input are the only trace of it, and
      // the sentence on the row says which it was.
      deps.sessionLog.record(
        row(refusedRunId(), flow.name, payload, {
          outcome: 'failed',
          error: answer.detail,
        }),
      );
      problem = problemOf(answer);

      return void changed();
    }

    if (deps.sessionLog.find(answer.workflowId) === undefined) {
      deps.sessionLog.record(row(answer.workflowId, flow.name, payload));
    }

    arm(answer.workflowId);
    changed();
  };

  return {
    refresh: () => {
      readWorkflows();
      rewatch();
    },

    refreshWorkflows: () => {
      readWorkflows();
      changed();
    },

    selectWorkflow: (name) => {
      workflow = name;
      // A problem left over from the last pick is
      // about that workflow, not this one.
      problem = undefined;
      changed();
    },

    runWorkflow: async (name, text) => {
      readWorkflows();

      const flow = workflows.find((one) => one.name === name);
      if (flow === undefined) return;

      problem = undefined;
      input = text;

      const payload = parsed(text);

      if (!payload.ok) {
        problem = { detail: messages.runNotJson(), rebuildToRun: false };

        return void changed();
      }

      await start(flow, payload.value);
    },

    rerun: async (workflowId) => {
      readWorkflows();

      const previous = deps.sessionLog.find(workflowId);
      if (previous === undefined) return;

      const flow = workflows.find((one) => one.name === previous.workflow);
      if (flow === undefined) return;

      await start(flow, previous.input);
    },

    askAgent: async (workflowId) => {
      const failed = deps.sessionLog.find(workflowId);
      if (failed === undefined) return;

      const said = failed.failedStep?.error ?? failed.error;
      if (said === undefined) return;

      const step = failed.failedStep?.name;

      deps.host.note({
        at: 'diagnostic',
        id: `run:${workflowId}`,
        source: `${failed.workflow} · ${workflowId}`,
        rows: [{ at: step, message: said }],
      });

      await deps.host.notify(
        step === undefined
          ? messages.runAskAgentNoStep(failed.workflow, said)
          : messages.runAskAgent(failed.workflow, step, said),
      );
    },

    clearProblem: () => {
      problem = undefined;
    },

    live: () => live,

    render: () => ({
      testRun: {
        workflows: workflows.map((flow) => ({
          name: flow.name,
          title: flow.title,
          mode: flow.trigger.mode,
          ...(flow.trigger.mode === 'event'
            ? { topic: flow.trigger.topic }
            : {}),
        })),
        selected: workflow,
        input,
        hint: hintFor(workflows, workflow),
        problem,
      },
      live,
      session: deps.sessionLog
        .list()
        .map((run) => sessionRowOf(run, workflows)),
    }),

    onChanged: changes.on,

    dispose: () => {
      // A watch outliving the window that armed it
      // would poll a database nobody is looking at.
      for (const watcher of watching.values()) watcher.stop();
      watching.clear();
      changes.dispose();
    },
  };
}

/**
 * Whether the same input is the same run, said
 * beside the box it is typed into.
 *
 * Only an event workflow whose trigger names a key
 * path has one: that path is what the route mints
 * the run id from.
 */
function hintFor(
  workflows: readonly ProjectWorkflow[],
  picked: string | undefined,
): string | undefined {
  const trigger = workflows.find((flow) => flow.name === picked)?.trigger;

  if (trigger?.mode !== 'event' || trigger.keyPath === undefined) {
    return undefined;
  }

  return messages.runKeyPathHint(trigger.keyPath);
}

/**
 * What the input box holds, as a payload.
 *
 * An empty box is a run with no input rather than
 * a mistake — plenty of workflows take none — and
 * anything else has to be JSON before it is worth
 * sending, because the route parses it and would
 * only say the same thing later.
 */
function parsed(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined };

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
