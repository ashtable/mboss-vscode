import { basename } from 'node:path';

import type { Disposable } from 'vscode';

import type { Agent } from '../acp/agent.js';
import { compileInputs, manifestFor } from '../core/index.js';
import type { WorkflowIR } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import type { Trust } from '../trust.js';
import type {
  InspectorMode,
  RunsInit,
  SeeInit,
  ShownRun,
} from '../webview/protocol.js';

import type { OpenDatabase, OpenManagement } from './db.js';
import type { AskAgent } from './evidence.js';
import { following } from './following.js';
import { changedFiles } from './freshness.js';
import type { ProjectSdk } from './sdk.js';
import { runHistory } from './history.js';
import { projectLedger } from './ledger.js';
import { openRunZone } from './openRun.js';
import { queueEvidenceOf, type QueueEvidence } from './queueEvidence.js';
import type { RunFilter } from './queries.js';
import {
  offerReplay,
  replayStartRefusal,
  type ReplayAnswer,
  type ReplayDeps,
  type ReplayPick,
  type ReplayQuestion,
} from './replayZone.js';
import type { RunInput } from './rows.js';
import type { RunStarter } from './runner.js';
import type { SessionLog } from './sessionLog.js';
import type { StackController } from './stack.js';
import { stackZone } from './stackZone.js';
import { testRunZone } from './testRun.js';
import { runTabOf, type RunTab, type SeeView } from './view.js';

import { printedInput, type LiveRun, type RunWatch } from './watch.js';
import { projectWorkflows, savedDocument } from './workflows.js';
import { runsWords } from './words.js';

export type { StackAction } from './stack.js';
export type { ReplayPick } from './replayZone.js';

/**
 * Where DBOS documents Conductor, for a window with
 * no console of its own to open.
 *
 * A constant rather than a setting: it is the
 * vendor's page about the product, the same for
 * every project, and nobody's own address.
 */
