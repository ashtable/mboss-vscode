import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import { messages } from '../messages.js';
import type { RunsInit } from '../webview/protocol.js';

import type { Database, OpenDatabase } from './db.js';
import { describeDatabase, systemDatabaseUrl } from './env.js';
import { detailOf } from './failure.js';
import { MAX_RUNS, countsQuery, runsQuery, type RunFilter } from './queries.js';
import {
  toCounts,
  toRun,
  type CountsRow,
  type Run,
  type RunCounts,
  type WorkflowStatusRow,
} from './rows.js';
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
};

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

  return {
    ledger,
    connection,
    read,
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
      rows: runs.map(rowOf),
    }),

    onChanged: changes.on,
    dispose: changes.dispose,
  };
}
