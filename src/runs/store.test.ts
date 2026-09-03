import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticEntry } from '../acp/transcript.js';

import type { Database, OpenDatabase } from './db.js';
import type { ForkClient } from './replay.js';
import type { RunRequest, RunStart, RunStarter } from './runner.js';
import { sessionLog, type SessionRun } from './sessionLog.js';
import type { StackController, StackStatus } from './stack.js';
import { runsStore, type RunsDeps, type RunsHost } from './store.js';
import type { LiveRun, RunWatch } from './watch.js';

/**
 * What the window knows about a project's runs.
 *
 * Driven against collaborators that are functions,
 * because everything worth asserting here is about
 * what is read and when, and what is started and
 * under which id: that nothing is read or executed
 * before somebody has trusted the folder, that a
 * database which will not answer becomes a sentence
 * rather than an unhandled rejection, that every
 * connection opened is closed again, and that a run
 * the app refuses still leaves a row saying so.
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

/** The three trigger modes, one workflow each. */
const WORKFLOWS: Record<string, unknown> = {
  expense_claim: {
    mode: 'event',
    topic: 'expense.filed',
    idempotencyKeyPath: 'claimId',
  },
  groom_booking: { mode: 'manual' },
  nightly_sync: { mode: 'schedule', cron: '0 2 * * *' },
};

function workflowDocument(name: string, trigger: unknown): string {
  return JSON.stringify({
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 1,
    name,
    title: `The ${name}`,
    nodes: [
      { id: 'started', kind: 'trigger', title: 'Started', config: trigger },
    ],
    edges: [],
  });
}

function project(over: { env?: string; workflows?: string[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-runs-store-'));
  const workflows = join(dir, '.mboss', 'workflows');
  mkdirSync(workflows, { recursive: true });
  writeFileSync(
    join(dir, '.env'),
    over.env ?? 'DATABASE_URL=postgres://app@localhost:5432/app',
    'utf8',
  );

  for (const name of over.workflows ?? Object.keys(WORKFLOWS)) {
    writeFileSync(
      join(workflows, `${name}.workflow.json`),
      workflowDocument(name, WORKFLOWS[name]),
      'utf8',
    );
  }

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
    setContext: () => undefined,
    note: () => undefined,
    notify: async () => undefined,
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

const RUNNING: StackStatus = {
  available: true,
  services: [
    {
      service: 'postgres',
      state: 'running',
      health: 'healthy',
      detail: 'postgres:17 · :5432',
    },
    {
      service: 'app',
      state: 'running',
      health: 'healthy',
      detail: 'built 12 s ago · :3000',
    },
  ],
  detail: undefined,
};

const STOPPED: StackStatus = {
  available: true,
  services: [
    {
      service: 'app',
      state: 'exited',
      health: 'none',
      detail: 'built 3 h ago',
    },
  ],
  detail: undefined,
};

/** Compose, as a list of what it was asked to do. */
function stack(status: StackStatus = RUNNING): {
  calls: string[];
  status: StackStatus;
  controller: StackController;
} {
  const state = {
    calls: [] as string[],
    status,
    controller: {
      up: async (dir: string) => void state.calls.push(`up ${dir}`),
      rebuild: async (dir: string) => void state.calls.push(`rebuild ${dir}`),
      down: async (dir: string) => void state.calls.push(`down ${dir}`),
      status: async (dir: string) => {
        state.calls.push(`status ${dir}`);

        return state.status;
      },
      appOrigin: async () => 'http://127.0.0.1:3000',
    },
  };

  return state;
}

/** The ingress, as whatever it answers. */
function runner(answer: (request: RunRequest) => RunStart): {
  requests: RunRequest[];
  start: RunStarter;
} {
  const requests: RunRequest[] = [];

  return {
    requests,
    start: async (request) => {
      requests.push(request);

      return answer(request);
    },
  };
}

/**
 * An ingress that behaves: it starts the run under
 * the id it was handed, and mints one only where
 * the caller left that to it.
 */
function echoing(): { requests: RunRequest[]; start: RunStarter } {
  return runner((request) => ({
    ok: true,
    workflowId: request.workflowId ?? 'wf_echo',
  }));
}

/** The watcher, as the runs somebody armed one
 *  for. */
function watcher(): {
  armed: { workflowId: string; stopped: boolean }[];
  say(workflowId: string, run: LiveRun): void;
  watch: RunWatch;
} {
  const armed: {
    workflowId: string;
    stopped: boolean;
    onChange: (run: LiveRun) => void;
  }[] = [];

  return {
    armed,
    say: (workflowId, run) => {
      for (const held of armed) {
        if (held.workflowId === workflowId) held.onChange(run);
      }
    },
    watch: (_open, _url, workflowId, onChange) => {
      const held = { workflowId, stopped: false, onChange };
      armed.push(held);

      return {
        stop: () => {
          held.stopped = true;
        },
      };
    },
  };
}

function liveRun(over: Partial<LiveRun> = {}): LiveRun {
  return {
    workflowId: 'run_1',
    workflow: 'groom_booking',
    status: 'PENDING',
    steps: [{ name: 'parse_request', nodeId: 'parse_request', state: 'done' }],
    recovered: false,
    outcome: 'running',
    ...over,
  };
}

/**
 * Every collaborator, defaulted.
 *
 * A spec names the one it is about and takes the
 * rest as they come, so a test about the stack does
 * not have to describe an ingress it never
 * reaches.
 */
function deps(over: Partial<RunsDeps> = {}): RunsDeps {
  return {
    host: host(),
    open: async () => database(),
    openFork: async () => fork(),
    stack: stack().controller,
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    watch: watcher().watch,
    sessionLog: sessionLog(),
    ...over,
  };
}

describe('before there is anything to read', () => {
  it('opens nothing in a window with no project', async () => {
    const open = vi.fn();
    const store = runsStore(
      deps({ host: host(), open: open as unknown as OpenDatabase }),
    );

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
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()], isTrusted: () => false }),
        open: open as unknown as OpenDatabase,
      }),
    );

    await store.refresh();

    expect(store.list().state).toBe('untrusted');
    expect(open).not.toHaveBeenCalled();
  });

  it('says which variable is missing rather than failing quietly', async () => {
    const store = runsStore(
      deps({
        host: host({ projects: () => [project({ env: '# nothing\n' })] }),
      }),
    );

    await store.refresh();

    expect(store.list().state).toBe('unreachable');
    expect(store.list().detail).toContain('DATABASE_URL');
  });
});

