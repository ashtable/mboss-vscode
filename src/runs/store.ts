import { basename } from 'node:path';

import type { Disposable } from 'vscode';

import type { DiagnosticEntry } from '../acp/transcript.js';
import { messages } from '../messages.js';

import type { Database, OpenDatabase, OpenFork } from './db.js';
import { describeDatabase, systemDatabaseUrl } from './env.js';
import { detailOf } from './failure.js';
import {
  MAX_RUNS,
  countsQuery,
  runQuery,
  runsQuery,
  stepsQuery,
  type RunFilter,
} from './queries.js';
import { replayFrom, type ForkClient, type Replay } from './replay.js';
import {
  toCounts,
  toRun,
  toStep,
  type CountsRow,
  type OperationOutputRow,
  type Run,
  type RunCounts,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';
import { newRunId, type RunStart, type RunStarter } from './runner.js';
import {
  refusedRunId,
  type SessionLog,
  type SessionRun,
} from './sessionLog.js';
import type { StackController, StackStatus } from './stack.js';
import type { RunsView, SeeView, TestRunProblem } from './view.js';
import type { LiveRun, RunWatch, RunWatcher } from './watch.js';
import { projectWorkflows, type ProjectWorkflow } from './workflows.js';

/**
 * What the window knows about a project's runs.
 *
 * Held by the extension rather than by either view,
 * the same way the transcript and the proposals
 * are: the list is a panel in the activity bar and
 * the detail is an editor tab, and neither may hold
 * state the other needs. Both read from here, and
 * so does the canvas, which draws the run it is
 * about.
 *
 * Nothing is read on a schedule. A database is
 * somebody else's, and an editor polling one all
 * afternoon to notice a run that finished is a cost
 * the person did not ask for — so the list is read
 * when it is shown, when the filter changes, and
 * when somebody asks for it again. The one
 * exception is a run somebody just started, which
 * is watched until it stops moving; refresh is
 * what arms that again.
 */

/** The slice of the editor this needs, and no
 *  more. */
export type RunsHost = {
  /** Every mBoss project open in this window. */
  projects(): string[];

  /** Whether the person has said this folder's
   *  contents may be executed and connected to. */
  isTrusted(): boolean;

  /** Tells the person something they can act on. */
  say(message: string): void;

  /** Publishes a fact `when` clauses can read, so
   *  the view's Start and Stop swap with what is
   *  running. */
  setContext(key: string, value: unknown): void;

  /** Puts what the extension did in the agent's
   *  transcript, beside what the agent did. */
  note(entry: DiagnosticEntry): void;

  /** Hands the agent something to answer. */
  notify(text: string): Promise<void>;
};

export type RunsDeps = {
  host: RunsHost;

  open: OpenDatabase;

  openFork: OpenFork;

  stack: StackController;

  runner: RunStarter;

  watch: RunWatch;

  sessionLog: SessionLog;
};

/** Which command the stack is in the middle of. */
export type StackAction = 'up' | 'down' | 'rebuild';

export type RunsStore = {
  /** What the list draws. */
  list(): RunsView;

  /** What the detail tab draws, when a run has been
   *  picked. */
  detail(): SeeView | undefined;

  /** The run a canvas draws itself against, when
   *  one has been followed. */
  live(): LiveRun | undefined;

  refresh(): Promise<void>;

  setFilter(filter: RunFilter): Promise<void>;

  select(workflowId: string): Promise<void>;

  /** Re-reads the project's saved workflows off
   *  disk, without touching the stack or the run
   *  history — what a command needs before it opens
   *  a picker, in a window where nothing has read
   *  them yet. */
  refreshWorkflows(): void;

  /** Which step the rail describes and a replay
   *  would fork from. */
  selectStep(functionId: number): void;

  replay(functionId: number): Promise<void>;

  stackUp(): Promise<void>;

  stackDown(): Promise<void>;

  stackRebuild(): Promise<void>;

  /** Which saved workflow the test-run zone's
   *  picker has open, so the hint beside the input
   *  box is about the right one. */
  selectWorkflow(workflow: string): void;

  /** Starts one run of a saved workflow, with
   *  whatever the input box holds. */
  runWorkflow(workflow: string, input: string): Promise<void>;

  /** Starts a run of the same workflow with the
   *  same input. */
  rerun(workflowId: string): Promise<void>;

  /** Hands a failed run to the agent. */
  askAgent(workflowId: string): Promise<void>;

  onChanged(listener: () => void): Disposable;
};

const EMPTY: RunCounts = { all: 0, failed: 0, recovered: 0 };

const NO_STACK: StackStatus = {
  available: false,
  services: [],
  detail: undefined,
};

/**
 * The fact the view's two title buttons swap on.
 *
 * Read from what compose says rather than from
 * what was last asked for: a stack somebody
 * started outside the editor is up, and a Start
 * button over it would do nothing visible.
 */
const STACK_UP_KEY = 'mboss.stackUp';

/** Outcomes a watch has nothing left to say
 *  about. */
const SETTLED: readonly LiveRun['outcome'][] = ['done', 'failed'];

export function runsStore(deps: RunsDeps): RunsStore {
  const listeners = new Set<() => void>();

  let filter: RunFilter = 'all';
  let state: RunsView['state'] = 'no-project';
  let detail: string | undefined;
  let database: string | undefined;
  let runs: Run[] = [];
  let counts: RunCounts = EMPTY;
  let selected: SeeView | undefined;
  let note: string | undefined;

  let stack: StackStatus = NO_STACK;
  let busy: StackAction | undefined;
  let workflows: ProjectWorkflow[] = [];
  let workflow: string | undefined;
  let input = '';
  let problem: TestRunProblem | undefined;
  let live: LiveRun | undefined;

  /** One watch per run, so that asking twice does
   *  not poll twice. */
  const watching = new Map<string, RunWatcher>();

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  const project = (): string | undefined => deps.host.projects()[0];

  /**
   * The connection string, or the reason there is
   * none — which is what the panel shows in place
   * of a list.
   */
  const connection = (): string | undefined => {
    const dir = project();

    if (dir === undefined) {
      state = 'no-project';
      return undefined;
    }

    if (!deps.host.isTrusted()) {
      state = 'untrusted';
      return undefined;
    }

    const found = systemDatabaseUrl(dir);

    if (!found.ok) {
      state = 'unreachable';
      detail =
        found.because === 'no-env-file'
          ? messages.runsNoEnvFile(found.path)
          : messages.runsNoDatabaseUrl(found.path);

      return undefined;
    }

    database = describeDatabase(found.url);

    return found.url;
  };

  /**
   * The same string, asked for quietly.
   *
   * A watch is armed alongside whatever else is
   * going on, and a project with no connection
   * string is a reason not to arm one — never a
   * reason to replace the list somebody is looking
   * at with a sentence about it.
   */
  const ledger = (): string | undefined => {
    const dir = project();
    if (dir === undefined || !deps.host.isTrusted()) return undefined;

    const found = systemDatabaseUrl(dir);

    return found.ok ? found.url : undefined;
  };

  /** Opens, reads, and closes again — whatever the
   *  read did. */
  const read = async <Value>(
    url: string,
    take: (db: Database) => Promise<Value>,
  ): Promise<Value | undefined> => {
    let db: Database | undefined;

    try {
      db = await deps.open(url);

      const value = await take(db);
      state = 'ok';
      detail = undefined;

      return value;
    } catch (cause) {
      state = 'unreachable';
      detail = messages.runsUnreachable(detailOf(cause));

      return undefined;
    } finally {
      await db?.close().catch(() => undefined);
    }
  };

  /**
   * What compose says, and the fact the title
   * buttons swap on.
   *
   * Every one of these commands executes the
   * folder's contents, so an untrusted window asks
   * nothing at all rather than asking and ignoring
   * the answer.
   */
  const readStack = async (): Promise<void> => {
    const dir = project();

    if (dir === undefined || !deps.host.isTrusted()) {
      stack = NO_STACK;
      deps.host.setContext(STACK_UP_KEY, false);

      return;
    }

    stack = await deps.stack.status(dir);

    // Anything running is a stack there is
    // something to stop. A database that came up
    // while the app crashed is still a stack.
    deps.host.setContext(
      STACK_UP_KEY,
      stack.services.some((service) => service.state === 'running'),
    );
  };

  /** What the project has saved, and which of them
   *  the input box belongs to. */
  const readWorkflows = (): void => {
    const dir = project();
    workflows = dir === undefined ? [] : projectWorkflows(dir);

    if (workflows.some((flow) => flow.name === workflow)) return;

    workflow = workflows.find((flow) => flow.trigger.mode !== 'schedule')?.name;
  };

  /** The history list, and nothing else. */
  const readRuns = async (): Promise<void> => {
    runs = [];
    counts = EMPTY;

    const url = connection();
    if (url === undefined) return void changed();

    const page = await read(url, async (db) => {
      const list = runsQuery(filter, MAX_RUNS);
      const totals = countsQuery();

      return {
        runs: (await db.query<WorkflowStatusRow>(list.text, list.values)).map(
          toRun,
        ),
        counts: toCounts(
          (await db.query<CountsRow>(totals.text, totals.values))[0],
        ),
      };
    });

    if (page !== undefined) {
      runs = page.runs;
      counts = page.counts;
    }

    changed();
  };

  /**
   * Everything the panel shows, asked for again.
   *
   * This is also the one thing that re-arms a
   * watch: a run parked on a person and a run that
   * has gone quiet are both watches that let go, and
   * nothing puts them back on a timer. Somebody
   * asking is what moves them.
   */
  const refresh = async (): Promise<void> => {
    await readStack();
    readWorkflows();
    rewatch();

    await readRuns();
  };

  /**
   * One command against the stack, with the panel
   * saying which one is going.
   *
   * The status read afterwards is the point: `up`
   * answers when the containers are up, and what
   * the panel draws is what compose says about them
   * rather than the fact that a command returned.
   */
  const command = async (
    action: StackAction,
    run: (dir: string) => Promise<void>,
  ): Promise<void> => {
    const dir = project();
    if (dir === undefined || !deps.host.isTrusted()) return;

    busy = action;
    problem = undefined;
    changed();

    try {
      await run(dir);
    } finally {
      busy = undefined;
    }

    await readStack();
    changed();
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

    const url = ledger();
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
    list: () => ({
      project: mapDefined(project(), basename),
      state,
      detail,
      database,
      filter,
      counts,
      runs,
      selected: selected?.run.workflowId,
      stack,
      busy,
      workflows,
      workflow,
      input,
      hint: hintFor(workflows, workflow),
      problem,
      live,
      session: deps.sessionLog.list(),
    }),

    detail: () => selected,

    live: () => live,

    refresh,

    // Only the list: which tab somebody is on says
    // nothing about the stack, and reading it would
    // shell out to compose on every click.
    setFilter: async (next) => {
      filter = next;
      await readRuns();
    },

    select: async (workflowId) => {
      const url = connection();
      if (url === undefined) return void changed();

      // `null` for a run that is not there, against
      // `undefined` for a read that did not happen:
      // a row somebody deleted has to clear what the
      // tab is showing, where a database that went
      // away must not, or the tab would go blank on
      // a hiccup.
      const found = await read(url, async (db) => {
        const one = runQuery(workflowId);
        const rows = await db.query<WorkflowStatusRow>(one.text, one.values);
        const found = rows[0];

        if (found === undefined) return null;

        const steps = stepsQuery(workflowId);

        return {
          run: toRun(found),
          steps: (
            await db.query<OperationOutputRow>(steps.text, steps.values)
          ).map(toStep),
        };
      });

      if (found !== undefined) {
        // A different run is a different question,
        // so the note about the last replay and the
        // step somebody had picked both go.
        note = undefined;
        selected =
          found === null
            ? undefined
            : { ...found, selectedStep: firstStep(found.steps), note };
      }

      changed();
    },

    refreshWorkflows: () => {
      readWorkflows();
      changed();
    },

    selectStep: (functionId) => {
      if (selected === undefined) return;

      selected = { ...selected, selectedStep: functionId };
      changed();
    },

    replay: async (functionId) => {
      const showing = selected;
      if (showing === undefined || !deps.host.isTrusted()) return;

      const url = connection();
      if (url === undefined) return void changed();

      const outcome = await forkedFrom(deps, url, showing.run, functionId);

      note =
        outcome.at === 'refused'
          ? messages.replayRefused(outcome.detail)
          : outcome.movedFrom === undefined
            ? messages.replayStarted(
                outcome.workflowId,
                outcome.applicationVersion,
              )
            : messages.replayStartedNewer(
                outcome.workflowId,
                outcome.applicationVersion,
                outcome.movedFrom,
              );

      // Said in the notification area as well as on
      // the panel: a fork is a new run that nothing
      // on screen is showing yet, and the sentence
      // names the version it is waiting for.
      deps.host.say(note);

      selected = { ...showing, note };

      // The list now has a run in it that was not
      // there a moment ago.
      await readRuns();
    },

    stackUp: () => command('up', (dir) => deps.stack.up(dir)),

    stackDown: () => command('down', (dir) => deps.stack.down(dir)),

    stackRebuild: () => command('rebuild', (dir) => deps.stack.rebuild(dir)),

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

    onChanged: (listener) => {
      listeners.add(listener);

      return { dispose: () => void listeners.delete(listener) };
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

/**
 * Opening the client is itself a connection, and a
 * database that is down refuses it before there is
 * anything to fork — so the failure has to become
 * the same sentence the fork's own would.
 */
async function forkedFrom(
  deps: RunsDeps,
  url: string,
  run: Run,
  functionId: number,
): Promise<Replay> {
  let client: ForkClient;
  try {
    client = await deps.openFork(url);
  } catch (cause) {
    return { at: 'refused', detail: detailOf(cause) };
  }

  return await replayFrom(client, run, functionId);
}

/** The step a replay starts from unless somebody
 *  picks another: the first one, which replays the
 *  whole run from its ledger. */
function firstStep(steps: Step[]): number | undefined {
  return steps[0]?.functionId;
}

function mapDefined<In, Out>(
  value: In | undefined,
  map: (value: In) => Out,
): Out | undefined {
  return value === undefined ? undefined : map(value);
}
