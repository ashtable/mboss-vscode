import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import { messages } from '../messages.js';
import type { RunsInit } from '../webview/protocol.js';

import type { OpenManagement } from './db.js';
import { detailOf } from './failure.js';
import type { Ledger } from './ledger.js';
import {
  FINISHED,
  cancelRun,
  resumeRun,
  type Cancel,
  type ManagementClient,
  type Resume,
} from './manage.js';
import { MAX_RUNS, countsQuery, runsQuery, type RunFilter } from './queries.js';
import {
  toCounts,
  toRun,
  type CountsRow,
  type Run,
  type RunCounts,
  type WorkflowStatusRow,
} from './rows.js';
import { EXTENSION_SDK, sdkSkew, type ProjectSdk } from './sdk.js';
import { rowOf } from './view.js';

/**
 * A project's run history, as the window holds it.
 *
 * One page of the ledger: the rows the list draws
 * and the three counts above them. Whether that
 * ledger can be read at all is `ledger.ts`'s to say
 * and `ledger.ts`'s to draw — this used to own the
 * connection and lend it out, which made "the
 * database refused" a member of the zone that draws
 * a page of rows and left the run page borrowing
 * one.
 *
 * Nothing is read on a schedule. A database is
 * somebody else's, and an editor polling one all
 * afternoon to notice a run that finished is a cost
 * the person did not ask for — so the list is read
 * when it is shown, when the filter changes, and
 * when somebody asks for it again.
 *
 * The two controls a person has over a run live
 * here too, and by id. Running Now names the run
 * this window is watching and a session row names
 * one it started, and neither of those is
 * necessarily the run the run page has open — so
 * the zone that owns the list, which every one of
 * those surfaces is drawn beside, is where they
 * belong.
 *
 * So does the row the list has marked. It is the
 * list's own and not the run somebody has open in
 * its tab, which other surfaces open too: only the
 * list moves it, and it is settled inside every
 * read, because a read is what can take the marked
 * run off the page.
 */

/** The slice of the editor the history needs. */
export type HistoryHost = {
  projects(): string[];
  say(message: string): void;

  /** The language the editor is displayed in,
   *  which is the one the list names a day in. */
  locale(): string;
};

/**
 * The ledger, as the list reads it.
 *
 * Four of its verbs and not its own zone: what the
 * database last said is drawn beside this page
 * rather than by it, and the signal that says so is
 * the ledger's to fire.
 */
export type ListLedger = Pick<
  Ledger,
  'quietly' | 'read' | 'runOf' | 'answered'
>;

export type HistoryDeps = {
  host: HistoryHost;
  trust: Trust;
  ledger: ListLedger;

  /** The one door the two controls write through.
   *  Opened per control and closed by the adapter
   *  that used it. */
  openManagement: OpenManagement;

  /** Which DBOS the project runs, so a client newer
   *  than it never gets to ask for a member the
   *  project never wrote. */
  projectSdk: (project: string) => ProjectSdk;
};

/**
 * What a control did, for whoever has to act on it
 * afterwards.
 *
 * The run is the row as it read *after* the call, so
 * that whoever follows it follows what the ledger
 * says rather than what was asked for. `nothing`
 * covers every way the request did not go out — no
 * project, no trust, an SDK the client is ahead of,
 * a run nobody has, a database that refused — each
 * of which has already said whatever there was to
 * say.
 */
export type Controlled = { at: 'asked'; run: Run } | { at: 'nothing' };

/** What the list draws of the history. */
export type HistoryZone = Pick<
  RunsInit,
  'filter' | 'counts' | 'rows' | 'selected'
>;

export type History = Disposable & {
  /** Stops a run, and says what the row said
   *  afterwards. */
  cancel(workflowId: string): Promise<Controlled>;

  /** Picks a stopped one back up, and says the
   *  same. */
  resume(workflowId: string): Promise<Controlled>;

  /**
   * The runs this window is what cancelled.
   *
   * The only evidence there is for "by you": no
   * column records who cancelled a run. Window
   * memory, nothing written down, gone when the
   * window closes.
   */
  cancelledHere(): ReadonlySet<string>;

  /** The list, read again. */
  refresh(): Promise<void>;

  setFilter(filter: RunFilter): Promise<void>;

  /**
   * Marks a row of the list, which the view opens
   * out; nothing is read and nothing is opened.
   *
   * An id the page does not hold marks the newest
   * run instead, as a read that dropped it would.
   */
  selectRow(workflowId: string): void;

  /**
   * The list read again for a run this window has
   * just set going, under All and with that run
   * marked.
   *
   * All, because a run started while the list shows
   * Failed is not on that page, and the person who
   * started it is the one looking for it.
   */
  started(workflowId: string): Promise<void>;

  render(): HistoryZone;

  onChanged(listener: () => void): Disposable;
};

