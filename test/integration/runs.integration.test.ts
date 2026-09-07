import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase, openManagement } from '../../src/runs/db.js';
import { replayFrom } from '../../src/runs/replay.js';
import type {
  ReplayAnswer,
  ReplayQuestion,
} from '../../src/runs/replayZone.js';
import { projectSdk } from '../../src/runs/sdk.js';
import { fakeAgent } from '../doubles/agent.js';
import { fakeTrust } from '../doubles/trust.js';
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
const BOOKED_RUN = 'itest_booked';
const SLEEPING_RUN = 'itest_sleeping';
const PARKED_RUN = 'itest_parked';

/** What the ingress a generated project ships
 *  hands a workflow: one object, positionally. */
const BOOKING = { email: 'ada@example.com', slot: '09:00' };

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

/**
 * One argument and one named failure, which is the
 * shape a generated workflow and its handlers
 * actually have.
 *
 * Started the way the scaffold's ingress starts one
 * — `DBOS.startWorkflow(fn, { workflowID })(payload)`
 * — rather than through `withNextWorkflowID`,
 * because what is being checked here is the
 * `inputs` column, and the two start paths are the
 * two ways an argument reaches it.
 */
const book = DBOS.registerWorkflow(
  async (event: { email: string; slot: string }): Promise<void> => {
    await DBOS.runStep(
      async () => {
        const taken = new Error(`the ${event.slot} slot is taken`);
        taken.name = 'SlotTaken';
        throw taken;
      },
      { name: 'find_slot', retriesAllowed: false },
    );
  },
  { name: 'book' },
);

/**
 * The two shapes the SDK writes while a run is not
 * running.
 *
 * Both are the SDK's own rows rather than anything
 * the compiler emits, which is why they are checked
 * here against a real schema and not against a
 * golden. Whether the run page can draw "asleep
 * until" and "times out" at all rests entirely on
 * what these rows turn out to hold.
 */
const SLEEP_MS = 120_000;

const RECV_TIMEOUT_S = 120;

const timerWait = DBOS.registerWorkflow(
  async (): Promise<void> => {
    await DBOS.runStep(async () => 'ready', { name: 'before_wait' });
    await DBOS.sleep(SLEEP_MS);
    await DBOS.runStep(async () => 'woken', { name: 'after_wait' });
  },
  { name: 'timer_wait_probe' },
);

const approvalFlow = DBOS.registerWorkflow(
  async (): Promise<void> => {
    await DBOS.runStep(async () => 'asked', { name: 'manager_ok.ask' });
    await DBOS.runStep(async () => 'parked', { name: 'manager_ok.register' });
    await DBOS.recv('approval', RECV_TIMEOUT_S);
    await DBOS.runStep(async () => 'woken', { name: 'manager_ok.clear' });
  },
  { name: 'approval_flow_probe' },
);

/** One row of the ledger, as the SDK wrote it. */
type Recorded = {
  function_id: number;
  function_name: string;
  started_at_epoch_ms: string | null;
  completed_at_epoch_ms: string | null;
  output: string | null;
  serialization: string | null;
};

