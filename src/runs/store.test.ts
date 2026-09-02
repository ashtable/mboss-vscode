import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Database, OpenDatabase } from './db.js';
import type { ForkClient } from './replay.js';
import { runsStore, type RunsHost } from './store.js';

/**
 * What the window knows about a project's runs.
 *
 * Driven against a database that is a function,
 * because everything worth asserting here is about
 * what is read and when: that nothing is read
 * before somebody has trusted the folder, that a
 * database which will not answer becomes a sentence
 * rather than an unhandled rejection, and that
 * every connection opened is closed again.
 */

const RUN_ROW = {
  workflow_uuid: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recovery_attempts: '2',
  executor_id: 'local-dev',
  application_version: 'v0.4.1',
  created_at: '1000',
  started_at_epoch_ms: '1000',
  completed_at: '9000',
  error: null,
  serialization: null,
};

const STEP_ROW = {
  function_id: 0,
  function_name: 'parse_request',
  started_at_epoch_ms: '1000',
  completed_at_epoch_ms: '1200',
  output: '{}',
  error: null,
  child_workflow_id: null,
  serialization: null,
};

const COUNTS_ROW = { all_runs: '6', failed_runs: '1', recovered_runs: '1' };

function project(
  env = 'DATABASE_URL=postgres://app@localhost:5432/app',
): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-runs-store-'));
  mkdirSync(join(dir, '.mboss', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.env'), env, 'utf8');

  return dir;
}

/**
 * Answers each statement by what it selects from.
 *
 * `rows` and `fail` are how a spec makes a row go
 * away and a database stop answering, which are two
 * different things this store has to tell apart.
 */
function database(): Database & {
  closed: number;
  asked: string[];
  rows: unknown[];
  fail: string | undefined;
} {
  const state = {
    closed: 0,
    asked: [] as string[],
    rows: [RUN_ROW] as unknown[],
    fail: undefined as string | undefined,
    query: async <Row>(text: string): Promise<Row[]> => {
      state.asked.push(text);

      if (state.fail !== undefined) throw new Error(state.fail);
      if (text.includes('count(*)')) return [COUNTS_ROW] as Row[];
      if (text.includes('operation_outputs')) return [STEP_ROW] as Row[];

      return state.rows as Row[];
    },
    close: async () => {
      state.closed += 1;
    },
  };

  return state;
}

function host(over: Partial<RunsHost> = {}): RunsHost {
  return {
    projects: () => [],
    isTrusted: () => true,
    say: () => undefined,
    ...over,
  };
}

function fork(): ForkClient & { destroy: ReturnType<typeof vi.fn> } {
  return {
    getLatestApplicationVersion: async () => ({ versionName: 'v0.4.1' }),
    forkWorkflow: async () => 'wf_fork1',
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe('before there is anything to read', () => {
  it('opens nothing in a window with no project', async () => {
    const open = vi.fn();
    const store = runsStore({
      host: host(),
      open: open as unknown as OpenDatabase,
      openFork: async () => fork(),
    });

    await store.refresh();

    expect(store.list().state).toBe('no-project');
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
    const store = runsStore({
      host: host({ projects: () => [project()], isTrusted: () => false }),
      open: open as unknown as OpenDatabase,
      openFork: async () => fork(),
    });

    await store.refresh();

    expect(store.list().state).toBe('untrusted');
    expect(open).not.toHaveBeenCalled();
  });

  it('says which variable is missing rather than failing quietly', async () => {
    const store = runsStore({
      host: host({ projects: () => [project('# nothing\n')] }),
      open: async () => database(),
      openFork: async () => fork(),
    });

    await store.refresh();

    expect(store.list().state).toBe('unreachable');
    expect(store.list().detail).toContain('DATABASE_URL');
  });
});

describe('reading a project run history', () => {
  function open(db: Database): { store: ReturnType<typeof runsStore> } {
    return {
      store: runsStore({
        host: host({ projects: () => [project()] }),
        open: async () => db,
        openFork: async () => fork(),
      }),
    };
  }

  it('reads the rows and the three counts together', async () => {
    const db = database();
    const { store } = open(db);

    await store.refresh();

    const list = store.list();
    expect(list.state).toBe('ok');
    expect(list.runs.map((run) => run.workflowId)).toEqual(['wf_c9d2f3']);
    expect(list.counts).toEqual({ all: 6, failed: 1, recovered: 1 });
  });

  it('names the database without naming the credentials', async () => {
    const db = database();
    const { store } = open(db);

    await store.refresh();

    expect(store.list().database).toBe('localhost:5432/app');
  });

  /**
   * A pool left open outlives the panel that opened
   * it, and this one is opened per read.
   */
  it('closes every connection it opens', async () => {
    const db = database();
    const { store } = open(db);

    await store.refresh();
    await store.select('wf_c9d2f3');

    expect(db.closed).toBe(2);
  });

  it('changes what it asks for when the filter changes', async () => {
    const db = database();
    const { store } = open(db);

    await store.setFilter('failed');

    expect(store.list().filter).toBe('failed');
    expect(db.asked.some((text) => text.includes('status = ANY'))).toBe(true);
  });

  it('reads a run and its steps when one is picked', async () => {
    const db = database();
    const { store } = open(db);

    await store.refresh();
    await store.select('wf_c9d2f3');

    const detail = store.detail();
    expect(detail?.run.workflowId).toBe('wf_c9d2f3');
    expect(detail?.steps.map((step) => step.name)).toEqual(['parse_request']);
    expect(store.list().selected).toBe('wf_c9d2f3');
  });

  /**
   * A run somebody deleted is not a run to keep
   * showing, and a database that hiccuped is not a
   * reason to blank the tab. Two different absences,
   * told apart.
   */
  it('clears the tab for a run that is not there any more', async () => {
    const db = database();
    const { store } = open(db);

    await store.select('wf_c9d2f3');
    expect(store.detail()).toBeDefined();

    // The same store, reading again after somebody
    // dropped the row.
    db.rows = [];
    await store.select('wf_c9d2f3');

    expect(store.detail()).toBeUndefined();
  });

  /** The other absence: the tab keeps what it had
   *  rather than blanking on a hiccup. */
  it('keeps the tab when the database stops answering', async () => {
    const db = database();
    const { store } = open(db);

    await store.select('wf_c9d2f3');

    db.fail = 'ECONNREFUSED';
    await store.select('wf_c9d2f3');

    expect(store.detail()?.run.workflowId).toBe('wf_c9d2f3');
    expect(store.list().state).toBe('unreachable');
  });

  it('tells whoever is drawing that something moved', async () => {
    const db = database();
    const { store } = open(db);
    const changed = vi.fn();

    store.onChanged(changed);
    await store.refresh();

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
    const store = runsStore({
      host: host({ projects: () => [project()] }),
      open: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:5432');
      },
      openFork: async () => fork(),
    });

    await store.refresh();

    expect(store.list().state).toBe('unreachable');
    expect(store.list().detail).toContain('ECONNREFUSED');
  });
});

describe('replaying a step', () => {
  it('forks the run the panel is showing, from the step clicked', async () => {
    const client = fork();
    const said: string[] = [];
    const store = runsStore({
      host: host({
        projects: () => [project()],
        say: (message) => said.push(message),
      }),
      open: async () => database(),
      openFork: async () => client,
    });

    await store.refresh();
    await store.select('wf_c9d2f3');
    await store.replay(0);

    expect(said[0]).toContain('wf_fork1');
    expect(said[0]).toContain('v0.4.1');
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all before a run has been picked', async () => {
    const client = fork();
    const store = runsStore({
      host: host({ projects: () => [project()] }),
      open: async () => database(),
      openFork: async () => client,
    });

    await store.refresh();
    await store.replay(0);

    expect(client.destroy).not.toHaveBeenCalled();
  });

  /**
   * Forking writes a row into the project's
   * database and sets code running, which is the
   * same decision trust covers everywhere else.
   */
  it('does nothing in a window nobody has trusted', async () => {
    const client = fork();
    const store = runsStore({
      host: host({ projects: () => [project()], isTrusted: () => false }),
      open: async () => database(),
      openFork: async () => client,
    });

    await store.replay(0);

    expect(client.destroy).not.toHaveBeenCalled();
  });
});
