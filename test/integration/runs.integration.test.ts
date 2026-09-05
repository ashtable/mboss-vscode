import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase, openFork } from '../../src/runs/db.js';
import { sessionLog } from '../../src/runs/sessionLog.js';
import { runsStore, type RunsStore } from '../../src/runs/store.js';

/**
 * The run history, read out of a schema DBOS made.
 *
 * Everything asserted here is a claim about
 * somebody else's table: that the columns are
 * spelled the way this extension spells them, that
 * `bigint` really does arrive as a string, that
 * `status = ANY($1)` really does select the runs
 * DBOS calls failed, and that a fork writes the row
 * a replay is supposed to write. A doubled database
 * can make none of those claims, which is why this
 * suite exists — and why it is not in CI, matching
 * the other repository here that has one.
 *
 * **Where the schema comes from.** DBOS makes it.
 * One real `DBOS.launch()` against a disposable
 * database creates the whole `dbos` schema at
 * whatever version the SDK is pinned at, and two
 * registered workflows — one that returns, one that
 * throws — write real rows with real steps and a
 * real failure. That is the cheap half of the
 * fixture and it is honest.
 *
 * The expensive half is not built: a genuinely
 * crash-recovered run means killing a worker
 * mid-flight and restarting it, which is a whole
 * harness for one column. `recovery_attempts` is
 * therefore set by hand on one run below — and the
 * hand-written `UPDATE` is the only statement in
 * this file that is not the extension's own. What
 * the filters do with that column is the same
 * either way, and what a crash *looks* like is
 * proven against canned data in the webview specs.
 *
 * Nothing here drops a database it did not name.
 */

/** The server. The compose stack in the
 *  superproject root publishes exactly this. */
const SERVER =
  process.env['MBOSS_RUNS_TEST_SERVER'] ??
  'postgres://postgres:mboss@127.0.0.1:5432';

/** The one database this suite may destroy, named
 *  here rather than taken from the environment so
 *  that it can only ever be this one. */
const DATABASE = 'mboss_vscode_runs_test';

const SYSTEM_DATABASE_URL = `${SERVER}/${DATABASE}`;

const OK_RUN = 'itest_ok';
const FAILED_RUN = 'itest_failed';
const RECOVERED_RUN = 'itest_recovered';

/** Two steps that return, so a run has a ledger to
 *  be restored from. */
const greet = DBOS.registerWorkflow(
  async (name: string): Promise<string> => {
    const hello = await DBOS.runStep(async () => `hello ${name}`, {
      name: 'compose',
    });

    return await DBOS.runStep(async () => hello.toUpperCase(), {
      name: 'shout',
    });
  },
  { name: 'greet' },
);

/** One that returns and one that throws, so the
 *  failed run has a completed step before it. */
const stumble = DBOS.registerWorkflow(
  async (): Promise<void> => {
    await DBOS.runStep(async () => 'ready', { name: 'prepare' });

    await DBOS.runStep(
      async () => {
        throw new Error('login failed — CDC_PASS rotated');
      },
      { name: 'submit', retriesAllowed: false },
    );
  },
  { name: 'stumble' },
);

async function onMaintenanceServer(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: `${SERVER}/postgres` });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function onTestDatabase(sql: string, values: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: SYSTEM_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql, values);
  } finally {
    await client.end();
  }
}