describe('reading a project run history', () => {
  function open(db: Database): { store: ReturnType<typeof runsStore> } {
    return {
      store: runsStore(
        deps({
          host: host({ projects: () => [project()] }),
          open: async () => db,
        }),
      ),
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
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        open: async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:5432');
        },
      }),
    );

    await store.refresh();

    expect(store.list().state).toBe('unreachable');
    expect(store.list().detail).toContain('ECONNREFUSED');
  });
});

describe('replaying a step', () => {
  it('forks the run the panel is showing, from the step clicked', async () => {
    const client = fork();
    const said: string[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          say: (message) => said.push(message),
        }),
        openFork: async () => client,
      }),
    );

    await store.refresh();
    await store.select('wf_c9d2f3');
    await store.replay(0);

    expect(said[0]).toContain('wf_fork1');
    expect(said[0]).toContain('v0.4.1');
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all before a run has been picked', async () => {
    const client = fork();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        openFork: async () => client,
      }),
    );

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
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()], isTrusted: () => false }),
        openFork: async () => client,
      }),
    );

    await store.replay(0);

    expect(client.destroy).not.toHaveBeenCalled();
  });
});

describe('the local stack', () => {
  it('brings it up, takes it down, and rebuilds the app alone', async () => {
    const dir = project();
    const compose = stack();
    const store = runsStore(
      deps({
        host: host({ projects: () => [dir] }),
        stack: compose.controller,
      }),
    );

    await store.stackUp();
    await store.stackDown();
    await store.stackRebuild();

    expect(compose.calls.filter((call) => !call.startsWith('status'))).toEqual([
      `up ${dir}`,
      `down ${dir}`,
      `rebuild ${dir}`,
    ]);
  });

  it('reads what is running after every command', async () => {
    const compose = stack();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        stack: compose.controller,
      }),
    );

    await store.stackUp();

    expect(store.list().stack.services.map((row) => row.service)).toEqual([
      'postgres',
      'app',
    ]);
    expect(store.list().busy).toBeUndefined();
  });

  /**
   * The view's Start and Stop buttons swap on this
   * key, so it has to follow what compose says
   * rather than what was last asked for.
   */
  it('publishes whether anything is running', async () => {
    const published: { key: string; value: unknown }[] = [];
    const compose = stack(STOPPED);
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          setContext: (key, value) => published.push({ key, value }),
        }),
        stack: compose.controller,
      }),
    );

    await store.refresh();
    expect(published.at(-1)).toEqual({ key: 'mboss.stackUp', value: false });

    compose.status = RUNNING;
    await store.refresh();
    expect(published.at(-1)).toEqual({ key: 'mboss.stackUp', value: true });
  });

  /** Every one of these executes the folder's
   *  contents. */
  it('runs no command in a window nobody has trusted', async () => {
    const compose = stack();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()], isTrusted: () => false }),
        stack: compose.controller,
      }),
    );

    await store.stackUp();

    expect(compose.calls).toEqual([]);
  });

  it('says why nothing can run, when nothing can', async () => {
    const compose = stack({
      available: false,
      services: [],
      detail: 'Docker is not on the PATH',
    });
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        stack: compose.controller,
      }),
    );

    await store.refresh();

    expect(store.list().stack.available).toBe(false);
    expect(store.list().stack.detail).toContain('Docker');
  });
});

