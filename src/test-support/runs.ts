import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vi } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../core/rules.js';
import type { Database } from '../runs/db.js';
import type { ManagementClient } from '../runs/manage.js';
import { readRun } from '../runs/reading.js';
import {
  hasRecovered,
  storedValue,
  type Run,
  type Step,
} from '../runs/rows.js';
import type { RunRequest, RunStart, RunStarter } from '../runs/runner.js';
import type { StackController, StackStatus } from '../runs/stack.js';
import type { RunsHost } from '../runs/store.js';
import type {
  LedgerRead,
  LiveRun,
  LiveStep,
  QueueNode,
  RunWatch,
} from '../runs/watch.js';

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
  // Selected only where a single run is being read;
  // the double answers both statements with this
  // row, and a run page needs it.
  inputs: '[{"email":"ada@example.com"}]',
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
  active_runs: '1',
  failed_runs: '1',
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

/** A saved workflow document, as a fixture. Named
 *  for what it builds rather than for what it is,
 *  because the production reader of a saved document
 *  is called `savedDocument` and two different
 *  things must not share one name. */
export function savedWorkflow(name: string, trigger: unknown): string {
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
      savedWorkflow(name, WORKFLOWS[name]),
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
  steps: unknown[];
  forks: unknown[];
  fail: string | undefined;
} {
  const state = {
    closed: 0,
    asked: [] as string[],
    rows: [RUN_ROW] as unknown[],
    steps: [STEP_ROW] as unknown[],
    forks: [] as unknown[],
    fail: undefined as string | undefined,
    query: async <Row>(text: string, values: unknown[]): Promise<Row[]> => {
      state.asked.push(text);

      if (state.fail !== undefined) throw new Error(state.fail);

      // Told apart by what each one selects, or by
      // the clause only one of them has, rather than
      // by a fragment somewhere in it: the run list
      // counts blocks and reads where a replay began
      // in correlated subqueries, so `count(`,
      // `operation_outputs` and `AS last_reused` all
      // appear inside a statement that is none of
      // these.
      if (text.startsWith('SELECT count(*)')) return [COUNTS_ROW] as Row[];
      if (text.startsWith('SELECT function_id')) return state.steps as Row[];
      if (text.includes('WHERE f.forked_from = $1')) {
        return state.forks as Row[];
      }

      // A read of one run answers with that run's
      // row and no other. The run page reads a
      // second run by id — the one a replay came out
      // of — so a double that answered every by-id
      // read with the same row would say every run
      // was replayed from itself.
      if (text.includes('WHERE workflow_uuid = $1')) {
        return state.rows.filter((row) => idOf(row) === values[0]) as Row[];
      }

      return state.rows as Row[];
    },
    close: async () => {
      state.closed += 1;
    },
  };

  return state;
}

/** The id on a row a case set up, whatever else it
 *  put there. */
function idOf(row: unknown): unknown {
  return (row as { workflow_uuid?: unknown }).workflow_uuid;
}

export function host(over: Partial<RunsHost> = {}): RunsHost {
  return {
    projects: () => [],
    say: () => undefined,
    setContext: () => undefined,
    copy: async () => undefined,
    openCanvas: async () => undefined,
    openFile: async () => undefined,
    showText: async () => undefined,
    // English, which is what every expectation
    // below is written in.
    locale: () => 'en-US',
    // No Conductor, because that is the window every
    // spec here is about unless it says otherwise.
    conductorConsoleUrl: () => '',
    openExternal: async () => undefined,
    revealAgent: async () => undefined,
    // Nobody at the keyboard, which is what a spec
    // that has not said otherwise means.
    confirm: async () => ({ at: 'nothing' }),
    ...over,
  };
}