export const CONDUCTOR_DOCS_URL = 'https://docs.dbos.dev/production/conductor';

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
 * Five things are held, and they share almost
 * nothing: the project's ledger as this window
 * reads it, the page of run history read out of it,
 * the run somebody has open, the local stack as
 * compose reports it, and what this window set
 * going. Each is a module of its own with its own
 * slots and its own change signal — `ledger.ts`,
 * `history.ts`, `openRun.ts`, `stackZone.ts`,
 * `testRun.ts` — and this is where they are
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

  /** The language the editor is displayed in, for
   *  the dates the list writes. */
  locale(): string;

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
   * Puts some text in front of somebody, in an
   * editor tab of its own.
   *
   * Untitled and unsaved, which is the point: what
   * goes through here is a copy of something a run
   * recorded, and a buffer with nowhere to be saved
   * to cannot be written back over the ledger it
   * came from.
   */
  showText(content: string, language: string): Promise<void>;

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

  /** Puts the agent panel where somebody can see
   *  it. A question handed over in a view nobody is
   *  looking at is a question nobody was asked. */
  revealAgent(): Promise<void>;

  /**
   * Puts a question in front of somebody and waits
   * for the answer.
   *
   * A modal rather than anything a panel draws: a
   * replay writes into somebody's run history and
   * sets code running, and the two lists it is
   * decided on have to be read before the click,
   * not after it. One verb for all three doors, and
   * the quick pick behind `Choose…` is inside it —
   * so the editor is asked once however the
   * question was reached.
   */
  confirm(question: ReplayQuestion): Promise<ReplayAnswer>;
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

  /**
   * The open run as the Inspector reads it, projected
   * once at the moment the pane passed, with what
   * only the store holds put on: the queue reads and
   * whether this window cancelled it.
   */
  tab(now: number): RunTab | undefined;

  /** The run a canvas draws itself against, when
   *  one has been followed. */
  live(): ShownRun | undefined;

  /**
   * Why a run of that workflow could not be
   * replayed from its start, asked of the document
   * whoever is drawing holds; nothing where it
   * could be.
   *
   * Only what needs no row — the document, the
   * project's lockfile and its SDK — so it can be
   * said before anybody asks. The click still decides
   * the replay in full.
   */
  replayStartRefusal(
    workflow: string,
    document: WorkflowIR | undefined,
  ): string | undefined;

  /** Whether this window is what cancelled that run:
   *  remembered for as long as the window is open,
   *  because no column records who cancelled one. */
  cancelledHere(workflowId: string): boolean;

  /**
   * Reads what one queue block of that run is doing
   * beyond the run's own share of it.
   *
   * Asked once, when somebody opens the block's
   * card. Held here rather than in either zone
   * because one read answers both surfaces that
   * draw that card — the canvas' column and the run
   * page's rail — and reading it twice would be two
   * answers to one question.
   */
  inspectQueue(workflowId: string, nodeId: string): Promise<void>;

  /** The whole of what one of that run's rows
   *  recorded, for a panel that was sent only the
   *  front of it. */
  output(workflowId: string, functionId: number): string | undefined;

  /** Which way out each decided block of that run
   *  took, read against the document whoever is
   *  drawing hands in. */
  decided(ir: WorkflowIR): ReadonlyMap<string, string>;

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

  /**
   * Marks a row of the list, which the view opens
   * out to show its actions. Nothing is opened: the
   * list is the only thing that moves its own mark.
   */
  selectRow(workflowId: string): void;

  /**
   * Opens a run in its tab.
   *
   * Asked by every surface that means "show me this
   * run" — the run tab's own ids, the Inspector, the
   * transcript, the list's Open on canvas — and none
   * of them moves the row the list has marked.
   */
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

  /**
   * Offers a replay of one run from one of its
   * points, and makes it if somebody says yes.
   *
   * By run id and a pick rather than by a step,
   * because three surfaces reach this and only one
   * of them has a row in front of it: the canvas
   * names a block, the run page names a row, and the
   * list names neither.
   */
  replay(workflowId: string, picked: ReplayPick): Promise<void>;

  /**
   * The same, from the list: from the step the list
   * says the run failed at, or from its start.
   *
   * A pick of neither is the run's own default —
   * where it failed, else where it began. A step
   * named that is no place to start is answered
   * with why, and where to go instead, rather than
   * with a replay from somewhere else.
   */
  replayRun(workflowId: string, picked?: ReplayPick): Promise<void>;

  /**
   * Stops a run, and picks a stopped one back up.
   *
   * By id, because two surfaces reach these and
   * neither is necessarily the run page: the list
   * names the run it has opened out, and the page
   * names the one it is showing.
   */
  cancel(workflowId: string): Promise<void>;

  resume(workflowId: string): Promise<void>;

  stackUp(): Promise<void>;
  stackDown(): Promise<void>;
  stackRebuild(): Promise<void>;

  /** Which saved workflow the test-run zone's
   *  picker has open, so the hint beside the input
   *  box is about the right one. */
  selectWorkflow(workflow: string): void;

  /** What the Runs view's input box now says: the
   *  one input every start reads. */
  setInput(text: string): void;

  /** Starts one run of a saved workflow, with what
   *  the input box holds. */
  runWorkflow(workflow: string): Promise<void>;

  /**
   * Starts a run of the workflow a trigger's card
   * is about, with what the input box holds.
   *
   * The Runs view is set to that workflow first, so
   * the run it starts and any refusal are drawn
   * against the workflow that was asked for, not
   * whichever the view happened to be set to. A
   * window nobody has trusted runs nothing, and its
   * view is left where it was.
   */
  runTrigger(workflow: string): Promise<void>;

  /**
   * Opens what the input box holds in a tab of its
   * own, where a long input can be read whole.
   *
   * Untitled, like every copy opened from here: the
   * box is still where the input is typed. An empty
   * box has nothing to open.
   */
  openRunInput(): Promise<void>;

  /**
   * Hands a run to the agent, with whatever can be
   * read about it.
   *
   * Any run the ledger has. The block or the row
   * travels where the surface that asked had one in
   * front of somebody, because a question asked
   * from a card is a question about that card.
   */
  askAgent(ask: AskAgent): Promise<void>;

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
   * Opens the whole of what a run was started with.
   *
   * The run the canvas follows or the one the run
   * tab has open, whichever that id is: a card draws
   * only the front of a long input, and the only
   * place the rest is in hand is the run it was
   * read from. A run that recorded no input has
   * nothing to open.
   */
  openInput(workflowId: string): Promise<void>;

  /**
   * Opens the Conductor console for what this
   * project deploys.
   *
   * Nothing at all in a window with no console
   * configured, which is every window until somebody
   * buys one — the local loop is whole without it.
   */
  openProduction(): Promise<void>;

  /** Opens where DBOS documents Conductor, for
   *  whoever has no console to open. */
  learnConductor(): Promise<void>;

  /** The run page: which block, which view, and
   *  reading it again. */
  selectNode(nodeId: string | null): void;

  /** Which of the Inspector's faces a person picked
   *  for the block picked on the run page. */
  chooseFace(mode: InspectorMode): void;

  showTab(tab: 'graph' | 'trace'): void;

  refreshRun(): Promise<void>;

  onChanged(listener: () => void): Disposable;

  /** Fires when the input box's text changes, apart
   *  from `onChanged`, so the list is not drawn
   *  again for a keystroke. */
  onInputChanged(listener: () => void): Disposable;
};