describe('the workflows a person can run', () => {
  it('offers what the project has saved, with their triggers', async () => {
    const store = runsStore(
      deps({ host: host({ projects: () => [project()] }) }),
    );

    await store.refresh();

    expect(
      store.list().workflows.map((flow) => `${flow.name}:${flow.trigger.mode}`),
    ).toEqual([
      'expense_claim:event',
      'groom_booking:manual',
      'nightly_sync:schedule',
    ]);
  });

  /**
   * The route mints the run id from this path, so
   * the same input is the same run — which is a
   * thing to say out loud beside the box somebody
   * is typing that input into.
   */
  it('hints at the idempotency key the picked workflow names', async () => {
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project({ workflows: ['expense_claim'] })],
        }),
      }),
    );

    await store.refresh();

    expect(store.list().hint).toContain('claimId');
  });

  it('has no hint for a workflow that names no key', async () => {
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project({ workflows: ['groom_booking'] })],
        }),
      }),
    );

    await store.refresh();

    expect(store.list().hint).toBeUndefined();
  });

  /**
   * The picker's own dropdown, not a second read of
   * the project: the hint and the last problem are
   * both about whichever workflow is selected, and a
   * new pick has to clear a problem left over from
   * the last one.
   */
  it('moves the hint and clears the last problem when a different workflow is picked', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'x',
    }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.refresh();
    await store.runWorkflow('groom_booking', '{}');
    expect(store.list().problem).toBeDefined();

    store.selectWorkflow('expense_claim');

    expect(store.list().workflow).toBe('expense_claim');
    expect(store.list().hint).toContain('claimId');
    expect(store.list().problem).toBeUndefined();
  });
});

describe('starting a run', () => {
  /**
   * The row exists before the request does, so a
   * start the app refuses lands on something
   * already on screen rather than arriving as a
   * toast that vanishes.
   */
  it('records a manual run under the id it will go out with', async () => {
    const log = sessionLog();
    let seen: SessionRun | undefined;
    const ingress = runner((request) => {
      seen = log.find(request.workflowId ?? '');

      return { ok: true, workflowId: request.workflowId ?? '' };
    });
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
        sessionLog: log,
      }),
    );

    await store.runWorkflow('groom_booking', '{"bookingId":7}');

    expect(seen?.outcome).toBe('running');
    expect(seen?.workflow).toBe('groom_booking');
    expect(ingress.requests[0]?.input).toEqual({ bookingId: 7 });
    expect(ingress.requests[0]?.trigger).toEqual({ mode: 'manual' });
    expect(log.list()).toHaveLength(1);
  });

  it('sends an event workflow to its own topic', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_echo' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('expense_claim', '{"claimId":"c-1"}');

    expect(ingress.requests[0]?.trigger).toEqual({
      mode: 'event',
      topic: 'expense.filed',
    });
    expect(store.list().session[0]?.workflowId).toBe('wf_echo');
  });

  it('refuses input that is not JSON, and sends nothing', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('groom_booking', '{ bookingId: ');

    expect(ingress.requests).toEqual([]);
    expect(store.list().problem).toBeDefined();
    expect(store.list().problem?.rebuildToRun).toBe(false);
    expect(store.list().session).toEqual([]);
  });

  it('marks a refused manual start failed, with what the route said', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'the app is not up',
    }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');

    const row = store.list().session[0];
    expect(row?.outcome).toBe('failed');
    expect(row?.error).toBe('the app is not up');
    expect(store.list().problem).toEqual({
      detail: 'the app is not up',
      rebuildToRun: false,
    });
  });

  /**
   * The container runs the image built at
   * `compose up`, so a workflow added since is not
   * in it. That is a Rebuild, not a status line.
   */
  it('says to rebuild the app when it has never heard of the workflow', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'rebuild-to-run',
      detail: 'no workflow named groom_booking',
    }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');

    expect(store.list().problem?.detail).toContain('Rebuild');
    expect(store.list().problem?.rebuildToRun).toBe(true);
  });

  /** An event run has no id to be keyed on until
   *  the app gives one. */
  it('remembers a refused event start under an id of its own', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'no EVENTS_SECRET',
    }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('expense_claim', '{}');

    const row = store.list().session[0];
    expect(row?.workflowId.startsWith('refused_')).toBe(true);
    expect(row?.error).toBe('no EVENTS_SECRET');
  });

  it('does not start a workflow that runs on a schedule', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('nightly_sync', '{}');

    expect(ingress.requests).toEqual([]);
    expect(store.list().session).toEqual([]);
  });

  it('starts nothing in a window nobody has trusted', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()], isTrusted: () => false }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');

    expect(ingress.requests).toEqual([]);
  });
});

