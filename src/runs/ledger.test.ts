import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { messages } from '../messages.js';
import { RUN_ROW, database, host, project } from '../test-support/runs.js';

import type { Database, OpenDatabase } from './db.js';
import { projectLedger, type Ledger, type LedgerDeps } from './ledger.js';

/**
 * The project's DBOS system database, as this window
 * reads it.
 *
 * Driven against a database double, because what is
 * checked here is not what any statement selects —
 * the queries have their own spec — but when this
 * opens a connection at all, what it says about the
 * one it opened, and who hears about it. The list
 * used to own all of that and lend it out, so its
 * spec is where the first two of these cases came
 * from.
 */

/** One over a project with a `.env`, reading a
 *  database that answers. */
function ledger(over: Partial<LedgerDeps> = {}): Ledger {
  return projectLedger({
    host: host({ projects: () => [project()] }),
    trust: fakeTrust(),
    open: async () => database(),
    ...over,
  });
}

/** One over a database a case can speak through. */
function ledgerOver(db: Database, over: Partial<LedgerDeps> = {}): Ledger {
  return ledger({ open: async () => db, ...over });
}

/** One read that actually asks the database
 *  something, which is what a database that refuses
 *  gets to refuse. */
function asked(read: Ledger): Promise<unknown> {
  return read.read(async (db) => await db.query('SELECT 1', []));
}

describe('before there is anything to read', () => {
  it('opens nothing in a window with no project', async () => {
    const open = vi.fn();
    const read = ledger({
      host: host(),
      open: open as unknown as OpenDatabase,
    });

    expect(await asked(read)).toBeUndefined();
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
    const read = ledger({
      trust: fakeTrust(false),
      open: open as unknown as OpenDatabase,
    });

    expect(await asked(read)).toBeUndefined();
    expect(read.render().state).toBe('untrusted');
    expect(open).not.toHaveBeenCalled();
  });

  /**
   * A file to fix rather than a database to start:
   * starting the stack would not write the missing
   * line.
   */
  it('says which variable is missing rather than failing quietly', async () => {
    const read = ledger({
      host: host({ projects: () => [project({ env: '# nothing\n' })] }),
    });

    await asked(read);

    expect(read.render().state).toBe('no-database');
    expect(read.render().detail).toContain('DATABASE_URL');
  });

  it('says there is no .env to read a database from', async () => {
    const dir = project();
    rmSync(join(dir, '.env'));
    const read = ledger({ host: host({ projects: () => [dir] }) });

    await asked(read);

    expect(read.render().state).toBe('no-database');
    expect(read.render().detail).toBe(
      messages.runsNoEnvFile(join(dir, '.env')),
    );
  });

  it('offers no address to whoever asks quietly', () => {
    expect(ledger({ host: host() }).quietly()).toBeUndefined();
    expect(ledger({ trust: fakeTrust(false) }).quietly()).toBeUndefined();
    expect(ledger().quietly()).toEqual({
      url: 'postgres://app@localhost:5432/app',
      from: 'DATABASE_URL',
    });
  });
});

describe('one read of the ledger', () => {
  it('hands back whatever the read made of the rows', async () => {
    const read = ledgerOver(database());

    const rows = await asked(read);

    expect(rows).toEqual([RUN_ROW]);
    expect(read.render().state).toBe('ok');
  });

  it('names the database without naming the credentials', async () => {
    const read = ledgerOver(database());

    await asked(read);

    expect(read.render().source).toBe(
      'dbos.workflow_status · localhost:5432/app',
    );
  });

  /**
   * A pool left open outlives the panel that opened
   * it, and this one is opened per question.
   */
  it('closes every connection it opens', async () => {
    const db = database();
    const read = ledgerOver(db);

    await asked(read);
    await read.runOf('wf_c9d2f3');

    expect(db.closed).toBe(2);
  });

  /**
   * An editor pointed at somebody's development
   * machine is pointed at a database that is down
   * about as often as it is up. The panel says so;
   * the window does not log a rejection nobody
   * sees.
   */
  it('becomes a sentence, not an unhandled rejection', async () => {
    const read = ledger({
      open: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:5432');
      },
    });

    expect(await asked(read)).toBeUndefined();
    expect(read.render().state).toBe('unreachable');
    expect(read.render().detail).toContain('ECONNREFUSED');
  });

  /**
   * The difference between a run this ledger does
   * not have and a question it was never asked,
   * which is what stands between somebody and a
   * sentence saying their run is not there.
   */
  it('says whether the database answered at all', async () => {
    const db = database();
    const read = ledgerOver(db);

    expect(read.answered()).toBe(false);

    expect(await read.runOf('wf_nowhere')).toBeUndefined();
    expect(read.answered()).toBe(true);

    db.fail = 'ECONNREFUSED';
    expect(await read.runOf('wf_c9d2f3')).toBeUndefined();
    expect(read.answered()).toBe(false);
  });
});

