import { describe, expect, it, vi } from 'vitest';

import { fakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import { messages } from '../messages.js';
import {
  RUN_ROW,
  database,
  host,
  management,
  project,
  stack,
  watcher,
} from '../test-support/runs.js';

import type { Database, OpenDatabase, OpenManagement } from './db.js';
import { runHistory, type History, type HistoryDeps } from './history.js';
import type { ManagementClient } from './manage.js';
import { sessionLog } from './sessionLog.js';
import { runsStore } from './store.js';

/**
 * A project's run history, read out of its own
 * Postgres.
 *
 * Driven against a database double that answers the
 * two queries the list makes, so what is checked is
 * what the list asks, what it keeps, and what it
 * says when it cannot ask at all. The run somebody
 * has open is a second question asked of the same
 * ledger, and has its own spec beside this one.
 */

function history(over: Partial<HistoryDeps> = {}): History {
  return runHistory({
    host: host(),
    trust: fakeTrust(),
    open: async () => database(),
    openManagement: async () => management(),
    projectSdk: () => ({ ok: true, version: '4.27.6' }),
    ...over,
  });
}

/** A history over a project, reading that
 *  database. */
function reading(db: Database, over: Partial<HistoryDeps> = {}): History {
  return history({
    host: host({ projects: () => [project()] }),
    open: async () => db,
    ...over,
  });
}

describe('before there is anything to read', () => {
  it('opens nothing in a window with no project', async () => {
    const open = vi.fn();
    const read = history({
      host: host(),
      open: open as unknown as OpenDatabase,
    });

    await read.refresh();

    expect(read.render().state).toBe('no-project');
    expect(open).not.toHaveBeenCalled();
  });

  /**
   * The connection string comes out of a file in
   * the workspace and the connection runs against
   * whatever it names, which is the decision
   * workspace trust exists to make. So the gate is
   * before the read, not around part of it.
   */
  it('opens nothing in a window nobody has trusted', async () => {
    const open = vi.fn();
    const read = history({
      host: host({ projects: () => [project()] }),
      trust: fakeTrust(false),
      open: open as unknown as OpenDatabase,
    });

    await read.refresh();

    expect(read.render().state).toBe('untrusted');
    expect(open).not.toHaveBeenCalled();
  });

  it('says which variable is missing rather than failing quietly', async () => {
    const read = history({
      host: host({ projects: () => [project({ env: '# nothing\n' })] }),
    });

    await read.refresh();

    expect(read.render().state).toBe('unreachable');
    expect(read.render().detail).toContain('DATABASE_URL');
  });

  it('offers no ledger to watch, quietly', () => {
    expect(history().ledger()).toBeUndefined();
    expect(
      history({
        host: host({ projects: () => [project()] }),
        trust: fakeTrust(false),
      }).ledger(),
    ).toBeUndefined();
    expect(
      history({ host: host({ projects: () => [project()] }) }).ledger(),
    ).toBe('postgres://app@localhost:5432/app');
  });
});

describe('reading a project run history', () => {
  it('reads the rows and the three counts together', async () => {
    const read = reading(database());

    await read.refresh();
    const shown = read.render();

    expect(shown.state).toBe('ok');
    expect(shown.rows.map((row) => row.workflowId)).toEqual(['wf_c9d2f3']);
    expect(shown.counts).toEqual({ all: 6, failed: 1, recovered: 1 });
  });

  it('names the database without naming the credentials', async () => {
    const read = reading(database());

    await read.refresh();

    expect(read.render().source).toBe(
      'dbos.workflow_status · localhost:5432/app',
    );
  });

  /**
   * A pool left open outlives the panel that opened
   * it, and this one is opened per read.
   */
  it('closes every connection it opens', async () => {
    const db = database();
    const read = reading(db);

    await read.refresh();
    await read.setFilter('failed');

    expect(db.closed).toBe(2);
  });

  it('changes what it asks for when the filter changes', async () => {
    const db = database();
    const read = reading(db);

    await read.setFilter('failed');

    expect(read.render().filter).toBe('failed');
    expect(db.asked.some((text) => text.includes('status = ANY'))).toBe(true);
  });

  it('tells whoever is drawing that something moved', async () => {
    const read = reading(database());
    const changed = vi.fn();

    read.onChanged(changed);
    await read.refresh();

    expect(changed).toHaveBeenCalled();
  });
});

/**
 * Stopping a run, and picking a stopped one back up.
 *
 * Both are by id rather than by whatever is on
 * screen: Running Now names the run this window is
 * watching and a session row names one it started,
 * and neither of those is necessarily the run the
 * run page has open.
 *
 * DBOS's own statements report nothing about
 * themselves, so every sentence below is chosen from
 * the row read *after* the call rather than from the
 * call's own answer. That re-read is the whole
 * design of this path.
 */
describe('the two controls over a run', () => {
  /** A run of the fixture's project that is still
   *  going, which is what both controls are asked
   *  about. */
  const PENDING = {
    ...RUN_ROW,
    workflow_uuid: 'wf_live',
    status: 'PENDING',
    completed_at: null,
  };

  function ledgerOf(
    row: Record<string, unknown> = PENDING,
  ): ReturnType<typeof database> {
    const db = database();
    db.rows = [row];

    return db;
  }

  /** A history over that ledger, saying what it
   *  says, writing through that client. */
  function controlling(
    db: Database,
    client: ManagementClient = management(),
  ): { said: string[]; read: History } {
    const said: string[] = [];

    return {
      said,
      read: history({
        host: host({
          projects: () => [project()],
          say: (message) => said.push(message),
        }),
        open: async () => db,
        openManagement: async () => client,
      }),
    };
  }

  /** A client whose cancel is what moves the row,
   *  the way the real one's `UPDATE` is. */
  function cancels(db: ReturnType<typeof database>): ManagementClient {
    return {
      ...management(),
      cancelWorkflow: async () => {
        db.rows = [{ ...PENDING, status: 'CANCELLED', completed_at: '9000' }];
      },
    };
  }

  /**
   * Cancelling is not an interrupt — the run learns
   * at its next durable operation — so the answer
   * from the call says nothing about what happened.
   * The row read afterwards does, and it is what
   * picks the sentence.
   */
  it('takes the note from the row it read again', async () => {
    const moved = ledgerOf();
    const stopped = controlling(moved, cancels(moved));

    await stopped.read.cancel('wf_live');

    expect(stopped.said).toEqual([messages.runCancelled('wf_live')]);

    // And the same request against a run that has
    // not reached a durable operation yet, which
    // comes back exactly as it was.
    const still = controlling(ledgerOf());

    await still.read.cancel('wf_live');

    expect(still.said).toEqual([messages.runCancelPending('wf_live')]);
  });

  /**
   * No column anywhere records who cancelled a run,
   * so "by you" is this window's memory of having
   * asked and nothing else. It is remembered only
   * once the row read afterwards agrees.
   */
  it('says "by you" only when this window did it', async () => {
    const moved = ledgerOf();
    const stopped = controlling(moved, cancels(moved));

    await stopped.read.cancel('wf_live');

    expect([...stopped.read.cancelledHere()]).toEqual(['wf_live']);

    const pending = controlling(ledgerOf());
    await pending.read.cancel('wf_live');

    expect([...pending.read.cancelledHere()]).toEqual([]);
  });

  it('does not claim "by you" for a run cancelled elsewhere', async () => {
    const already = controlling(
      ledgerOf({ ...PENDING, status: 'CANCELLED', completed_at: '9000' }),
    );

    await already.read.refresh();

    expect([...already.read.cancelledHere()]).toEqual([]);
  });

  /**
   * A run this window has an id for and the ledger
   * does not is an ordinary thing — a fork the
   * database refused, a run somebody deleted — and
   * the answer is a sentence rather than a client
   * opened against nothing.
   */
  it('says so for an id the ledger does not have', async () => {
    const client = management();
    const missing = controlling(ledgerOf(), client);

    await missing.read.cancel('wf_nothing');

    expect(missing.said).toEqual([messages.runNotFound('wf_nothing')]);
    expect(client.destroy).not.toHaveBeenCalled();
  });

  /**
   * Both controls write into a database this folder
   * names, which is the decision workspace trust
   * exists to make. So the gate is before the read,
   * not around part of it.
   */
  it('does nothing in a window that is not trusted', async () => {
    const said: string[] = [];
    const opened = vi.fn();
    const read = history({
      host: host({
        projects: () => [project()],
        say: (message) => said.push(message),
      }),
      trust: fakeTrust(false),
      openManagement: opened as unknown as OpenManagement,
    });

    await read.cancel('wf_live');
    await read.resume('wf_live');

    expect(opened).not.toHaveBeenCalled();
    expect(said).toEqual([]);
  });

  /**
   * The client this extension ships is the one that
   * does the writing, and one newer than the
   * project's own SDK asks for members the project
   * never wrote. Said rather than attempted.
   */
  it('refuses to write through a client the project is behind', async () => {
    const said: string[] = [];
    const opened = vi.fn();
    const read = history({
      host: host({
        projects: () => [project()],
        say: (message) => said.push(message),
      }),
      projectSdk: () => ({ ok: true, version: '4.20.0' }),
      openManagement: opened as unknown as OpenManagement,
    });

    await read.cancel('wf_live');

    expect(opened).not.toHaveBeenCalled();
    expect(said).toEqual([messages.runControlSdkNewer('4.27.6', '4.20.0')]);
  });

  /**
   * Resume leaves the run's own version exactly
   * where it was, and a worker dequeues only its
   * own — so the sentence says which version it will
   * wait for, and points at Replay where that is not
   * the one the app is running.
   */
  it('says which version a resumed run will wait for', async () => {
    const cancelled = ledgerOf({
      ...PENDING,
      status: 'CANCELLED',
      completed_at: '9000',
    });
    const behind = controlling(cancelled, {
      ...management(),
      getLatestApplicationVersion: async () => ({ versionName: 'v0.5.0' }),
    });

    const done = await behind.read.resume('wf_live');

    expect(behind.said).toEqual([
      messages.runResumeStartedOlder('wf_live', 'v0.4.1', 'v0.5.0'),
    ]);
    expect(done).toEqual({
      at: 'asked',
      run: expect.objectContaining({ workflowId: 'wf_live' }),
    });
  });

  it('says a finished run was not resumed rather than pretending', async () => {
    const over = controlling(ledgerOf({ ...RUN_ROW, status: 'SUCCESS' }));

    await over.read.resume('wf_c9d2f3');

    expect(over.said).toEqual([messages.runResumeOver('wf_c9d2f3', 'SUCCESS')]);
  });

  /**
   * The watch owner is the only thing in this window
   * that polls a database, and nothing here starts a
   * second one. Cancelling asks it to look at what
   * is worth following again; a run it is already
   * watching stays the one watch it already is.
   */
  it('re-arms the existing watch rather than starting a timer', async () => {
    const moved = ledgerOf();
    const seen = watcher();
    const store = runsStore({
      host: host({ projects: () => [project()] }),
      agent: fakeAgent(),
      trust: fakeTrust(),
      open: async () => moved,
      openManagement: async () => cancels(moved),
      stack: stack().controller,
      runner: async () => ({
        ok: false,
        because: 'refused',
        detail: 'no ingress in this spec',
      }),
      watch: seen.watch,
      sessionLog: sessionLog(),
      projectSdk: () => ({ ok: true, version: '4.27.6' }),
    });

    // Opening a run that is still going is what arms
    // the one watch there is.
    await store.select('wf_live');
    expect(seen.armed).toHaveLength(1);

    await store.cancel('wf_live');

    expect(seen.armed).toHaveLength(1);
    expect(seen.armed[0]?.stopped).toBe(false);

    store.dispose();
  });
});

describe('a database that will not answer', () => {
  /**
   * An editor pointed at somebody development
   * machine is pointed at a database that is down
   * about as often as it is up. The panel says so;
   * the window does not log a rejection nobody
   * sees.
   */
  it('becomes a sentence, not an unhandled rejection', async () => {
    const read = history({
      host: host({ projects: () => [project()] }),
      open: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:5432');
      },
    });

    await read.refresh();

    expect(read.render().state).toBe('unreachable');
    expect(read.render().detail).toContain('ECONNREFUSED');
  });
});
