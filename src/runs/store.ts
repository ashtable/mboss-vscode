import { basename } from 'node:path';

import type { Disposable } from 'vscode';

import type { Agent } from '../acp/agent.js';
import { manifestFor } from '../core/index.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import { openHandler } from '../openHandler.js';
import type { Trust } from '../trust.js';
import type { RunsInit, SeeInit } from '../webview/protocol.js';

import type { OpenDatabase, OpenManagement } from './db.js';
import { following } from './following.js';
import type { ProjectSdk } from './sdk.js';
import { runHistory } from './history.js';
import { openRunZone } from './openRun.js';
import { runQuery, type RunFilter } from './queries.js';
import { toRun, type Run, type WorkflowStatusRow } from './rows.js';
import type { RunStarter } from './runner.js';
import type { SessionLog } from './sessionLog.js';
import type { StackController } from './stack.js';
import { stackZone } from './stackZone.js';
import { testRunZone } from './testRun.js';
import type { SeeView } from './view.js';

import type { LiveRun, RunWatch } from './watch.js';
import { projectWorkflows, workflowDocument } from './workflows.js';
import { runsWords } from './words.js';

export type { StackAction } from './stack.js';

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

  /** Tells the person something they can act on. */
  say(message: string): void;

  /** Publishes a fact `when` clauses can read, so
   *  the view's Start and Stop swap with what is
   *  running. */
  setContext(key: string, value: unknown): void;

  /** Puts text on the clipboard. The clipboard is
   *  the window's, so the store hands text over
   *  rather than reaching for one. */
  copy(text: string): Promise<void>;

  /** Opens a workflow document in the canvas, beside
   *  whatever the person is reading. */
  openCanvas(path: string): Promise<void>;

  /** Opens a file with the caret on a line of it,
   *  counting lines from one the way the manifest
   *  and the editor's gutter both do. */
  openFile(path: string, at?: { line: number; column?: number }): Promise<void>;

  /**
   * The DBOS Conductor console this project is
   * deployed to, or the empty string for the
   * windows that have none.
   *
   * Read on every call rather than at activation,
   * like every other setting on a host: somebody
   * pasting an address into their settings should
   * not have to reload the window.
   */
  conductorConsoleUrl(): string;

  /** Hands a URL to whatever opens links here. */
  openExternal(url: string): Promise<void>;
};

export type RunsDeps = {
  host: RunsHost;
  agent: Agent;
  trust: Trust;
  open: OpenDatabase;
  openManagement: OpenManagement;

  /** Which DBOS a project runs. Handed in rather
   *  than read here, so the store can be driven
   *  without a project on disk. */
  projectSdk: (project: string) => ProjectSdk;
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

  /** The whole run page, in the words it draws —
   *  including which of the two views is on screen,
   *  because the tab belongs beside the run it is a
   *  view of rather than a member away from it. */
  see(): SeeInit;

  /** The open run as it was read, decoded but not
   *  drawn. */
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

  /** Puts a run's id where somebody can paste it. */
  copyRunId(workflowId: string): Promise<void>;

  /**
   * Opens the workflow a run was a run of, to
   * edit.
   *
   * By id rather than by name, because the page and
   * the list both name a run and neither holds the
   * document. What the run recorded is a name; which
   * file that is, and whether the project still has
   * one, is answered here.
   */
  openWorkflow(workflowId: string): Promise<void>;

  /**
   * Opens the code the block runs, out of the
   * document the run was a run of.
   *
   * By run id and block id, which is what the page
   * has: a block is a name in a document, and which
   * document that is comes from what the run
   * recorded. Nothing is repainted — a file opening
   * in a tab says everything there is to say.
   */
  openFunction(workflowId: string, nodeId: string): Promise<void>;

  /**
   * Opens the Conductor console for what this
   * project deploys.
   *
   * Nothing at all in a window with no console
   * configured, which is every window until somebody
   * buys one — the local loop is whole without it.
   */
  openProduction(): Promise<void>;

  /** The run page: which block, which view, whether
   *  the SDK's own rows are shown, and reading it
   *  again. */
  selectNode(nodeId: string): void;

  showTab(tab: 'graph' | 'trace'): void;

  showRaw(raw: boolean): void;

  refreshRun(): Promise<void>;

  onChanged(listener: () => void): Disposable;
};