/**
 * One run, and one run with every row it wrote.
 *
 * Four modules used to spell these out for
 * themselves, which is four places for a column to
 * be decoded one way here and another way there.
 */
describe('the reads by id', () => {
  it('reads one run and every row it wrote', async () => {
    const read = ledgerOver(database());

    expect((await read.runOf('wf_c9d2f3'))?.name).toBe('groom_booking');
    expect(
      (await read.rowsOf('wf_c9d2f3'))?.steps.map((one) => one.name),
    ).toEqual(['parse_request']);
  });

  it('answers nothing for an id the ledger does not have', async () => {
    const read = ledgerOver(database());

    expect(await read.runOf('wf_nowhere')).toBeUndefined();
    expect(await read.rowsOf('wf_nowhere')).toBeUndefined();
  });

  /** The rows are not read at all where there is no
   *  run to read them for. */
  it('asks for no rows of a run that is not there', async () => {
    const db = database();
    const read = ledgerOver(db);

    await read.rowsOf('wf_nowhere');

    expect(db.asked.some((text) => text.startsWith('SELECT function_id'))).toBe(
      false,
    );
  });
});

/**
 * Loud and quiet.
 *
 * A read somebody asked for says what it learned,
 * because the Runs view draws that sentence. A read
 * this window made on its own account — a watch
 * arming, the object handed to an agent, the card
 * about one queue block — says nothing, and asks for
 * an address rather than a read.
 */
describe('what a read says about the database', () => {
  it('says nothing at all when the address was asked for quietly', () => {
    const read = ledger({ host: host({ projects: () => [project()] }) });
    const changed = vi.fn();

    read.onChanged(changed);
    read.quietly();

    // Still where it started: nobody has read
    // anything, so there is nothing to say about a
    // database yet.
    expect(read.render()).toEqual({
      state: 'no-project',
      detail: undefined,
      source: undefined,
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it('says what it learned when somebody read', async () => {
    const read = ledgerOver(database());
    const changed = vi.fn();

    read.onChanged(changed);
    await asked(read);

    expect(read.render().state).toBe('ok');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  /**
   * A watch ticks twice a second and the run page
   * reads on every refresh. Firing on each of those
   * would redraw the whole panel over a sentence
   * that has not moved.
   */
  it('tells nobody about a read that learned the same thing again', async () => {
    const db = database();
    const read = ledgerOver(db);
    const changed = vi.fn();

    await asked(read);
    read.onChanged(changed);

    await asked(read);
    await read.runOf('wf_c9d2f3');

    expect(changed).not.toHaveBeenCalled();

    db.fail = 'ECONNREFUSED';
    await asked(read);

    expect(changed).toHaveBeenCalledTimes(1);

    db.fail = undefined;
    await asked(read);

    expect(changed).toHaveBeenCalledTimes(2);
  });

  /**
   * Two sentences about the same refusal are one
   * sentence: what moved is the detail, and it is
   * the same detail.
   */
  it('says nothing new about a database that is refusing the same way', async () => {
    const db = database();
    db.fail = 'ECONNREFUSED 127.0.0.1:5432';
    const read = ledgerOver(db);
    const changed = vi.fn();

    await asked(read);
    read.onChanged(changed);
    await asked(read);

    expect(changed).not.toHaveBeenCalled();
  });
});
