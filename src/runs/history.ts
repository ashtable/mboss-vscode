import type { Disposable } from 'vscode';

import { boxesFor } from '../core/index.js';
import { ownerOf } from '../core/rules.js';
import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import { messages } from '../messages.js';
import type { RunsInit } from '../webview/protocol.js';

import type { Database, OpenDatabase, OpenManagement } from './db.js';
import { describeDatabase, systemDatabaseUrl } from './env.js';
import { detailOf } from './failure.js';
import type { Following } from './following.js';
import {
  FAILED_STATUSES,
  MAX_RUNS,
  countsQuery,
  runQuery,
  runsQuery,
  stepsQuery,
  type RunFilter,
} from './queries.js';
import type { ManagementClient } from './manage.js';
import { replayFrom, type Replay } from './replay.js';
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
import type { ProjectSdk } from './sdk.js';
import { rowOf, type SeeView } from './view.js';
import { workflowDocument } from './workflows.js';

/**
 * A project's run history, as the window holds it.
 *
 * What the ledger says: the rows the list draws and
 * the three counts above them, the run somebody has
 * picked with its steps, and the note the last
 * replay left. Nothing is read on a schedule. A
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
  openManagement: OpenManagement;

  /** Which DBOS a project runs, so the run page
   *  knows whether the rows the wake lines are read
   *  off are recorded at all. */
  projectSdk: (project: string) => ProjectSdk;

  /** The one owner of every watch this window arms.
   *  This zone listens for the run it is showing;
   *  it polls nothing itself. */
  following: Following;
};

/** What the list draws of the history. */
export type HistoryZone = Pick<
  RunsInit,
  'state' | 'detail' | 'source' | 'filter' | 'counts' | 'rows' | 'selected'
>;