export function runsStore(deps: RunsDeps): RunsStore {
  /**
   * The one owner of every watch this window arms,
   * built before the zones that use it.
   *
   * What is worth following is composed from both
   * of them — the runs this session started that
   * have not settled, and the one a person has open
   * — which is what keeps `following.ts` ignorant
   * of either. Both closures are called long after
   * this line, so naming the zones here is safe.
   */
  const follow = following({
    open: deps.open,
    watch: deps.watch,
    ledger: () => history.ledger(),
    unsettled: () => [
      ...new Set([...testRun.unsettled(), ...openRun.unsettled()]),
    ],
  });

  const history = runHistory({
    host: deps.host,
    trust: deps.trust,
    open: deps.open,
  });

  // The run page reads the same ledger, and borrows
  // the connection rather than opening one of its
  // own — what a read learns about somebody's
  // database is the list's to say.
  const openRun = openRunZone({
    host: deps.host,
    trust: deps.trust,
    openManagement: deps.openManagement,
    projectSdk: deps.projectSdk,
    following: follow,
    project: () => deps.host.projects()[0],
    ledger: history,
  });
  const stack = stackZone({
    host: deps.host,
    trust: deps.trust,
    stack: deps.stack,
  });
  const testRun = testRunZone({
    host: deps.host,
    agent: deps.agent,
    trust: deps.trust,
    runner: deps.runner,
    sessionLog: deps.sessionLog,
    following: follow,
  });

  // One signal for the three, since every reader
  // draws all of them at once.
  const changes = emitter();
  const followed = [history, openRun, stack, testRun].map((zone) =>
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

  /**
   * One run, read again by id rather than taken
   * from whatever the page is showing: what a
   * caller names is a run, and which workflow that
   * run was a run of is the ledger's answer.
   *
   * A database that would not answer and a run
   * nobody has come back the same way, because they
   * come to the same thing for every caller here:
   * there is nothing to open. Why is the list's to
   * say, and the list says it the next time it is
   * drawn.
   */
  const runById = async (workflowId: string): Promise<Run | undefined> => {
    const url = history.connection();
    if (url === undefined) return undefined;

    return await history.read(url, async (db) => {
      const one = runQuery(workflowId);
      const rows = await db.query<WorkflowStatusRow>(one.text, one.values);
      const row = rows[0];

      return row === undefined ? undefined : toRun(row);
    });
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
        // Which row the list marks is the open run's
        // answer, composed here rather than read by
        // the zone that draws the rows.
        selected: openRun.workflowId(),
        stack: stack.render(),
        ...testRun.render(),
        // Whether, not where: the address stays on
        // this side of `postMessage`.
        production: { configured: deps.host.conductorConsoleUrl() !== '' },
      };
    },

    see: openRun.see,
    detail: openRun.reading,
    live: testRun.live,

    refresh: async () => {
      await stack.read();
      testRun.refresh();
      await history.refresh();

      // Last, so that what is worth following is
      // composed from what the two zones have just
      // read rather than from what they held before.
      follow.rewatch();
    },

    // Only the list: which tab somebody is on says
    // nothing about the stack, and reading it would
    // shell out to compose on every click.
    setFilter: history.setFilter,
    select: openRun.open,
    refreshWorkflows: testRun.refreshWorkflows,
    selectStep: openRun.step,

    replay: async (functionId) => {
      // The list has a run in it now that was not
      // there a moment ago — which is the list's
      // business rather than the page's, so the two
      // are composed here.
      if (await openRun.replay(functionId)) await history.refresh();
    },

    stackUp: () => stacking(stack.up),
    stackDown: () => stacking(stack.down),
    stackRebuild: () => stacking(stack.rebuild),

    selectWorkflow: testRun.selectWorkflow,
    runWorkflow: testRun.runWorkflow,
    rerun: testRun.rerun,
    askAgent: testRun.askAgent,
    copyRunId: (workflowId) => deps.host.copy(workflowId),

    openWorkflow: async (workflowId) => {
      const dir = project();
      if (dir === undefined) return;

      const found = await runById(workflowId);
      if (found === undefined) return;

      const saved = projectWorkflows(dir).find(
        (one) => one.name === found.name,
      );

      if (saved === undefined) {
        return void deps.host.say(messages.runNoDocument(found.name));
      }

      await deps.host.openCanvas(saved.path);
    },

    /**
     * The block is looked up in the document as it
     * is saved now rather than in the drawing the
     * page was laid out from: somebody following a
     * block to its code wants the function it runs
     * today, and a block the document no longer has
     * has no code to go to.
     *
     * Both this and the canvas end up in the same
     * place, because where a function lives is the
     * code-behind's answer and there is one of
     * those per project.
     */
    openFunction: async (workflowId, nodeId) => {
      const dir = project();
      if (dir === undefined) return;

      // Reading the code-behind type-checks every
      // file in it and caches what it found inside
      // the project, so it is asked here as well as
      // at the ledger rather than left to the read
      // that happens to come first.
      if (!deps.trust.isTrusted()) return;

      const found = await runById(workflowId);
      if (found === undefined) return;

      const document = workflowDocument(dir, found.name);
      const node = document?.nodes.find((one) => one.id === nodeId);
      if (node === undefined) return;

      // Asked only once there is a block to open,
      // because the answer costs a type-check of
      // every file in the project.
      const manifest = manifestFor(dir);
      if (manifest === undefined) return;

      const unknown = await openHandler(deps.host, dir, manifest, node);

      if (unknown !== undefined) {
        deps.host.say(messages.openFunctionUnknown(unknown));
      }
    },

    // Whatever the setting holds, unchanged: it is
    // somebody's own console and this has no opinion
    // about its shape. Empty is every window that
    // never bought one, and there the door does
    // nothing rather than apologising.
    openProduction: async () => {
      const url = deps.host.conductorConsoleUrl();
      if (url === '') return;

      await deps.host.openExternal(url);
    },

    selectNode: openRun.node,
    showTab: openRun.tab,
    showRaw: openRun.raw,
    refreshRun: openRun.again,

    onChanged: changes.on,

    dispose: () => {
      for (const subscription of followed) subscription.dispose();
      // Before the zones, so nothing is still being
      // told about a run while it is being taken
      // apart.
      follow.dispose();
      history.dispose();
      openRun.dispose();
      stack.dispose();
      testRun.dispose();
      changes.dispose();
    },
  };
}