describe('following a run', () => {
  it('watches what it started and keeps the row with it', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');

    // The id the row was recorded under before the
    // request went, which is what the route starts
    // the run as.
    const workflowId = store.list().session[0]?.workflowId ?? '';
    expect(watch.armed.map((held) => held.workflowId)).toEqual([workflowId]);

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'done',
        status: 'SUCCESS',
        steps: [
          { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
          { name: 'find_slot', nodeId: 'find_slot', state: 'done' },
        ],
      }),
    );

    expect(store.live()?.workflowId).toBe(workflowId);
    expect(store.list().session[0]?.outcome).toBe('done');
    expect(store.list().session[0]?.stepCount).toBe(2);
  });

  it('names the step that failed, with what the run recorded', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');
    const workflowId = store.list().session[0]?.workflowId ?? '';

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [{ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }],
      }),
    );

    expect(store.list().session[0]?.failedStep).toEqual({
      name: 'find_slot',
      error: 'login failed — CDC_PASS rotated',
    });
  });

  /**
   * A watch lets go of a run parked on a person and
   * of one that has gone quiet, and nothing re-arms
   * it on a timer. This is the button that does.
   */
  it('re-watches the runs that are still moving, and no others', async () => {
    const watch = watcher();
    const log = sessionLog();
    const outcomes = ['running', 'waiting', 'quiet', 'done', 'failed'] as const;

    for (const outcome of outcomes) {
      log.record({
        workflowId: `run_${outcome}`,
        workflow: 'groom_booking',
        input: {},
        startedAt: 1000,
        outcome,
        stepCount: 0,
        recovered: false,
      });
    }

    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        watch: watch.watch,
        sessionLog: log,
      }),
    );

    await store.refresh();

    expect(watch.armed.map((held) => held.workflowId).sort()).toEqual([
      'run_quiet',
      'run_running',
      'run_waiting',
    ]);
  });

  it('arms one watch per run, however often it is asked', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');
    await store.refresh();
    await store.refresh();

    expect(watch.armed).toHaveLength(1);
  });
});

describe('running it again', () => {
  it('sends the input the row was started with', async () => {
    const ingress = echoing();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('groom_booking', '{"bookingId":7}');
    const first = store.list().session[0]?.workflowId ?? '';

    await store.rerun(first);

    expect(ingress.requests).toHaveLength(2);
    expect(ingress.requests[1]?.input).toEqual({ bookingId: 7 });
    expect(ingress.requests[1]?.workflowId).not.toBe(first);
  });

  /**
   * The route mints an event run's id from the
   * payload, so the same input is the same run and
   * the app hands back the one that exists. A
   * second row would be a second run that never
   * happened.
   */
  it('selects the row an echoed id already names', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_echo' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.runWorkflow('expense_claim', '{"claimId":"c-1"}');
    await store.rerun('wf_echo');

    expect(ingress.requests).toHaveLength(2);
    expect(store.list().session).toHaveLength(1);
    expect(store.list().session[0]?.workflowId).toBe('wf_echo');
  });

  it('does nothing for a run it has never heard of', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        runner: ingress.start,
      }),
    );

    await store.rerun('wf_nothing');

    expect(ingress.requests).toEqual([]);
  });
});

describe('asking the agent why', () => {
  it('notes the failure and hands it over, naming step and error', async () => {
    const noted: DiagnosticEntry[] = [];
    const asked: string[] = [];
    const watch = watcher();
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          note: (entry) => noted.push(entry),
          notify: async (text) => void asked.push(text),
        }),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    await store.runWorkflow('groom_booking', '{}');
    const workflowId = store.list().session[0]?.workflowId ?? '';

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [{ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }],
      }),
    );

    await store.askAgent(workflowId);

    expect(noted[0]?.source).toContain(workflowId);
    expect(noted[0]?.rows[0]?.message).toContain('CDC_PASS');
    expect(asked[0]).toContain('groom_booking');
    expect(asked[0]).toContain('find_slot');
    expect(asked[0]).toContain('CDC_PASS');
  });

  it('says nothing about a run it has never heard of', async () => {
    const noted: DiagnosticEntry[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          note: (entry) => noted.push(entry),
        }),
      }),
    );

    await store.askAgent('run_nothing');

    expect(noted).toEqual([]);
  });
});