async function rowsOf(workflowId: string): Promise<Recorded[]> {
  const client = new pg.Client({ connectionString: SYSTEM_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<Recorded>(
      'SELECT function_id, function_name, started_at_epoch_ms, ' +
        'completed_at_epoch_ms, output, serialization ' +
        'FROM dbos.operation_outputs WHERE workflow_uuid = $1 ' +
        'ORDER BY function_id',
      [workflowId],
    );

    return rows;
  } finally {
    await client.end();
  }
}

/** Polls until the run has written as many rows as
 *  it is going to before it parks. */
async function settledAt(
  workflowId: string,
  rows: number,
): Promise<Recorded[]> {
  for (let tries = 0; tries < 60; tries += 1) {
    const found = await rowsOf(workflowId);
    if (found.length >= rows) return found;

    await new Promise((wake) => setTimeout(wake, 250));
  }

  return await rowsOf(workflowId);
}

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

  /** What the modal answers, since there is nobody
   *  here to press a button, and what it was
   *  asked. */
  let confirmed: ReplayAnswer;
  let asked: ReplayQuestion[];
  let sleeping: Recorded[];
  let parked: Recorded[];

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

    const booking = await DBOS.startWorkflow(book, {
      workflowID: BOOKED_RUN,
    })(BOOKING);
    await expect(booking.getResult()).rejects.toThrow();

    // Started and deliberately not awaited: what is
    // being read is what the ledger holds *while*
    // each of them is parked.
    await DBOS.startWorkflow(timerWait, { workflowID: SLEEPING_RUN })();
    await DBOS.startWorkflow(approvalFlow, { workflowID: PARKED_RUN })();

    sleeping = await settledAt(SLEEPING_RUN, 2);
    parked = await settledAt(PARKED_RUN, 3);

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
    asked = [];
    confirmed = { at: 'nothing' };
    const dir = project();
    store = runsStore({
      host: {
        projects: () => [dir],
        say: (message) => said.push(message),
        setContext: () => undefined,
        copy: async () => undefined,
        openCanvas: async () => undefined,
        openFile: async () => undefined,
        conductorConsoleUrl: () => '',
        openExternal: async () => undefined,
        revealAgent: async () => undefined,
        // Nobody at the keyboard, so the case that
        // reads the question reads it here.
        confirm: async (question) => {
          asked.push(question);

          return confirmed;
        },
      },
      agent: fakeAgent(),
      trust: fakeTrust(),
      open: openDatabase,
      openManagement,
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
      projectSdk,
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
      BOOKED_RUN,
      FAILED_RUN,
      OK_RUN,
      PARKED_RUN,
      RECOVERED_RUN,
      SLEEPING_RUN,
    ]);
    expect(list.counts).toEqual({ all: 6, failed: 2, recovered: 1 });
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
   * The `inputs` column and the stored error, read
   * back through the extension's own decoders
   * against bytes the SDK itself wrote. Both shapes
   * are the SDK's rather than the ingress's, and a
   * fixture could assert neither.
   */
  it('reads what a run was started with, and what its step threw', async () => {
    await store.refresh();
    await store.select(BOOKED_RUN);

    const detail = store.detail();

    expect(detail?.run.input).toEqual({ shape: 'payload', value: BOOKING });

    const failure = detail?.steps[0]?.failure;
    expect(failure?.name).toBe('SlotTaken');
    expect(failure?.message).toContain('09:00 slot is taken');
    expect(failure?.stack).toContain('SlotTaken');
  });

  /**
   * What the SDK writes while a run is asleep.
   *
   * A sleep's row records the wake deadline as its
   * completion, so the step's duration is the sleep
   * — which is what would let a run page say when a
   * run wakes.
   */
  it('records a sleep as the deadline it will wake at', () => {
    const row = sleeping.find((one) => one.function_name === 'DBOS.sleep');

    expect(row).toBeDefined();
    if (row === undefined) return;

    const deadline = Number(JSON.parse(row.output ?? 'null'));
    const startedAt = Number(row.started_at_epoch_ms);

    expect(Number.isFinite(deadline)).toBe(true);
    expect(deadline).toBeGreaterThanOrEqual(startedAt);
    expect(Number(row.completed_at_epoch_ms)).toBe(deadline);

    // The bytes themselves, because this is the one
    // step output the application does not
    // serialize: the SDK writes its own deadline
    // with the portable serializer whatever the app
    // configured, and the reader takes the column at
    // its word rather than looking for an envelope.
    expect(Number(row.output)).toBe(deadline);
    expect(row.serialization).toBe('portable_json');
  });

  /**
   * And what it writes while a run is parked on a
   * person: the wait's own two rows, nothing at the
   * id `DBOS.recv` reserved, and a zero-width sleep
   * carrying the moment the wait gives up.
   */
  it('records a timeout as a marker of zero width', () => {
    expect(parked.map((one) => [one.function_id, one.function_name])).toEqual([
      [0, 'manager_ok.ask'],
      [1, 'manager_ok.register'],
      [3, 'DBOS.sleep'],
    ]);

    const marker = parked[2];
    if (marker === undefined) return;

    expect(Number(marker.completed_at_epoch_ms)).toBe(
      Number(marker.started_at_epoch_ms),
    );
    expect(Number.isFinite(Number(JSON.parse(marker.output ?? 'null')))).toBe(
      true,
    );
    expect(Number.isFinite(Number(marker.output))).toBe(true);
    expect(marker.serialization).toBe('portable_json');
  });

  /**
   * A run can match two filters at once — recovering
   * is something that happened during a run, not a
   * way one ended — so the counts do not add up and
   * the sets overlap on purpose.
   */
  it('filters on what the database itself calls failed', async () => {
    await store.setFilter('failed');
    expect(
      store
        .list()
        .rows.map((row) => row.workflowId)
        .sort(),
    ).toEqual([BOOKED_RUN, FAILED_RUN]);

    await store.setFilter('recovered');
    expect(store.list().rows.map((row) => row.workflowId)).toEqual([
      RECOVERED_RUN,
    ]);

    await store.setFilter('all');
    expect(store.list().rows).toHaveLength(6);
  });

  /**
   * The runs in this suite are workflows registered
   * by hand under one `DBOS.launch()`, so the
   * project they were read from has no document for
   * any of them — which is a refusal a person can
   * act on rather than a fork that would end in an
   * error the moment it ran.
   */
  it('refuses a replay of a run this project has no document for', async () => {
    await store.refresh();
    await store.select(FAILED_RUN);
    await store.replay(FAILED_RUN, { functionId: 1 });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.detail).toContain('has no workflow named');
    expect(asked[0]?.actions.map((one) => one.at)).toEqual(['again']);

    const forked = await openDatabase(SYSTEM_DATABASE_URL);
    try {
      expect(
        await forked.query(
          'SELECT workflow_uuid FROM dbos.workflow_status ' +
            'WHERE forked_from = $1',
          [FAILED_RUN],
        ),
      ).toEqual([]);
    } finally {
      await forked.close();
    }
  });

  /**
   * The fork itself, against the real client: a new
   * run that DBOS marks as forked from this one. It
   * sits `ENQUEUED` because nothing is running to
   * pick it up, which is exactly what the note
   * beside the button says.
   *
   * Driven through the write rather than through the
   * decision above it, because a decision that says
   * yes needs a scaffolded project with generated
   * code — which is the compose-backed harness in
   * `stack.integration.test.ts`, not this one.
   */
  it('forks a run through the real management client', async () => {
    await store.refresh();
    await store.select(FAILED_RUN);

    const run = store.detail()?.run;
    expect(run).toBeDefined();
    if (run === undefined) return;

    const outcome = await replayFrom(
      await openManagement(SYSTEM_DATABASE_URL),
      run,
      1,
      { newWorkflowID: `${FAILED_RUN}_fork` },
    );

    expect(outcome.at).toBe('forked');

    const forked = await openDatabase(SYSTEM_DATABASE_URL);
    try {
      const rows = await forked.query<{ workflow_uuid: string }>(
        'SELECT workflow_uuid FROM dbos.workflow_status ' +
          'WHERE forked_from = $1',
        [FAILED_RUN],
      );

      expect(rows.map((row) => row.workflow_uuid)).toEqual([
        `${FAILED_RUN}_fork`,
      ]);
    } finally {
      await forked.close();
    }
  });
});
