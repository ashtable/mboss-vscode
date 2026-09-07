import { describe, expect, it, vi } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { database, host, project } from '../test-support/runs.js';

import type { Database, OpenDatabase } from './db.js';
import { runHistory, type History, type HistoryDeps } from './history.js';

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
