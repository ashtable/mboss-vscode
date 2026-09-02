import { basename } from 'node:path';

import type { Disposable } from 'vscode';

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
import type { RunsView, SeeView } from './view.js';

/**
 * What the window knows about a project's runs.
 *
 * Held by the extension rather than by either view,
 * the same way the transcript and the proposals
 * are: the list is a panel in the activity bar and
 * the detail is an editor tab, and neither may hold
 * state the other needs. Both read from here.
 *
 * Nothing is read on a schedule. A database is
 * somebody else's, and an editor polling one all
 * afternoon to notice a run that finished is a cost
 * the person did not ask for — so the list is read
 * when it is shown, when the filter changes, and
 * when somebody asks for it again.
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
};

export type RunsDeps = {
  host: RunsHost;

  open: OpenDatabase;

  openFork: OpenFork;
};

export type RunsStore = {
  /** What the list draws. */
  list(): RunsView;

  /** What the detail tab draws, when a run has been
   *  picked. */
  detail(): SeeView | undefined;

  refresh(): Promise<void>;

  setFilter(filter: RunFilter): Promise<void>;

  select(workflowId: string): Promise<void>;

  /** Which step the rail describes and a replay
   *  would fork from. */
  selectStep(functionId: number): void;

  replay(functionId: number): Promise<void>;

  onChanged(listener: () => void): Disposable;
};

const EMPTY: RunCounts = { all: 0, failed: 0, recovered: 0 };

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

  const refresh = async (): Promise<void> => {
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
    }),

    detail: () => selected,

    refresh,

    setFilter: async (next) => {
      filter = next;
      await refresh();
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
        const row = rows[0];

        if (row === undefined) return null;

        const steps = stepsQuery(workflowId);

        return {
          run: toRun(row),
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
      await refresh();
    },

    onChanged: (listener) => {
      listeners.add(listener);

      return { dispose: () => void listeners.delete(listener) };
    },
  };
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
