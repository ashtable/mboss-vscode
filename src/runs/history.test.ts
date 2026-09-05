import { describe, expect, it, vi } from 'vitest';

import { database, fork, host, project } from '../test-support/runs.js';

import type { Database, OpenDatabase } from './db.js';
import { runHistory, type History, type HistoryDeps } from './history.js';

/**
 * A project's run history, read out of its own
 * Postgres.
 *
 * Driven against a database double that answers the
 * three queries the list makes, so what is checked
 * is what the history asks, what it keeps, and what
 * it says when it cannot ask at all.
 */

function history(over: Partial<HistoryDeps> = {}): History {
  return runHistory({
    host: host(),
    open: async () => database(),
    openFork: async () => fork(),
    ...over,
  });
}

/** A history over a project, reading that
 *  database. */
function reading(db: Database): History {
  return history({
    host: host({ projects: () => [project()] }),
    open: async () => db,
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
      host: host({ projects: () => [project()], isTrusted: () => false }),
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
        host: host({ projects: () => [project()], isTrusted: () => false }),
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
    await read.select('wf_c9d2f3');

    expect(db.closed).toBe(2);
  });

  it('changes what it asks for when the filter changes', async () => {
    const db = database();
    const read = reading(db);

    await read.setFilter('failed');

    expect(read.render().filter).toBe('failed');
    expect(db.asked.some((text) => text.includes('status = ANY'))).toBe(true);
  });

  it('reads a run and its steps when one is picked', async () => {
    const read = reading(database());

    await read.refresh();
    await read.select('wf_c9d2f3');
    const detail = read.detail();

    expect(detail?.run.workflowId).toBe('wf_c9d2f3');
    expect(detail?.steps.map((step) => step.name)).toEqual(['parse_request']);
    expect(read.render().selected).toBe('wf_c9d2f3');
  });

  /**
   * A run somebody deleted is not a run to keep
   * showing, and a database that hiccuped is not a
   * reason to blank the tab. Two different absences,
   * told apart.
   */
  it('clears the tab for a run that is not there any more', async () => {
    const db = database();
    const read = reading(db);

    await read.select('wf_c9d2f3');
    expect(read.detail()).toBeDefined();

    // The same history, reading again after somebody
    // dropped the row.
    db.rows = [];
    await read.select('wf_c9d2f3');

    expect(read.detail()).toBeUndefined();
  });

  /** The other absence: the tab keeps what it had
   *  rather than blanking on a hiccup. */
  it('keeps the tab when the database stops answering', async () => {
    const db = database();
    const read = reading(db);

    await read.select('wf_c9d2f3');
    db.fail = 'ECONNREFUSED';
    await read.select('wf_c9d2f3');

    expect(read.detail()?.run.workflowId).toBe('wf_c9d2f3');
    expect(read.render().state).toBe('unreachable');
  });

  it('tells whoever is drawing that something moved', async () => {
    const read = reading(database());
    const changed = vi.fn();

    read.onChanged(changed);
    await read.refresh();

    expect(changed).toHaveBeenCalled();
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

describe('replaying a step', () => {
  it('forks the run the panel is showing, from the step clicked', async () => {
    const client = fork();
    const said: string[] = [];
    const read = history({
      host: host({
        projects: () => [project()],
        say: (message) => said.push(message),
      }),
      openFork: async () => client,
    });

    await read.refresh();
    await read.select('wf_c9d2f3');
    await read.replay(0);

    expect(said[0]).toContain('wf_fork1');
    expect(said[0]).toContain('v0.4.1');
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all before a run has been picked', async () => {
    const client = fork();
    const read = history({
      host: host({ projects: () => [project()] }),
      openFork: async () => client,
    });

    await read.refresh();
    await read.replay(0);

    expect(client.destroy).not.toHaveBeenCalled();
  });

  /**
   * Forking writes a row into the project's
   * database and sets code running, which is the
   * same decision trust covers everywhere else.
   */
  it('does nothing in a window nobody has trusted', async () => {
    const client = fork();
    const read = history({
      host: host({ projects: () => [project()], isTrusted: () => false }),
      openFork: async () => client,
    });

    await read.replay(0);

    expect(client.destroy).not.toHaveBeenCalled();
  });
});