export function runsStore(deps: RunsDeps): RunsStore {
  /**
   * The project's database, as every zone that
   * reads one reads it.
   *
   * Built first because it depends on nothing and
   * everything that reads a run depends on it: the
   * list reads its page through this, the run page
   * reads the run it is showing, the replay and the
   * two controls write to the address it gives out,
   * and a watch takes that address to open one of
   * its own.
   */
  const ledger = projectLedger({
    host: deps.host,
    trust: deps.trust,
    open: deps.open,
  });

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
    // Quietly: a project with no connection string
    // is a reason not to arm a watch, and no reason
    // for the list to change what it says.
    ledger: () => ledger.quietly()?.url,
    document: (name) => {
      const dir = project();

      return dir === undefined ? undefined : savedDocument(dir, name);
    },
    // Kept by id rather than as a set of rows: the
    // same run can be both the one a person has
    // open and one this session started, and two
    // rows saying so are one run.
    unsettled: () => [
      ...new Map(
        [...testRun.unsettled(), ...openRun.unsettled()].map((run) => [
          run.workflowId,
          run,
        ]),
      ).values(),
    ],
  });

  const history = runHistory({
    host: deps.host,
    trust: deps.trust,
    ledger,
    openManagement: deps.openManagement,
    projectSdk: deps.projectSdk,
  });

  // The run page reads the same ledger as the list,
  // loudly: what a read learns about somebody's
  // database is a fact about the project rather than
  // about the run being read, and it lands under the
  // list whoever asked for it.
  const openRun = openRunZone({
    projectSdk: deps.projectSdk,
    following: follow,
    project: () => deps.host.projects()[0],
    ledger,
    // Asked as the page is drawn rather than as the
    // run is read, so a run cancelled from here
    // while it is open says so without a re-read.
    cancelledHere: (workflowId) => history.cancelledHere().has(workflowId),
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
    open: deps.open,
    // Quietly, and a connection of its own: asking
    // the agent about a run is no reason for the
    // list to change what it says.
    ledger: ledger.quietly,
    document: (name) => {
      const dir = project();

      return dir === undefined ? undefined : savedDocument(dir, name);
    },
    // The scan type-checks every file in `lib/` and
    // caches what it found on a source hash, which
    // is why it is asked only behind trust.
    manifest: () => {
      const dir = project();

      return dir === undefined || !deps.trust.isTrusted()
        ? undefined
        : manifestFor(dir);
    },
  });

  // One signal for the five, since every reader
  // draws all of them at once.
  const changes = emitter();
  const followed = [ledger, history, openRun, stack, testRun].map((zone) =>
    zone.onChanged(changes.fire),
  );

  /**
   * Where each run this window set going last got
   * to, as its watch reported it.
   *
   * The list is read on request, and a run somebody
   * has just started, forked or picked back up is
   * one they are looking for: the first report
   * about it reads the list under All with that run
   * marked. Later reports read it again only when
   * the status or the word moved, because a watch
   * ticks twice a second whether anything changed
   * or not — and a resumed run sits enqueued until a
   * worker claims it, which no other read would
   * show. A run somebody merely opened is followed
   * too, and is not this window's to put first.
   */
  const lastReported = new Map<string, string>();
  const reported = follow.onRun((run) => {
    if (deps.sessionLog.find(run.workflowId) === undefined) return;

    const now = `${run.status} ${run.outcome}`;
    const before = lastReported.get(run.workflowId);
    lastReported.set(run.workflowId, now);

    if (before === undefined) void history.started(run.workflowId);
    else if (before !== now) void history.refresh();
  });

  const project = (): string | undefined => deps.host.projects()[0];

  /**
   * What has been read about a queue block, under
   * the run it was read about.
   *
   * Window memory and nothing more: it is a picture
   * of somebody else's database at the moment they
   * asked, and a run read again is read again.
   */
  const queueEvidence = new Map<string, Record<string, QueueEvidence>>();

  /** The run a view draws, with whatever was read
   *  about the queue blocks of it. */
  const withQueues = (run: LiveRun): ShownRun => {
    const found = queueEvidence.get(run.workflowId);

    return found === undefined ? run : { ...run, queueEvidence: found };
  };

  const shownRun = (run: LiveRun | undefined): ShownRun | undefined =>
    run === undefined ? undefined : withQueues(run);

  /**
   * The run one of those ids is about, whichever
   * surface is asking.
   *
   * The canvas draws the run this session started
   * and the run page draws the one somebody opened,
   * and they need not be the same run — so both
   * zones are asked, and an id neither of them
   * holds is a question about a run this window is
   * not showing.
   */
  const runNamed = (
    workflowId: string,
  ): { workflowId: string; workflow: string } | undefined => {
    const started = testRun.live();

    if (started?.workflowId === workflowId) {
      return { workflowId, workflow: started.workflow };
    }

    const opened = openRun.reading()?.run;

    return opened?.workflowId === workflowId
      ? { workflowId, workflow: opened.name }
      : undefined;
  };

  /**
   * What the run behind one of those ids was started
   * with, as the ledger recorded it — the same two
   * zones asked, for the same reason.
   */
  const inputOf = (workflowId: string): RunInput | undefined => {
    const started = testRun.live();

    if (started?.workflowId === workflowId) return started.recordedInput;

    const opened = openRun.reading()?.run;

    return opened?.workflowId === workflowId ? opened.input : undefined;
  };

  /**
   * Whether the list has had its first read: the
   * stack asked, then the ledger.
   *
   * Until then the view draws its header alone,
   * because every other state is a claim about
   * something read and would be replaced a moment
   * later. Held here rather than by the ledger,
   * because the run page reads the same ledger, and
   * a run opened before the list was shown is no
   * answer about the stack.
   */
  let loaded = false;

  /**
   * Everything read again once the stack has been
   * asked: the saved workflows, the list, and what
   * is worth following.
   *
   * The watch owner goes last, so that what is worth
   * following is composed from what the two zones
   * have just read rather than from what they held
   * before.
   *
   * The first of these reads says so again once it
   * is over. The read is what fires the change, and
   * it fired while the list still counted as unread,
   * so whoever drew on it drew the header and
   * nothing under it — and nothing would have asked
   * again. Only the first, because every later
   * refresh already ends on a page somebody can
   * draw, and after `rewatch()`, so the one extra
   * repaint carries the watch too.
   */
  const readAfterStack = async (): Promise<void> => {
    const first = !loaded;

    testRun.refresh();
    await history.refresh();
    loaded = true;
    follow.rewatch();

    if (first) changes.fire();
  };

  /**
   * A stack command, with the problem under the
   * input box let go of first — Rebuild is what one
   * of those problems asks for — and the reads a
   * refresh makes after it: a database that would
   * not answer is often the stack's own, and an app
   * rebuilt runs workflows the last read never saw.
   * The title bar's Start and Stop call these same
   * verbs.
   */
  const stacking = async (command: () => Promise<void>): Promise<void> => {
    testRun.clearProblem();
    await command();
    await readAfterStack();
  };

  /**
   * Everything deciding a replay reads and does,
   * assembled once.
   *
   * Once rather than per call because it is a bag of
   * closures over the zones, and every one of them
   * asks its question again when it is called — the
   * project, the connection and the stack are all
   * read fresh inside the decision rather than
   * captured here.
   */
  const replayDeps: ReplayDeps = {
    project,
    // The address, quietly: a fork writes through it
    // rather than reading from it, and the list says
    // why there is none the next time it is drawn.
    connection: () => ledger.quietly()?.url,
    openManagement: deps.openManagement,
    document: async (name) => {
      const dir = project();

      return dir === undefined ? undefined : savedDocument(dir, name);
    },
    compileInputs,
    projectSdk: deps.projectSdk,
    walk: changedFiles,
    stack,
    confirm: (question) => deps.host.confirm(question),
    follow: testRun.follow,
    refused: testRun.refused,
  };

  /**
   * One replay, whichever door it came through.
   *
   * The sentence goes to the notification area
   * always and onto the run page only when the page
   * is showing the run that was forked from — a
   * replay started from a canvas or from the list
   * says nothing about whatever else is open.
   */
  const replay = async (
    workflowId: string,
    picked?: ReplayPick,
  ): Promise<void> => {
    // Forking writes into the project's database and
    // sets code running, which is the decision
    // workspace trust exists to make.
    if (!deps.trust.isTrusted()) return;

    // Read again rather than taken from whatever the
    // page is showing: a replay is offered from the
    // list and from a canvas as well, and neither of
    // those has read a run's rows at all.
    const found = await ledger.rowsOf(workflowId);
    if (found === undefined) return;

    const outcome = await offerReplay(
      replayDeps,
      found.run,
      found.steps,
      picked,
    );

    // The one thing still on the table when a replay
    // is not: a fresh run of the same workflow, which
    // only a run this window started has the input
    // for.
    if (outcome.at === 'again') return await testRun.rerun(workflowId);

    if (outcome.note !== undefined) {
      deps.host.say(outcome.note);
      if (openRun.workflowId() === workflowId) openRun.note(outcome.note);
    }

    // The list has a run in it now that was not there
    // a moment ago.
    if (outcome.at === 'forked') await history.refresh();
  };

  return {
    list: () => {
      const dir = project();
      const said = ledger.render();

      return {
        type: 'init',
        view: 'runs',
        strings: runsWords(),
        project: dir === undefined ? undefined : basename(dir),
        ...said,
        ...history.render(),
        state: loaded ? said.state : 'loading',
        stack: stack.render(),
        ...testRun.render(),
        // Whether, not where: the address stays on
        // this side of `postMessage`.
        production: { configured: deps.host.conductorConsoleUrl() !== '' },
      };
    },

    /**
     * The page, with what was read about any queue
     * block of the run it is showing put back on
     * the run it draws.
     *
     * Composed here because the read is the
     * store's and the projection is the zone's, and
     * the zone that owns the page never asked the
     * question.
     */
    see: () => {
      const page = openRun.see();
      const run = page.run;

      return run?.live === undefined
        ? page
        : { ...page, run: { ...run, live: shownRun(run.live) } };
    },

    detail: openRun.reading,

    // Projected again from the rows the page holds
    // rather than kept beside them: a tick replaces
    // those rows, and a copy made at the last click
    // would be a run from a moment ago. "by you" is
    // asked here as the page asks it, so a run
    // cancelled from here says so without a re-read.
    tab: (now) => {
      const view = openRun.reading();
      if (view === undefined) return undefined;

      const tab = runTabOf(
        {
          ...view,
          cancelledHere: history.cancelledHere().has(view.run.workflowId),
        },
        now,
      );

      return { ...tab, inspected: withQueues(tab.inspected) };
    },

    live: () => shownRun(testRun.live()),

    replayStartRefusal: (workflow, document) =>
      replayStartRefusal(workflow, project(), document, deps.projectSdk)
        ?.detail,

    cancelledHere: (workflowId) => history.cancelledHere().has(workflowId),

    /**
     * One read, kept under the run it was about.
     *
     * Nothing is said when the block is not a queue
     * or the run is not one this window is showing:
     * a frame may ask about anything, and an answer
     * about a document this window does not have
     * would be an answer nobody could check.
     */
    inspectQueue: async (workflowId, nodeId) => {
      const url = ledger.quietly()?.url;
      const run = runNamed(workflowId);
      const dir = project();
      if (url === undefined || run === undefined || dir === undefined) return;

      const ir = savedDocument(dir, run.workflow);
      const node = ir?.nodes.find((one) => one.id === nodeId);
      if (node?.kind !== 'queue') return;

      let found: QueueEvidence;

      try {
        found = await queueEvidenceOf(deps.open, url, run, node);
      } catch {
        // A database that would not answer says
        // nothing here. The list is what reports on
        // somebody's database, and a card asking
        // about a queue is no reason for it to
        // change what it says.
        return;
      }

      queueEvidence.set(workflowId, {
        ...queueEvidence.get(workflowId),
        [nodeId]: found,
      });
      changes.fire();
    },
    output: testRun.output,
    decided: testRun.decided,

    refresh: async () => {
      await stack.read();
      await readAfterStack();
    },

    // Only the list: which tab somebody is on says
    // nothing about the stack, and reading it would
    // shell out to compose on every click.
    setFilter: history.setFilter,
    selectRow: history.selectRow,
    select: openRun.open,
    refreshWorkflows: testRun.refreshWorkflows,
    selectStep: openRun.step,

    replay,
    replayRun: (workflowId, picked) => replay(workflowId, picked),

    /**
     * Cancelling changes what is worth following:
     * the run's next tick reads `CANCELLED` and the
     * watch settles the row it left. Re-armed rather
     * than started, because a run already being
     * watched is one watch and stays one.
     */
    cancel: async (workflowId) => {
      await history.cancel(workflowId);
      follow.rewatch();
    },

    /**
     * And resuming puts the run back under its own
     * id, with a watch whose first tick reads
     * `ENQUEUED`, so the list marks it as it would
     * any run this window set going.
     */
    resume: async (workflowId) => {
      const done = await history.resume(workflowId);
      if (done.at !== 'asked') return;

      testRun.follow(done.run.workflowId, done.run.name, { via: 'resume' });
    },

    stackUp: () => stacking(stack.up),
    stackDown: () => stacking(stack.down),
    stackRebuild: () => stacking(stack.rebuild),

    selectWorkflow: testRun.selectWorkflow,
    setInput: testRun.setInput,
    runWorkflow: testRun.runWorkflow,

    runTrigger: async (workflow) => {
      // Asked here rather than left to the start,
      // which refuses quietly: moving the Runs view
      // to a workflow it will not run would be the
      // only mark a press in a window nobody has
      // trusted left.
      if (!deps.trust.isTrusted()) return;

      testRun.selectWorkflow(workflow);
      await testRun.runWorkflow(workflow);
    },

    openRunInput: async () => {
      const { input } = testRun.render().testRun;
      if (input.trim() === '') return;

      await deps.host.showText(input, 'json');
    },

    askAgent: testRun.askAgent,
    copyRunId: (workflowId) => deps.host.copy(workflowId),

    openWorkflow: async (workflowId) => {
      const dir = project();
      if (dir === undefined) return;

      const found = await ledger.runOf(workflowId);
      if (found === undefined) return;

      const saved = projectWorkflows(dir).find(
        (one) => one.name === found.name,
      );

      if (saved === undefined) {
        return void deps.host.say(messages.runNoDocument(found.name));
      }

      await deps.host.openCanvas(saved.path);
    },

    // Untitled, and JSON however it was stored: the
    // tab is a copy of what the ledger holds, and a
    // copy with nowhere to be saved cannot be
    // written back over it.
    openInput: async (workflowId) => {
      const printed = printedInput(inputOf(workflowId));
      if (printed === undefined) return;

      await deps.host.showText(printed, 'json');
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

    // Asked in any window: a page of documentation
    // reads nothing of the folder and runs nothing
    // in it.
    learnConductor: () => deps.host.openExternal(CONDUCTOR_DOCS_URL),

    selectNode: openRun.node,
    chooseFace: openRun.face,
    showTab: openRun.tab,
    refreshRun: openRun.again,

    onChanged: changes.on,
    onInputChanged: testRun.onInputChanged,

    dispose: () => {
      for (const subscription of followed) subscription.dispose();
      reported.dispose();
      // Before the zones, so nothing is still being
      // told about a run while it is being taken
      // apart.
      follow.dispose();
      ledger.dispose();
      history.dispose();
      openRun.dispose();
      stack.dispose();
      testRun.dispose();
      changes.dispose();
    },
  };
}
