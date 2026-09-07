import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import { messages } from '../messages.js';
import type { RunsInit } from '../webview/protocol.js';

import type { Database, OpenDatabase, OpenManagement } from './db.js';
import { describeDatabase, systemDatabaseUrl } from './env.js';
import { detailOf } from './failure.js';
import {
  FINISHED,
  cancelRun,
  resumeRun,
  type Cancel,
  type ManagementClient,
  type Resume,
} from './manage.js';
import {
  MAX_RUNS,
  countsQuery,
  runQuery,
  runsQuery,
  type RunFilter,
} from './queries.js';
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
 * What the ledger says about the project: the rows
 * the list draws and the three counts above them.
 * The run somebody has open is a second question,
 * asked of the same ledger by `openRun.ts`, which
 * borrows the connection from here. Nothing is read
 * on a schedule. A
 * database is somebody else's, and an editor
 * polling one all afternoon to notice a run that
 * finished is a cost the person did not ask for —
 * so the list is read when it is shown, when the
 * filter changes, and when somebody asks for it
 * again.
 *
 * Whether the ledger can be read at all — no
 * project, no trust, no `.env`, no `DATABASE_URL`,
 * a database that will not answer — is this
 * module's state and this module's sentence. The
 * connection string is also offered quietly, to
 * whoever arms a watch on a run: a project with no
 * connection string is a reason not to arm one,
 * never a reason to replace the list somebody is
 * looking at with a sentence about it.
 *
 * The two controls a person has over a run live here
 * too, and by id. Running Now names the run this
 * window is watching and a session row names one it
 * started, and neither of those is necessarily the
 * run the run page has open — so the zone that owns
 * the list, and the by-id read every caller already
 * goes through, is where they belong.
 */

/** The slice of the editor the history needs. */
export type HistoryHost = {
  projects(): string[];
  say(message: string): void;
};

export type HistoryDeps = {
  host: HistoryHost;
  trust: Trust;
  open: OpenDatabase;

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
  'state' | 'detail' | 'source' | 'filter' | 'counts' | 'rows'
>;

export type History = Disposable & {
  /** The connection string, quietly: nothing said
   *  and nothing changed when there is none. This is
   *  what whoever arms a watch takes. */
  ledger(): string | undefined;

  /**
   * The connection string, and this zone told what
   * it learned about the database while answering.
   *
   * Lent to the run page, which reads the same
   * ledger: whether somebody's database can be
   * reached is a fact about the project rather than
   * about the run being read, and this is the zone
   * that says it.
   */
  connection(): string | undefined;

  /** Opens, reads, and closes again — noting whether
   *  the database answered. Lent for the same
   *  reason. */
  read<Value>(
    url: string,
    take: (db: Database) => Promise<Value>,
  ): Promise<Value | undefined>;

  /** One run of this project's ledger, by the id on
   *  its row. */
  runOf(workflowId: string): Promise<Run | undefined>;

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

  render(): HistoryZone;

  onChanged(listener: () => void): Disposable;
};

const EMPTY: RunCounts = { all: 0, failed: 0, recovered: 0 };

export function runHistory(deps: HistoryDeps): History {
  const changes = emitter();

  let filter: RunFilter = 'all';
  let state: RunsInit['state'] = 'no-project';
  let detail: string | undefined;
  let database: string | undefined;
  let runs: Run[] = [];
  let counts: RunCounts = EMPTY;

  /** The ids this window asked to cancel and then
   *  read back as cancelled. Nothing is persisted;
   *  this goes with the window. */
  const cancelledHere = new Set<string>();

  const changed = changes.fire;

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

    if (!deps.trust.isTrusted()) {
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

  const ledger = (): string | undefined => {
    const dir = project();
    if (dir === undefined || !deps.trust.isTrusted()) return undefined;

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

  const runOf = async (workflowId: string): Promise<Run | undefined> => {
    const url = connection();
    if (url === undefined) return undefined;

    return await read(url, async (db) => {
      const one = runQuery(workflowId);
      const row = (await db.query<WorkflowStatusRow>(one.text, one.values))[0];

      return row === undefined ? undefined : toRun(row);
    });
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

    const url = connection();

    // The list says why there is no connection the
    // next time it is drawn; a control has nothing
    // to add to that.
    if (url === undefined) {
      changed();

      return undefined;
    }

    const run = await runOf(workflowId);

    if (run === undefined) {
      // A read that did not happen has already put
      // its own sentence under the list. This one is
      // about a run the ledger answered about and
      // does not have.
      if (state === 'ok') deps.host.say(messages.runNotFound(workflowId));

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
    const after = await runOf(workflowId);

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

    const after = await runOf(workflowId);
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
    ledger,
    connection,
    read,
    runOf,
    cancel,
    resume,
    cancelledHere: () => cancelledHere,
    refresh: readRuns,

    setFilter: async (next) => {
      filter = next;
      await readRuns();
    },

    render: () => ({
      state,
      detail,
      source:
        database === undefined ? undefined : messages.runsSource(database),
      filter,
      counts,
      rows: runs.map((run) => rowOf(run, runs)),
    }),

    onChanged: changes.on,
    dispose: changes.dispose,
  };
}
