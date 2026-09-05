import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import type { Database } from '../runs/db.js';
import type { ForkClient } from '../runs/replay.js';
import type { RunRequest, RunStart, RunStarter } from '../runs/runner.js';
import type { StackController, StackStatus } from '../runs/stack.js';
import type { RunsHost } from '../runs/store.js';
import type { LiveRun, RunWatch } from '../runs/watch.js';

/**
 * The runs panel's collaborators, faked one at a
 * time.
 *
 * The store is three zones behind one façade, and
 * each zone's spec builds only the collaborators
 * that zone reaches: the history a database and a
 * fork client, the stack zone a compose controller,
 * the test run an ingress, a watch and a session
 * log. These are those, shared so that a project
 * with a `.env` and three saved workflows reads the
 * same in every spec.
 */

export const RUN_ROW = {
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

export const STEP_ROW = {
  function_id: 0,
  function_name: 'parse_request',
  started_at_epoch_ms: '1000',
  completed_at_epoch_ms: '1200',
  output: '{}',
  error: null,
  child_workflow_id: null,
  serialization: null,
};

export const COUNTS_ROW = {
  all_runs: '6',
  failed_runs: '1',
  recovered_runs: '1',
};

export const WORKFLOWS: Record<string, unknown> = {
  expense_claim: {
    mode: 'event',
    topic: 'expense.filed',
    idempotencyKeyPath: 'claimId',
  },
  groom_booking: { mode: 'manual' },
  nightly_sync: { mode: 'schedule', cron: '0 2 * * *' },
};

export function workflowDocument(name: string, trigger: unknown): string {
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

/** A project with a `.env` and some saved
 *  workflows, in a directory of its own. */
export function project(
  over: { env?: string; workflows?: string[] } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-runs-'));
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

/** The connection string `project()` writes. */
export const LEDGER_URL = 'postgres://app@localhost:5432/app';

export function database(): Database & {
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

export function host(over: Partial<RunsHost> = {}): RunsHost {
  return {
    projects: () => [],
    say: () => undefined,
    setContext: () => undefined,
    note: () => undefined,
    notify: async () => undefined,
    ...over,
  };
}

export function fork(): ForkClient & { destroy: ReturnType<typeof vi.fn> } {
  return {
    getLatestApplicationVersion: async () => ({ versionName: 'v0.4.1' }),
    forkWorkflow: async () => 'wf_fork1',
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

export const RUNNING: StackStatus = {
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

export const STOPPED: StackStatus = {
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

export function stack(status: StackStatus = RUNNING): {
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

export function runner(answer: (request: RunRequest) => RunStart): {
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

/** An ingress that starts whatever it is asked to,
 *  under the id it was handed. */
export function echoing(): { requests: RunRequest[]; start: RunStarter } {
  return runner((request) => ({
    ok: true,
    workflowId: request.workflowId ?? 'wf_echo',
  }));
}

export function watcher(): {
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

export function liveRun(over: Partial<LiveRun> = {}): LiveRun {
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
