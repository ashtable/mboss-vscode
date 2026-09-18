import type { Page } from '@playwright/test';

import type { ServiceHealth } from '../../../src/runs/stack.js';
import { shortRunId } from '../../../src/webview/ids.js';
import type {
  RunLineage,
  RunnableWorkflow,
  RunRow,
  RunsInit,
} from '../../../src/webview/protocol.js';

import {
  mount,
  type Harness,
  type MountOptions,
  type ThemeKind,
} from '../harness.js';
import { runsWords } from '../words.js';

/**
 * The Runs view's list, as the host would send it.
 *
 * Here rather than in the list's own spec because
 * more than one spec mounts the view, and Playwright
 * refuses a spec that imports another. The rows are
 * shaped the way the host shapes them: a short id is
 * the one the id rule gives, a line is one the host
 * would compose, and the controls are the ones the
 * status allows.
 */

/** One settled run, with whatever a case changes
 *  about it. */
export function listRow(over: Partial<RunRow> = {}): RunRow {
  return {
    workflowId: '7089cd29-881b-4319-a16d-1af70cc1e9a7',
    name: 'airtable_etl',
    status: 'SUCCESS',
    state: 'done',
    line: 'done · 18:24 · 1.6 s · 3 steps',
    recovered: false,
    recoveredNote: undefined,
    error: undefined,
    stoppedAt: undefined,
    operations: 3,
    lineage: [],
    startStep: undefined,
    failedStep: undefined,
    controls: { cancel: false, resume: false },
    ...over,
  };
}

/** Six finished runs of one workflow, newest first:
 *  what a person sees after an afternoon of trying
 *  one thing. */
export const SIX_DONE: RunRow[] = [
  ['7089cd29-881b-4319-a16d-1af70cc1e9a7', '18:24', '1.6'],
  ['4b56e4f6-4254-4423-bc97-b7a2d7838de9', '18:17', '1.5'],
  ['b6e3d1a0-19dd-4d4a-a03a-09e77cff2187', '18:17', '1.6'],
  ['72456056-c997-4a7a-b9fb-2195467f5634', '18:16', '1.9'],
  ['41265ad8-91c3-4a48-a595-95c353713808', '16:51', '1.9'],
  ['25c13fb7-c86c-4260-b2f0-e0fd4eab6020', '16:50', '2.3'],
].map(([workflowId, at, took]) =>
  listRow({ workflowId, line: `done · ${at} · ${took} s · 3 steps` }),
);

const PENDING = { cancel: true, resume: false };
const STOPPED = { cancel: false, resume: true };

/**
 * One run for every way a listed run can stand,
 * each with the controls its status allows.
 *
 * The ids are the three shapes a ledger holds: a
 * UUID, an id an older build minted, and a
 * scheduled firing's.
 */
export const BY_STATE = {
  done: listRow(),

  failed: listRow({
    workflowId: 'c1f0a2b3-5d6e-4f70-8a9b-0c1d2e3f4a5b',
    name: 'nightly_sync',
    status: 'ERROR',
    state: 'failed',
    line: 'failed · sync_rows · 18:20 · 1.2 s',
    error: 'login failed — CDC_PASS rotated',
    failedStep: 1,
  }),

  gaveUp: listRow({
    workflowId: 'run_1757612345_9f21ab33',
    name: 'nightly_sync',
    status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    state: 'failed',
    line: 'gave up · after load_records · 18:19',
    recovered: true,
    recoveredNote: 'recovered from 3 crashes · derived',
    operations: 2,
    controls: STOPPED,
  }),

  recoveredFailed: listRow({
    workflowId: 'd2e3f4a5-6b7c-4d8e-9f0a-1b2c3d4e5f60',
    name: 'nightly_sync',
    status: 'ERROR',
    state: 'failed',
    line: 'failed · sync_rows · 18:12 · 4.0 s · ↻ recovered',
    recovered: true,
    error: 'timeout after 30 s',
    failedStep: 2,
  }),

  waiting: listRow({
    workflowId: 'e3f4a5b6-7c8d-4e9f-8a1b-2c3d4e5f6a70',
    name: 'expense_claim',
    status: 'PENDING',
    state: 'waiting',
    line: 'waiting · manager_ok · since 18:15',
    stoppedAt: '18:15',
    operations: 1,
    controls: PENDING,
  }),

  running: listRow({
    workflowId: 'f4a5b6c7-8d9e-4f0a-9b1c-3d4e5f6a7b80',
    name: 'groom_booking',
    status: 'PENDING',
    state: 'running',
    line: 'running · after find_slot · 18:22',
    operations: 1,
    controls: PENDING,
  }),

  recovering: listRow({
    workflowId: 'a5b6c7d8-9e0f-4a1b-8c2d-4e5f6a7b8c90',
    name: 'groom_booking',
    status: 'PENDING',
    state: 'recovering',
    line: 'recovering · after find_slot · 18:21',
    recovered: true,
    operations: 1,
    controls: PENDING,
  }),

  queued: listRow({
    workflowId: 'sched-nightly_sync-2026-09-11T02:00:00.000Z',
    name: 'nightly_sync',
    status: 'ENQUEUED',
    state: 'queued',
    line: 'queued · 18:23',
    operations: undefined,
    controls: PENDING,
  }),

  cancelled: listRow({
    workflowId: 'b6c7d8e9-0f1a-4b2c-9d3e-5f6a7b8c9d01',
    name: 'groom_booking',
    status: 'CANCELLED',
    state: 'idle',
    line: 'cancelled · 18:10',
    operations: 1,
    controls: STOPPED,
  }),
} satisfies Record<string, RunRow>;

