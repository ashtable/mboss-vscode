import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import type { Trust } from '../trust.js';
import type { RunsInit } from '../webview/protocol.js';

import type { Database, OpenDatabase } from './db.js';
import { describeDatabase, systemDatabaseUrl, type EnvName } from './env.js';
import { detailOf } from './failure.js';
import { runQuery, stepsQuery } from './queries.js';
import {
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';

/**
 * The project's DBOS system database, as this
 * window reads it.
 *
 * Where the connection string comes from, the one
 * open-read-close every question goes through, what
 * the database last said, and the reads by id more
 * than one surface makes. The list used to own all
 * of it and lend it out — the run page borrowed a
 * connection and a read, the replay borrowed a
 * connection, a watch borrowed the address — so
 * whether this project's ledger can be read at all
 * was a member of the zone that draws a page of
 * rows, and four other modules each spelled "one
 * run with every row it wrote" out for themselves.
 *
 * Loud and quiet. A read somebody asked for says
 * what it learned, because the Runs view draws that
 * sentence: the list's page, the run page, the read
 * a control makes before it writes. A read this
 * window made on its own account, or on the side of
 * a question about something else, says nothing — a
 * watch polling twice a second, the object handed
 * to an agent, the card about one queue block. What
 * a database refused to answer is a fact about the
 * project either way, but only the first kind is
 * something a person is waiting on. The quiet verb
 * says so in its name; the loud ones are plain.
 *
 * Nothing is held open. A connection kept for as
 * long as an editor window is a slot on somebody's
 * development database all day, so every read here
 * opens, reads and closes. A watch is the one
 * exception and holds its own: it takes the address
 * and a by-id read, which is why those reads are
 * plain functions over a `Database` rather than
 * verbs on this.
 */

/** The slice of the editor the ledger needs. */
export type LedgerHost = { projects(): string[] };

export type LedgerDeps = {
  host: LedgerHost;
  trust: Trust;
  open: OpenDatabase;
};

/**
 * Where this project's ledger is, and which name in
 * the `.env` said so.
 *
 * The name travels with the address because the
 * object handed to an agent names its own source,
 * and a project that gives DBOS a system database
 * of its own is a different answer from one that
 * points everything at `DATABASE_URL`.
 */
export type LedgerAddress = { url: string; from: EnvName };

/** One run and every row it wrote. */
export type RunRows = { run: Run; steps: Step[] };

/** What the view draws about the database itself. */
export type LedgerZone = Pick<RunsInit, 'state' | 'detail' | 'source'>;

export type Ledger = Disposable & {
  /**
   * The address, quietly: nothing said and nothing
   * changed when there is none.
   *
   * What whoever arms a watch takes, what the two
   * controls and the fork write through, and what
   * the reads made on the side of another question
   * open for themselves. A project with no
   * connection string is a reason not to arm a
   * watch, never a reason to replace the list
   * somebody is looking at with a sentence about
   * it.
   */
  quietly(): LedgerAddress | undefined;

  /**
   * Opens, reads, closes — and says what it learned
   * about the database while it was there.
   *
   * Nothing for a read that did not happen, which is
   * either kind: no connection to make, or a
   * database that would not answer. Both have
   * already become the sentence the view draws in
   * place of a list, so a caller has nothing to add
   * and is told only that there is no value.
   */
  read<Value>(
    take: (db: Database) => Promise<Value>,
  ): Promise<Value | undefined>;

  /** One run, by the id on its row. Loud. */
  runOf(workflowId: string): Promise<Run | undefined>;

  /** That run with every row it wrote. Loud. */
  rowsOf(workflowId: string): Promise<RunRows | undefined>;

  /**
   * Whether the last read reached the database.
   *
   * The difference between a run this ledger does
   * not have and a question it was never asked,
   * which is what stands between a person and a
   * sentence saying their run is not there.
   */
  answered(): boolean;

  render(): LedgerZone;

  /** Fires when what the database last said changed
   *  — not on every read. */
  onChanged(listener: () => void): Disposable;
};

/**
 * Where this project's ledger is, or which kind of
 * nowhere.
 *
 * One lookup for both verbs. The only difference
 * between them is whether the answer is written
 * down.
 */
type Address =
  | ({ ok: true } & LedgerAddress)
  | { ok: false; state: 'no-project' | 'untrusted' }
  | { ok: false; state: 'no-database'; detail: string };

export function projectLedger(deps: LedgerDeps): Ledger {
  const changes = emitter();

  let state: RunsInit['state'] = 'no-project';
  let detail: string | undefined;
  let database: string | undefined;

  const render = (): LedgerZone => ({
    state,
    detail,
    source: database === undefined ? undefined : messages.runsSource(database),
  });

  /**
   * What the database was last said to have said.
   *
   * Compared rather than fired on: a refresh that
   * finds the same database answering the same way
   * is not news, and whoever asked for that read is
   * redrawing anyway.
   */
  let told = render();

  const tell = (): void => {
    const now = render();

    if (
      now.state === told.state &&
      now.detail === told.detail &&
      now.source === told.source
    ) {
      return;
    }

    told = now;
    changes.fire();
  };

  const addressOf = (): Address => {
    const dir = deps.host.projects()[0];
    if (dir === undefined) return { ok: false, state: 'no-project' };
    if (!deps.trust.isTrusted()) return { ok: false, state: 'untrusted' };

    const found = systemDatabaseUrl(dir);

    // A file to fix. Starting the stack would not
    // write it, which is what sets this apart from
    // a database that would not answer.
    if (!found.ok) {
      return {
        ok: false,
        state: 'no-database',
        detail:
          found.because === 'no-env-file'
            ? messages.runsNoEnvFile(found.path)
            : messages.runsNoDatabaseUrl(found.path),
      };
    }

    return { ok: true, url: found.url, from: found.from };
  };

  /** The same lookup, written down — because a read
   *  nobody can make is what the panel shows in
   *  place of a list. */
  const loudly = (): string | undefined => {
    const at = addressOf();

    if (!at.ok) {
      state = at.state;
      if (at.state === 'no-database') detail = at.detail;

      return undefined;
    }

    database = describeDatabase(at.url);

    return at.url;
  };

  const read = async <Value>(
    take: (db: Database) => Promise<Value>,
  ): Promise<Value | undefined> => {
    const url = loudly();

    if (url === undefined) {
      tell();

      return undefined;
    }

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

      // After the read has landed, never before it.
      // Whoever asked is holding what they read by
      // the time this fires, so a follower woken by
      // it draws the two together. Fired as the read
      // answered, it would draw a database that is
      // answering beside the page from before it
      // did — which for a list that had none is the
      // card saying the project has no runs.
      tell();
    }
  };

  return {
    quietly: () => {
      const at = addressOf();

      return at.ok ? { url: at.url, from: at.from } : undefined;
    },

    read,
    runOf: (workflowId) => read((db) => runById(db, workflowId)),
    rowsOf: (workflowId) => read((db) => runRowsById(db, workflowId)),
    answered: () => state === 'ok',
    render,

    onChanged: changes.on,
    dispose: changes.dispose,
  };
}

/** One run of a ledger, by the id on its row. */
export async function runById(
  db: Database,
  workflowId: string,
): Promise<Run | undefined> {
  const one = runQuery(workflowId);
  const row = (await db.query<WorkflowStatusRow>(one.text, one.values))[0];

  return row === undefined ? undefined : toRun(row);
}

/**
 * That run and every row it wrote, in the order
 * DBOS numbered them.
 *
 * Nothing where the ledger has no such run — and
 * nothing said about connections either way, because
 * whoever asks has to tell a run that is not there
 * apart from a read that could not be made, and only
 * they know which sentence each one earns.
 */
export async function runRowsById(
  db: Database,
  workflowId: string,
): Promise<RunRows | undefined> {
  const run = await runById(db, workflowId);
  if (run === undefined) return undefined;

  const recorded = stepsQuery(workflowId);

  return {
    run,
    steps: (
      await db.query<OperationOutputRow>(recorded.text, recorded.values)
    ).map(toStep),
  };
}