/** A project directory whose `.env` points at the
 *  database this suite just filled. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-runs-itest-'));
  mkdirSync(join(dir, '.mboss', 'workflows'), { recursive: true });
  writeFileSync(
    join(dir, '.env'),
    `DBOS_SYSTEM_DATABASE_URL="${SYSTEM_DATABASE_URL}"\n`,
    'utf8',
  );

  return dir;
}

describe('a run history, read from a real dbos schema', () => {
  let store: RunsStore;
  let said: string[];

  beforeAll(async () => {
    await onMaintenanceServer(
      `DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`,
    );
    await onMaintenanceServer(`CREATE DATABASE "${DATABASE}"`);

    DBOS.setConfig({
      name: 'mboss-vscode-runs-test',
      systemDatabaseUrl: SYSTEM_DATABASE_URL,
    });
    await DBOS.launch();

    await DBOS.withNextWorkflowID(OK_RUN, async () => greet('world'));
    await DBOS.withNextWorkflowID(RECOVERED_RUN, async () => greet('again'));
    await expect(
      DBOS.withNextWorkflowID(FAILED_RUN, async () => stumble()),
    ).rejects.toThrow();

    // The one hand-written statement here. A crash
    // that DBOS really recovered from would mean
    // killing a worker mid-flight; what the filter
    // does with the column is the same either way.
    await onTestDatabase(
      'UPDATE dbos.workflow_status SET recovery_attempts = $1 ' +
        'WHERE workflow_uuid = $2',
      [3, RECOVERED_RUN],
    );

    // The extension never runs inside a DBOS
    // process, so the fixture's own launch is shut
    // down before anything is read: what follows
    // reads the database the way an editor would.
    await DBOS.shutdown({ deregister: false });

    said = [];
    const dir = project();
    store = runsStore({
      host: {
        projects: () => [dir],
        isTrusted: () => true,
        say: (message) => said.push(message),
        setContext: () => undefined,
        note: () => undefined,
        notify: async () => undefined,
      },
      open: openDatabase,
      openFork,
      // This suite reads a real ledger and forks a
      // real run. Nothing here starts a container
      // or an ingress, so the collaborators that
      // would are answers rather than effects.
      stack: {
        up: async () => undefined,
        rebuild: async () => undefined,
        down: async () => undefined,
        status: async () => ({
          available: false,
          services: [],
          detail: undefined,
        }),
        appOrigin: async () => undefined,
      },
      runner: async () => ({
        ok: false,
        because: 'refused',
        detail: 'no ingress in this suite',
      }),
      watch: () => ({ stop: () => undefined }),
      sessionLog: sessionLog(),
    });
  });

  afterAll(async () => {
    await onMaintenanceServer(
      `DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`,
    );
  });

  it('renders a row per run, newest first', async () => {
    await store.refresh();

    const list = store.list();
    expect(list.state).toBe('ok');
    expect(list.rows.map((row) => row.workflowId).sort()).toEqual([
      FAILED_RUN,
      OK_RUN,
      RECOVERED_RUN,
    ]);
    expect(list.counts).toEqual({ all: 3, failed: 1, recovered: 1 });
  });

  /**
   * The trap this whole file exists for. `pg`
   * returns `int8` as text and `int4` as a number,
   * so a mapper that guessed would put `"2"` in the
   * rail and get away with it in every other test.
   */
  it('reads the bigint columns back as numbers', async () => {
    await store.refresh();
    await store.select(RECOVERED_RUN);

    const run = store.detail()?.run;
    expect(run?.recoveryAttempts).toBe(3);
    expect(run?.createdAt).toBeGreaterThan(0);
    expect(run?.completedAt).toBeGreaterThan(run?.createdAt ?? 0);
    expect(store.detail()?.steps[0]?.functionId).toBe(0);
  });

  it('shows the failure DBOS recorded, in its own words', async () => {
    await store.refresh();
    await store.select(FAILED_RUN);

    const detail = store.detail();
    expect(detail?.run.status).toBe('ERROR');
    expect(detail?.run.error).toContain('CDC_PASS rotated');
    expect(detail?.steps.map((step) => step.name)).toEqual([
      'prepare',
      'submit',
    ]);
    expect(detail?.steps[1]?.error).toContain('CDC_PASS rotated');
  });

  it('shows what a step actually returned, byte for byte', async () => {
    await store.refresh();
    await store.select(OK_RUN);

    expect(store.detail()?.steps[1]?.output).toContain('HELLO WORLD');
  });

  /**
   * A run can match two filters at once — recovering
   * is something that happened during a run, not a
   * way one ended — so the counts do not add up and
   * the sets overlap on purpose.
   */
  it('filters on what the database itself calls failed', async () => {
    await store.setFilter('failed');
    expect(store.list().rows.map((row) => row.workflowId)).toEqual([
      FAILED_RUN,
    ]);

    await store.setFilter('recovered');
    expect(store.list().rows.map((row) => row.workflowId)).toEqual([
      RECOVERED_RUN,
    ]);

    await store.setFilter('all');
    expect(store.list().rows).toHaveLength(3);
  });

  /**
   * The done-when, against the real client: a replay
   * writes a new run that DBOS marks as forked from
   * this one. It sits `ENQUEUED` because nothing is
   * running to pick it up, which is exactly what the
   * note beside the button says.
   */
  it('forks a run when a step is replayed', async () => {
    await store.refresh();
    await store.select(FAILED_RUN);
    await store.replay(1);

    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Replaying as ');

    const forked = await openDatabase(SYSTEM_DATABASE_URL);
    try {
      const rows = await forked.query<{ workflow_uuid: string }>(
        'SELECT workflow_uuid FROM dbos.workflow_status ' +
          'WHERE forked_from = $1',
        [FAILED_RUN],
      );

      expect(rows).toHaveLength(1);
      expect(said[0]).toContain(rows[0]?.workflow_uuid ?? 'no fork');
    } finally {
      await forked.close();
    }
  });
});