/** Every one of them, in the order the list draws
 *  them. */
export const LIST_ROWS: RunRow[] = Object.values(BY_STATE);

const PARENT = '41265ad8-91c3-4a48-a595-95c353713808';
const FIRST_FORK = '4b56e4f6-4254-4423-bc97-b7a2d7838de9';
const SECOND_FORK = 'b6e3d1a0-19dd-4d4a-a03a-09e77cff2187';
const ORPHAN = '72456056-c997-4a7a-b9fb-2195467f5634';

/** A run whose parent is further down the history
 *  than this page reaches. */
export const OFF_THE_PAGE = '25c13fb7-c86c-4260-b2f0-e0fd4eab6020';

function of(workflowId: string, startStep: number): RunLineage {
  return {
    direction: 'of',
    workflowId,
    short: shortRunId(workflowId),
    startStep,
  };
}

function to(workflowId: string, startStep: number, word: string): RunLineage {
  return {
    direction: 'to',
    workflowId,
    short: shortRunId(workflowId),
    startStep,
    word,
  };
}

/**
 * A failed run replayed twice, both replays on the
 * page, and a replay of a run that is not: the
 * lineage the host sends for each, as it reads it
 * off the page.
 */
export const LINEAGE = {
  parent: listRow({
    workflowId: PARENT,
    status: 'ERROR',
    state: 'failed',
    line: 'failed · load_records · 16:51 · 1.9 s',
    error: 'upstream 503',
    failedStep: 2,
    lineage: [to(FIRST_FORK, 2, 'done'), to(SECOND_FORK, 3, 'failed')],
  }),

  firstFork: listRow({
    workflowId: FIRST_FORK,
    line: 'done · replay of #4126 · 18:17 · 1.5 s · 3 steps',
    startStep: 2,
    lineage: [of(PARENT, 2)],
  }),

  secondFork: listRow({
    workflowId: SECOND_FORK,
    status: 'ERROR',
    state: 'failed',
    line: 'failed · replay of #4126 · push_rows · 18:17 · 1.6 s',
    error: 'upstream 503',
    startStep: 3,
    failedStep: 4,
    lineage: [of(PARENT, 3)],
  }),

  orphan: listRow({
    workflowId: ORPHAN,
    line: 'done · replay of #25c1 · 18:16 · 1.9 s · 3 steps',
    startStep: 1,
    lineage: [of(OFF_THE_PAGE, 1)],
  }),
} satisfies Record<string, RunRow>;

/** The whole message, with whatever a case changes
 *  about it. The host marks the newest row until
 *  somebody picks another, so the fixture does
 *  too. */
export function runsInit(over: Partial<RunsInit> = {}): RunsInit {
  const rows = over.rows ?? LIST_ROWS;

  return {
    type: 'init',
    view: 'runs',
    strings: runsWords,
    project: 'groom-shop',
    source: 'dbos.workflow_status · localhost:5432/app',
    state: 'ok',
    detail: undefined,
    filter: 'all',
    counts: { all: 9, active: 4, failed: 4 },
    rows,
    selected: rows[0]?.workflowId,
    stack: {
      available: true,
      answered: true,
      services: [
        {
          service: 'app',
          state: 'running',
          health: 'healthy',
          ports: [3000],
          detail: 'built 12 s ago · :3000',
        },
      ],
      busy: undefined,
      detail: undefined,
    },
    testRun: {
      workflows: [],
      selected: undefined,
      input: '',
      hint: undefined,
      problem: undefined,
    },
    production: { configured: false },
    ...over,
  };
}

/**
 * What compose says of a project that is up: two
 * services listening, and one the file declares
 * that nobody has left running.
 */
export const SERVICES: ServiceHealth[] = [
  {
    service: 'postgres',
    state: 'running',
    health: 'healthy',
    ports: [5432],
    detail: 'postgres:17 · :5432',
  },
  {
    service: 'app',
    state: 'running',
    health: 'healthy',
    ports: [3000],
    detail: 'built 12 s ago · :3000',
  },
  {
    service: 'worker',
    state: 'exited',
    health: 'none',
    ports: [],
    detail: 'exited (0)',
  },
];

/** One workflow somebody can start, and one that
 *  runs on its own. */
export const MANUAL: RunnableWorkflow = {
  name: 'groom_booking',
  title: 'Groom booking',
  mode: 'manual',
};

export const SCHEDULE: RunnableWorkflow = {
  name: 'nightly_sync',
  title: 'Nightly sync',
  mode: 'schedule',
};

/**
 * The panel over a project whose stack is up and
 * whose workflow can be started: the frame with
 * every part of it drawn.
 */
export function frameInit(over: Partial<RunsInit> = {}): RunsInit {
  return runsInit({
    stack: {
      available: true,
      answered: true,
      services: SERVICES,
      busy: undefined,
      detail: undefined,
    },
    testRun: {
      workflows: [MANUAL],
      selected: MANUAL.name,
      input: '',
      hint: undefined,
      problem: undefined,
    },
    ...over,
  });
}

export async function showList(
  page: Page,
  init: RunsInit,
  theme: ThemeKind = 'light',
  options: MountOptions = {},
): Promise<Harness> {
  const harness = await mount(page, 'runs', theme, options);
  await harness.show(init);

  return harness;
}