const EMPTY: RunCounts = { all: 0, active: 0, failed: 0 };

/** One page of the ledger: the rows and the three
 *  counts above them, read together. */
type Page = { runs: Run[]; counts: RunCounts };

export function runHistory(deps: HistoryDeps): History {
  const changes = emitter();

  let filter: RunFilter = 'all';
  let runs: Run[] = [];
  let counts: RunCounts = EMPTY;
  let selected: string | undefined;

  /** The ids this window asked to cancel and then
   *  read back as cancelled. Nothing is persisted;
   *  this goes with the window. */
  const cancelledHere = new Set<string>();

  const changed = changes.fire;

  const project = (): string | undefined => deps.host.projects()[0];

  /** The marked run where the page still holds it,
   *  else the newest, else none. */
  const settleSelection = (): void => {
    if (runs.some((run) => run.workflowId === selected)) return;

    selected = runs[0]?.workflowId;
  };

  /** A page, drawn from here on — or nothing, which
   *  is the empty page a read that did not happen
   *  leaves behind. */
  const land = (page: Page | undefined): void => {
    runs = page?.runs ?? [];
    counts = page?.counts ?? EMPTY;
    settleSelection();
  };

  /** Which list read is the newest. A read takes
   *  this number as it starts and lands only while
   *  it still holds it. */
  let latestRead = 0;

  /**
   * The page, read again.
   *
   * What was drawn stays until the new page is in
   * hand. The list is read again while a run this
   * window started moves, and the rest of the window
   * draws in the meantime; a page emptied for the
   * length of every read would blink, and a row
   * picked meanwhile would be checked against
   * nothing.
   *
   * Two of these can be in flight at once — a tab
   * changed while the first is still reading, or a
   * run this window started reading the list again
   * — so a read that is no longer the newest is
   * dropped where it lands. Left to land, it would
   * put back the page somebody has already moved on
   * from, and settle the mark against that page.
   *
   * What the read learned about the database itself
   * lands whenever it lands. The ledger writes that
   * sentence, and the run page reads the same
   * ledger, so the list is not the only asker: a
   * refusal is a fact about somebody's database
   * rather than about the page that happened to ask
   * for it, and ordering the list's alone would
   * leave the two askers contradicting each other.
   *
   * Which is why a page that was read lands inside
   * the read rather than after it. The ledger says
   * the database answered as the read returns, and
   * whoever that wakes draws both zones at once: a
   * page landed afterwards would be drawn as an
   * answering database with the rows from before it
   * answered — none, for a database that had been
   * refusing, which is the card saying the project
   * has never run anything.
   */
  const readRuns = async (): Promise<void> => {
    latestRead += 1;
    const mine = latestRead;

    const page = await deps.ledger.read(async (db) => {
      const list = runsQuery(filter, MAX_RUNS);
      const totals = countsQuery();

      const read: Page = {
        runs: (await db.query<WorkflowStatusRow>(list.text, list.values)).map(
          toRun,
        ),
        counts: toCounts(
          (await db.query<CountsRow>(totals.text, totals.values))[0],
        ),
      };

      if (mine === latestRead) land(read);

      return read;
    });

    if (mine !== latestRead) return;

    // The two ways a read does not answer, both of
    // which empty the page. Neither of them draws a
    // row, so landing these after the ledger has
    // spoken costs nothing.
    if (page === undefined) land(undefined);

    changed();
  };

  /**
   * Everything a control has to be true before the
   * request goes out: a project, trust, an SDK the
   * client this extension ships is not ahead of, a
   * reachable ledger, and a run in it.
   *
   * Asked once for both verbs, because both write
   * into somebody else's database through the same
   * client and each of these is a reason not to.
   */
  const controllable = async (
    workflowId: string,
  ): Promise<{ url: string; run: Run } | undefined> => {
    const dir = project();
    if (dir === undefined || !deps.trust.isTrusted()) return undefined;

    const sdk = deps.projectSdk(dir);

    // A project with no lockfile is not refused here
    // the way a replay is. Both controls are one
    // `UPDATE` of columns `workflow_status` has
    // always had, where a fork copies rows between
    // tables and depends on which migrations the
    // project ran.
    if (sdk.ok) {
      const skew = sdkSkew(EXTENSION_SDK, sdk.version);

      if (skew !== 'ok') {
        deps.host.say(
          skew === 'extension-newer'
            ? messages.runControlSdkNewer(EXTENSION_SDK, sdk.version)
            : messages.runControlSdkMajor(EXTENSION_SDK, sdk.version),
        );

        return undefined;
      }
    }

    // Quietly, because a control writes through this
    // address rather than reading from it, and the
    // list says why there is none the next time it
    // is drawn.
    const url = deps.ledger.quietly()?.url;

    // A control has nothing to add to that sentence,
    // but the row it was clicked on is drawn again.
    if (url === undefined) {
      changed();

      return undefined;
    }

    const run = await deps.ledger.runOf(workflowId);

    if (run === undefined) {
      // A read that did not happen has already put
      // its own sentence under the list. This one is
      // about a run the ledger answered about and
      // does not have.
      if (deps.ledger.answered()) {
        deps.host.say(messages.runNotFound(workflowId));
      }

      changed();

      return undefined;
    }

    return { url, run };
  };

  /**
   * Opens a client, does the one thing that was
   * asked, closes it — and turns a client that would
   * not open into the same refusal a call that threw
   * gives, because to whoever clicked they are one
   * thing.
   */
  const managed = async <Answer extends Cancel | Resume>(
    url: string,
    take: (client: ManagementClient) => Promise<Answer>,
  ): Promise<Answer | { at: 'refused'; detail: string }> => {
    let client: ManagementClient;

    try {
      client = await deps.openManagement(url);
    } catch (cause) {
      return { at: 'refused', detail: detailOf(cause) };
    }

    // The adapter closes what it was handed, in a
    // `finally` of its own.
    return await take(client);
  };

  const cancel = async (workflowId: string): Promise<Controlled> => {
    const ready = await controllable(workflowId);
    if (ready === undefined) return { at: 'nothing' };

    const answer = await managed(ready.url, (client) =>
      cancelRun(client, ready.run),
    );

    if (answer.at === 'over') {
      deps.host.say(messages.runCancelOver(workflowId, answer.status));

      return { at: 'nothing' };
    }

    if (answer.at === 'refused') {
      deps.host.say(messages.runCancelRefused(answer.detail));

      return { at: 'nothing' };
    }

    // The statement reports nothing about itself and
    // cancelling is not an interrupt, so the row is
    // the only witness to what actually happened.
    const after = await deps.ledger.runOf(workflowId);

    if (after?.status === 'CANCELLED') {
      cancelledHere.add(workflowId);
      deps.host.say(messages.runCancelled(workflowId));
    } else if (after !== undefined && FINISHED.includes(after.status)) {
      deps.host.say(messages.runCancelOver(workflowId, after.status));
    } else {
      deps.host.say(messages.runCancelPending(workflowId));
    }

    // The row on the list says something else now,
    // and somebody clicking a control is somebody
    // asking.
    await readRuns();

    return after === undefined
      ? { at: 'nothing' }
      : { at: 'asked', run: after };
  };

  const resume = async (workflowId: string): Promise<Controlled> => {
    const ready = await controllable(workflowId);
    if (ready === undefined) return { at: 'nothing' };

    const answer = await managed(ready.url, (client) =>
      resumeRun(client, ready.run),
    );

    if (answer.at === 'over') {
      deps.host.say(messages.runResumeOver(workflowId, answer.status));

      return { at: 'nothing' };
    }

    if (answer.at === 'refused') {
      deps.host.say(messages.runResumeRefused(answer.detail));

      return { at: 'nothing' };
    }

    const after = await deps.ledger.runOf(workflowId);
    const run = after ?? ready.run;

    // Resume leaves the run's own version exactly
    // where it was and a worker dequeues only its
    // own, so a run picked back up under a version
    // the app has moved past sits enqueued for ever.
    deps.host.say(
      run.applicationVersion === undefined ||
        run.applicationVersion === answer.latest
        ? messages.runResumeStarted(workflowId, answer.latest)
        : messages.runResumeStartedOlder(
            workflowId,
            run.applicationVersion,
            answer.latest,
          ),
    );

    await readRuns();

    return { at: 'asked', run };
  };

  return {
    cancel,
    resume,
    cancelledHere: () => cancelledHere,
    refresh: readRuns,

    setFilter: async (next) => {
      filter = next;
      await readRuns();
    },

    selectRow: (workflowId) => {
      selected = workflowId;
      settleSelection();
      changed();
    },

    started: async (workflowId) => {
      filter = 'all';
      selected = workflowId;
      await readRuns();
    },

    render: () => {
      // One moment and one language for the whole
      // page, as the run page reads one clock: a
      // row asked about a different moment from the
      // row beside it could call the same sleep
      // over on one and not on the other.
      const now = Date.now();
      const locale = deps.host.locale();

      return {
        filter,
        counts,
        rows: runs.map((run) => rowOf(run, runs, now, locale)),
        selected,
      };
    },

    onChanged: changes.on,
    dispose: changes.dispose,
  };
}
