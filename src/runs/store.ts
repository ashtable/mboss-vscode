import { basename } from 'node:path';

import type { Disposable } from 'vscode';

import type { DiagnosticEntry } from '../acp/transcript.js';
import { emitter } from '../emitter.js';
import type { RunsInit } from '../webview/protocol.js';

import type { OpenDatabase, OpenFork } from './db.js';
import { runHistory } from './history.js';
import type { RunFilter } from './queries.js';
import type { RunStarter } from './runner.js';
import type { SessionLog } from './sessionLog.js';
import type { StackController } from './stack.js';
import { stackZone } from './stackZone.js';
import { testRunZone } from './testRun.js';
import type { SeeView } from './view.js';
import type { LiveRun, RunWatch } from './watch.js';
import { runsWords } from './words.js';

export type { StackAction } from './stackZone.js';

/**
 * What the window knows about a project's runs,
 * behind one door.
 *
 * Held by the extension rather than by either view,
 * the same way the transcript and the proposals
 * are: the list is a panel in the activity bar and
 * the detail is an editor tab, and neither may hold
 * state the other needs. Both read from here, and
 * so does the canvas, which draws the run it is
 * about.
 *
 * Three things are held, and they share almost
 * nothing: the run history read out of the
 * project's Postgres, the local stack as compose
 * reports it, and what this window set going. Each
 * is a module of its own with its own slots and its
 * own change signal — `history.ts`, `stackZone.ts`,
 * `testRun.ts` — and this is where the three are
 * introduced to each other and composed into the
 * one picture the panel draws. The verbs here are
 * the panels', the commands' and the canvas', which
 * is why there is a façade at all.
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

export type RunsStore = Disposable & {
  /** What the list draws, whole: the zones are the
   *  modules' and the shape is the panel's, and
   *  nothing stands between them. */
  list(): RunsInit;

  /** What the detail tab draws, when a run has been
   *  picked. */
  detail(): SeeView | undefined;

  /** The run a canvas draws itself against, when
   *  one has been followed. */
  live(): LiveRun | undefined;

  /**
   * Everything the panel shows, asked for again.
   *
   * This is also the one thing that re-arms a
   * watch: a run parked on a person and a run that
   * has gone quiet are both watches that let go, and
   * nothing puts them back on a timer. Somebody
   * asking is what moves them.
   */
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

export function runsStore(deps: RunsDeps): RunsStore {
  const history = runHistory({
    host: deps.host,
    open: deps.open,
    openFork: deps.openFork,
  });
  const stack = stackZone({ host: deps.host, stack: deps.stack });
  const testRun = testRunZone({
    host: deps.host,
    open: deps.open,
    runner: deps.runner,
    watch: deps.watch,
    sessionLog: deps.sessionLog,
    // Whether the ledger can be read is the
    // history's state; a watch only needs the
    // answer.
    ledger: () => history.ledger(),
  });

  // One signal for the three, since every reader
  // draws all of them at once.
  const changes = emitter();
  const followed = [history, stack, testRun].map((zone) =>
    zone.onChanged(changes.fire),
  );

  const project = (): string | undefined => deps.host.projects()[0];

  /** A stack command, with the problem under the
   *  input box let go of first: Rebuild is what one
   *  of those problems asks for. */
  const stacking = async (command: () => Promise<void>): Promise<void> => {
    testRun.clearProblem();
    await command();
  };

  return {
    list: () => {
      const dir = project();

      return {
        type: 'init',
        view: 'runs',
        strings: runsWords(),
        project: dir === undefined ? undefined : basename(dir),
        ...history.render(),
        stack: stack.render(),
        ...testRun.render(),
      };
    },

    detail: history.detail,
    live: testRun.live,

    refresh: async () => {
      await stack.read();
      testRun.refresh();
      await history.refresh();
    },

    // Only the list: which tab somebody is on says
    // nothing about the stack, and reading it would
    // shell out to compose on every click.
    setFilter: history.setFilter,
    select: history.select,
    refreshWorkflows: testRun.refreshWorkflows,
    selectStep: history.selectStep,
    replay: history.replay,

    stackUp: () => stacking(stack.up),
    stackDown: () => stacking(stack.down),
    stackRebuild: () => stacking(stack.rebuild),

    selectWorkflow: testRun.selectWorkflow,
    runWorkflow: testRun.runWorkflow,
    rerun: testRun.rerun,
    askAgent: testRun.askAgent,

    onChanged: changes.on,

    dispose: () => {
      for (const subscription of followed) subscription.dispose();
      history.dispose();
      stack.dispose();
      testRun.dispose();
      changes.dispose();
    },
  };
}