export type History = Disposable & {
  /** The connection string, quietly: nothing said
   *  and nothing changed when there is none. */
  ledger(): string | undefined;

  /** The run this zone is showing, when the ledger
   *  says it has not ended — for whoever composes
   *  what is worth following. */
  unsettled(): readonly string[];

  /** The list, read again. */
  refresh(): Promise<void>;

  setFilter(filter: RunFilter): Promise<void>;

  select(workflowId: string): Promise<void>;

  /** Which step the rail describes and a replay
   *  would fork from. */
  selectStep(functionId: number): void;

  /** Which block on the run's graph a person
   *  picked. */
  selectNode(nodeId: string): void;

  /** Which of the two views of the run is on
   *  screen. */
  show(tab: 'graph' | 'trace'): void;

  /** Whether the rows DBOS wrote for itself are
   *  shown. */
  showRaw(raw: boolean): void;

  /** Reads the shown run again and follows it if it
   *  is still going. One of the few things that
   *  arms a watch. */
  refreshRun(): Promise<void>;

  /** Which of the two views of the run is on
   *  screen, for the message the panel sends. */
  showing(): 'graph' | 'trace';

  replay(functionId: number): Promise<void>;

  /** The run somebody picked, with its steps. */
  detail(): SeeView | undefined;

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
  let selected: SeeView | undefined;
  let note: string | undefined;
  let showing: 'graph' | 'trace' = 'graph';

  const changed = changes.fire;

  const project = (): string | undefined => deps.host.projects()[0];

  /**
   * A tick about the run this tab is showing.
   *
   * One owner polls every followed run, so reports
   * about other runs arrive here too and are
   * ignored — repainting the tab with somebody
   * else's rows is exactly what the id check
   * prevents.
   */
  const reports = deps.following.onRun((run, read) => {
    if (selected?.run.workflowId !== run.workflowId) return;

    selected = {
      ...selected,
      run: read.run,
      steps: read.steps,
      following:
        run.outcome === 'running'
          ? 'following'
          : run.outcome === 'waiting'
            ? 'waiting'
            : 'quiet',
    };
    changed();
  });

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

  const select = async (workflowId: string): Promise<void> => {
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
      const before = selected?.run.workflowId;
      const again = before === workflowId;

      // A different run is a different question, so
      // the note about the last replay, the step
      // somebody had picked and the rows they had
      // shown all go. The same run read again is
      // the same question — Refresh, pressed while
      // reading a group two thirds down a trace,
      // must not put somebody back at the top.
      if (!again) note = undefined;

      // And the run being let go of is one this
      // window no longer has a reason to poll.
      if (before !== undefined && !again) deps.following.drop(before);

      selected =
        found === null
          ? undefined
          : await shownRun(found, again ? selected : undefined);
    }

    changed();
  };

  /**
   * A run, with the workflow it was a run of laid
   * out beside it — and followed, if it is still
   * going.
   *
   * The document is read off disk rather than
   * reconstructed from the run: the graph is a
   * picture of what is saved now, and the caption
   * says which revision that is. A workflow the
   * project no longer has leaves the trace and
   * drops the picture.
   *
   * `reading` is what a person had open when this
   * is the same run being read again, and nothing
   * when it is a different one.
   */
  const shownRun = async (
    found: { run: Run; steps: Step[] },
    reading?: SeeView,
  ): Promise<SeeView> => {
    const dir = project();
    const ir =
      dir === undefined ? undefined : workflowDocument(dir, found.run.name);

    // Only a run that is still going is worth
    // polling. One that has ended will not change
    // however long anybody watches it.
    // The row's own id rather than the one asked
    // for: they are the same in production, and the
    // row is the thing being followed.
    if (!finished(found.run)) deps.following.arm(found.run.workflowId);

    return {
      ...found,
      selectedStep: reading?.selectedStep ?? firstStep(found.steps),
      note,
      ...(ir === undefined ? {} : { ir, boxes: await boxesFor(ir) }),
      ...(reading?.selectedNode === undefined
        ? {}
        : { selectedNode: reading.selectedNode }),
      raw: reading?.raw ?? false,
      following: finished(found.run) ? 'quiet' : 'following',
      timing: dir !== undefined && recordsTimings(deps.projectSdk(dir)),
    };
  };

  return {
    ledger,
    refresh: readRuns,

    setFilter: async (next) => {
      filter = next;
      await readRuns();
    },

    select,

    selectStep: (functionId) => {
      if (selected === undefined) return;

      selected = { ...selected, selectedStep: functionId };
      changed();
    },

    selectNode: (nodeId) => {
      if (selected === undefined) return;

      // The two views of a run share one selection,
      // so picking a block also picks the first
      // operation that block recorded.
      const first = selected.steps.find((step) => {
        const owner = ownerOf(step.name);

        return owner.kind === 'node' && owner.nodeId === nodeId;
      });

      selected = {
        ...selected,
        selectedNode: nodeId,
        ...(first === undefined ? {} : { selectedStep: first.functionId }),
      };
      changed();
    },

    show: (tab) => {
      showing = tab;
      changed();
    },

    showing: () => showing,

    showRaw: (raw) => {
      if (selected === undefined) return;

      selected = { ...selected, raw };
      changed();
    },

    refreshRun: async () => {
      const showingId = selected?.run.workflowId;
      if (showingId === undefined) return;

      await select(showingId);
    },

    replay: async (functionId) => {
      const showing = selected;
      if (showing === undefined || !deps.trust.isTrusted()) return;

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

    unsettled: () => {
      const showing = selected?.run;

      return showing === undefined || finished(showing)
        ? []
        : [showing.workflowId];
    },

    detail: () => selected,

    render: () => ({
      state,
      detail,
      source:
        database === undefined ? undefined : messages.runsSource(database),
      filter,
      counts,
      rows: runs.map(rowOf),
      selected: selected?.run.workflowId,
    }),

    onChanged: changes.on,
    dispose: () => {
      reports.dispose();
      changes.dispose();
    },
  };
}

/**
 * The first SDK that records a wake deadline beside
 * a wait.
 *
 * Below it the rows the run page would read those
 * lines off are simply not there, so the lines are
 * not drawn — and a project a version behind is an
 * ordinary state of somebody's folder rather than
 * something to complain about.
 */
const RECORDS_TIMINGS = [4, 27, 6] as const;

function recordsTimings(sdk: ProjectSdk): boolean {
  if (!sdk.ok) return false;

  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(sdk.version);
  if (found === null) return false;

  const [major, minor, patch] = [
    Number(found[1]),
    Number(found[2]),
    Number(found[3]),
  ];

  if (major !== RECORDS_TIMINGS[0]) return major > RECORDS_TIMINGS[0];
  if (minor !== RECORDS_TIMINGS[1]) return minor > RECORDS_TIMINGS[1];

  return patch >= RECORDS_TIMINGS[2];
}

/** DBOS's own three, widened so a status read out
 *  of a row can be compared against them. */
const ENDED: readonly string[] = ['SUCCESS', ...FAILED_STATUSES];

/** Whether the ledger says this run is over. */
function finished(run: Run): boolean {
  return ENDED.includes(run.status);
}

/**
 * Opening the client is itself a connection, and a
 * database that is down refuses it before there is
 * anything to fork — so the failure has to become
 * the same sentence the fork's own would.
 */
async function forkedFrom(
  deps: HistoryDeps,
  url: string,
  run: Run,
  functionId: number,
): Promise<Replay> {
  let client: ManagementClient;

  try {
    client = await deps.openManagement(url);
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