export function management(): ManagementClient & {
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    getLatestApplicationVersion: async () => ({ versionName: 'v0.4.1' }),
    forkWorkflow: async () => 'wf_fork1',
    cancelWorkflow: async () => undefined,
    resumeWorkflow: async () => undefined,
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
  armed: {
    workflowId: string;
    queueNodes: readonly QueueNode[];
    document: WorkflowIR | undefined;
    stopped: boolean;
  }[];
  say(workflowId: string, run: LiveRun, read?: LedgerRead): void;
  watch: RunWatch;
} {
  const armed: {
    workflowId: string;
    queueNodes: readonly QueueNode[];
    document: WorkflowIR | undefined;
    stopped: boolean;
    onChange: (run: LiveRun, read: LedgerRead) => void;
  }[] = [];

  return {
    armed,
    say: (workflowId, run, read = ledgerReadOf(run)) => {
      for (const held of armed) {
        if (held.workflowId === workflowId) held.onChange(run, read);
      }
    },
    watch: (_open, _url, workflowId, queueNodes, document, onChange) => {
      const held = {
        workflowId,
        queueNodes,
        document,
        stopped: false,
        onChange,
      };
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
    executorId: 'local-dev',
    steps: [liveStep()],
    recovered: false,
    recoveryAttempts: 1,
    outcome: 'running',
    applicationVersion: 'v0.1.0',
    createdAt: 1000,
    startedAt: 1000,
    completedAt: undefined,
    input: undefined,
    recordedInput: undefined,
    forkedFrom: undefined,
    ...over,
  };
}

/**
 * One step of a reading, with a default for
 * everything a caller is not saying anything about.
 *
 * What is drawn is read off what was recorded rather
 * than defaulted beside it: a case that gives an
 * output and not the print of it would otherwise put
 * a value on the panel that its own ledger row does
 * not hold. A case about the print itself still says
 * so and wins.
 */
export function liveStep(over: Partial<LiveStep> = {}): LiveStep {
  const recorded = { output: '{}', ...over };
  const value = storedValue(recorded.output ?? null);

  return {
    name: 'parse_request',
    nodeId: 'parse_request',
    state: 'done',
    functionId: 0,
    startedAt: 1000,
    completedAt: 1100,
    output: recorded.output,
    shown: recorded.output === undefined ? undefined : value.shown,
    outputCut: value.cut,
    bytes: value.bytes,
    absent: value.absent,
    error: undefined,
    childWorkflowId: undefined,
    restored: false,
    reused: false,
    ...over,
  };
}

/**
 * A workflow that waits on the clock: started by
 * hand, a minute of nothing, then one step.
 *
 * The document `mboss-e2e-tests` drives a real run
 * of, node ids and all. Parsed rather than asserted
 * because the walk that says which block wrote a
 * row is built from the same plan the emitter
 * writes from, and a document missing a default
 * would be a fixture the compiler cannot describe.
 */
export const TIMER_THEN_ANSWER: WorkflowIR = WorkflowIRSchema.parse({
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 1,
  name: 'timer_then_answer',
  title: 'Timer then answer',
  nodes: [
    {
      id: 'started_by_hand',
      kind: 'trigger',
      title: 'Started by hand',
      config: { mode: 'manual' },
      out: 'Enquiry',
    },
    {
      id: 'let_it_wait',
      kind: 'durableWait',
      title: 'Let it wait',
      config: {
        source: { kind: 'timer', seconds: 60 },
        onTimeout: 'abort',
      },
    },
    {
      id: 'answer_it',
      kind: 'step',
      title: 'Answer it',
      handler: { export: 'answerIt' },
      in: 'Enquiry',
      out: 'Answer',
      config: {},
    },
  ],
  edges: [
    {
      id: 'e1',
      from: { node: 'started_by_hand', port: 'out' },
      to: { node: 'let_it_wait' },
      type: 'Enquiry',
    },
    {
      id: 'e2',
      from: { node: 'let_it_wait', port: 'out' },
      to: { node: 'answer_it' },
      type: 'Enquiry',
    },
  ],
});

/** When that run started, and the moment its sleep
 *  row names as the one it is due to wake at. */
export const TIMER_STARTED_AT = 1000;
export const TIMER_WAKES_AT = 61_000;

/**
 * The rows one run of it wrote, as the ledger holds
 * them.
 *
 * The wait writes none of its own. A wait on the
 * clock compiles to a bare `DBOS.sleep`, and that
 * row's completion is the moment the run is due to
 * wake rather than a moment anything happened.
 * `answered` adds the step after it, which only a
 * run that has woken has written.
 */
export function timerThenAnswerRows(over: { answered?: boolean } = {}): Step[] {
  const sleep: Step = {
    functionId: 0,
    name: 'DBOS.sleep',
    startedAt: TIMER_STARTED_AT,
    completedAt: TIMER_WAKES_AT,
    output: String(TIMER_WAKES_AT),
    error: undefined,
    childWorkflowId: undefined,
  };

  if (over.answered !== true) return [sleep];

  return [
    sleep,
    {
      functionId: 1,
      name: 'answer_it',
      startedAt: TIMER_WAKES_AT,
      completedAt: TIMER_WAKES_AT + 200,
      output: '{}',
      error: undefined,
      childWorkflowId: undefined,
    },
  ];
}

/**
 * That run, as a watch reports one.
 *
 * `attributed` is what a reading with the document
 * beside it does to the sleep row: hands it to the
 * wait, where a reading without one leaves it the
 * SDK's and drops it on the way to a canvas. Both
 * pictures are built here, because the difference
 * between them is what the graph is drawn from.
 */
export function timerThenAnswerRun(
  over: { attributed?: boolean; answered?: boolean } = {},
): LiveRun {
  const sleeping = over.answered !== true;

  const sleep = liveStep({
    name: 'DBOS.sleep',
    nodeId: 'let_it_wait',
    state: sleeping ? 'waiting' : 'done',
    functionId: 0,
    startedAt: TIMER_STARTED_AT,
    completedAt: TIMER_WAKES_AT,
    output: String(TIMER_WAKES_AT),
  });

  return liveRun({
    workflowId: 'wf_timer',
    workflow: TIMER_THEN_ANSWER.name,
    status: sleeping ? 'PENDING' : 'SUCCESS',
    outcome: sleeping ? 'waiting' : 'done',
    createdAt: TIMER_STARTED_AT,
    startedAt: TIMER_STARTED_AT,
    completedAt: sleeping ? undefined : TIMER_WAKES_AT + 200,
    steps: [
      ...(over.attributed === true ? [sleep] : []),
      ...(sleeping
        ? []
        : [
            liveStep({
              name: 'answer_it',
              nodeId: 'answer_it',
              functionId: 1,
              startedAt: TIMER_WAKES_AT,
              completedAt: TIMER_WAKES_AT + 200,
            }),
          ]),
    ],
  });
}

/**
 * The intake form's own document: a form sent, a
 * wait on the answer that gives up after three
 * days, and a step that records it.
 *
 * Core's fixture rather than a copy, because core's
 * walk is what gives the wait the `DBOS.recv` and
 * `DBOS.sleep` it parks on, and a copy that drifted
 * from the plan the emitter writes would be a
 * document the walk no longer describes.
 */
export const FORM_INTAKE: WorkflowIR = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../mboss-core/fixtures/ir/form_intake.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

/**
 * The rows a tick would have read to produce a
 * reading, for a double that is only pretending to
 * have read any.
 *
 * Named for what it builds rather than for what it
 * is: `runs/evidence.ts` has a `ledgerRead` of its
 * own that asks a real database, and two different
 * things must not share one name.
 */
export function ledgerReadOf(run: LiveRun): LedgerRead {
  const row: Run = {
    workflowId: run.workflowId,
    name: run.workflow,
    status: run.status,
    recoveryAttempts: run.recoveryAttempts,
    executorId: run.executorId,
    applicationVersion: run.applicationVersion,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    forkedFrom: run.forkedFrom,
    wasForkedFrom: false,
  };
  const steps: Step[] = run.steps.map((step) => ({
    functionId: step.functionId,
    name: step.name,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    output: step.output,
    error: step.error?.message,
    childWorkflowId: step.childWorkflowId,
  }));

  // Attributed the way a watch attributes them: by
  // the grammar alone, with no drawing to gate on.
  return {
    run: row,
    steps,
    operations: readRun(row, steps, 'unasked', hasRecovered(row), 0, undefined)
      .steps,
  };
}
