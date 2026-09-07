import { expect, test, type Page } from '@playwright/test';

import type {
  RunRow,
  RunsInit,
  SeeGraph,
  SeeInit,
  SeeRun,
  TraceGroupView,
} from '../../src/webview/protocol.js';

import { liveRun, liveStep } from '../../src/test-support/runs.js';

import { paletteLabels } from './words.js';

import { mount, type Harness } from './harness.js';
import { runsWords as runsStrings, seeWords as seeStrings } from './words.js';

/**
 * A run history, on screen.
 *
 * Two surfaces. The list is a ledger read top to
 * bottom, where a failure says what it was on its
 * own row. The detail is the page that makes this
 * product's argument: a workflow survived a crash
 * because its steps are rows in Postgres, so the
 * page shows the rows and marks the steps that came
 * back from them rather than running again.
 *
 * The words are the ones sent in, as everywhere in
 * these specs; that the extension resolves the
 * right ones is checked where the extension is.
 */

const ROWS: RunRow[] = [
  {
    workflowId: 'wf_c9d2f3',
    name: 'groom_booking',
    status: 'SUCCESS',
    severity: 'ok',
    when: '14:02 · 8.2 s',
    recovered: true,
    recoveredNote: undefined,
    error: undefined,
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
  },
  {
    workflowId: 'wf_a1b4e7',
    name: 'groom_booking',
    status: 'SUCCESS',
    severity: 'ok',
    when: '13:57 · 4.8 s',
    recovered: false,
    recoveredNote: undefined,
    error: undefined,
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
  },
  {
    workflowId: 'wf_77c101',
    name: 'nightly_sync',
    status: 'ERROR',
    severity: 'failed',
    when: '13:41 · 1.2 s',
    recovered: false,
    recoveredNote: undefined,
    error: 'login failed — CDC_PASS rotated',
    summary: 'failed · sync_rows',
    stoppedAt: '13:41',
    operations: 3,
  },
  {
    workflowId: 'wf_ff0912',
    name: 'nightly_sync',
    status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    severity: 'exhausted',
    when: '13:20 · 61.0 s',
    recovered: true,
    recoveredNote: 'recovered from 3 crashes',
    error: 'gave up after 3 attempts',
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
  },
];

function runsInit(over: Partial<RunsInit> = {}): RunsInit {
  return {
    type: 'init',
    view: 'runs',
    strings: runsStrings,
    project: 'groom-shop',
    source: 'dbos.workflow_status · localhost:5432/app',
    state: 'ok',
    detail: undefined,
    filter: 'all',
    counts: { all: 6, failed: 1, recovered: 1 },
    rows: ROWS,
    selected: undefined,
    stack: {
      available: true,
      services: [],
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
    live: undefined,
    session: [],
    production: { configured: false },
    ...over,
  };
}

const STEP_NAMES = ['parse_request', 'find_slot', 'book_appointment'];

/** What the host says over a run whose workflow the
 *  project no longer has. */
const NO_SAVED_WORKFLOW = 'no saved workflow named groom_booking · trace only';

function seeRun(over: Partial<SeeRun> = {}): SeeRun {
  return {
    workflowId: 'wf_c9d2f3',
    name: 'groom_booking',
    breadcrumb: 'mBoss › runs › groom_booking › wf_c9d2f3',
    headline: 'SUCCESS · 8.2 s total',
    severity: 'ok',
    span: 'started 14:02:11 · finished 14:02:19',
    recovered: {
      heading: 'Recovered — completed durable operations were not re-executed',
      body:
        'DBOS picked this run back up. Both figures are derived from the ' +
        'widest gap between recorded operations — the durable operations ' +
        'that finished before that gap were reused from ' +
        'dbos.operation_outputs rather than run again.',
      figures: {
        down: 'nothing ran for about 2.9 s',
        reused: '2 durable operations reused',
      },
    },
    chips: STEP_NAMES.map((name, index) => ({
      functionId: index,
      name,
      restored: index < 2,
      failed: false,
    })),
    timeline: {
      bars: STEP_NAMES.map((name, index) => ({
        functionId: index,
        name,
        at: { from: index * 0.1, width: 0.08 },
        restored: index < 2,
        failed: false,
      })),
      outage: {
        from: 0.2,
        width: 0.35,
        down: 'process down · 2.9 s',
        resumed: 'resumed by DBOS',
      },
      ticks: [
        { at: 0, label: '14:02:11' },
        { at: 0.2, label: '14:02:15' },
        { at: 0.55, label: '14:02:18' },
        { at: 1, label: '14:02:19' },
      ],
    },
    raw: STEP_NAMES.map((name, index) => ({
      stepId: index,
      fn: name,
      output: `{"n":${index}}`,
      committedAt: `14:02:1${index}`,
    })),
    rail: [
      { label: 'workflow_uuid', value: 'wf_c9d2f3' },
      { label: 'status', value: 'SUCCESS' },
      { label: 'recovery_attempts', value: '2' },
      { label: 'executor_id', value: 'local-dev' },
    ],
    selectedStep: 2,
    note: undefined,
    graph: undefined,
    // Set to match, the way the host sets it: the
    // sentence is there exactly where the picture
    // is not.
    noGraph: over.graph === undefined ? NO_SAVED_WORKFLOW : undefined,
    live: liveRun({
      workflowId: 'wf_c9d2f3',
      workflow: 'groom_booking',
      status: 'ERROR',
      outcome: 'failed',
      steps: [
        liveStep({ name: 'parse_request', nodeId: 'parse_request' }),
        liveStep({
          name: 'find_slot',
          nodeId: 'find_slot',
          state: 'failed',
          functionId: 1,
        }),
      ],
    }),
    groups: [],
    selected: { nodeId: undefined, functionId: 2 },
    showRaw: false,
    following: 'quiet',
    input: undefined,
    ...over,
  };
}

/** The trace by default: most of what this page
 *  draws is on that side, and the graph cases say
 *  so for themselves. */
function seeInit(
  run: SeeRun = seeRun(),
  showing: 'graph' | 'trace' = 'trace',
): SeeInit {
  return { type: 'init', view: 'see', strings: seeStrings, run, showing };
}

/** Before a run has been picked. A separate helper
 *  rather than `seeInit(undefined)`, which a
 *  default argument would quietly turn back into a
 *  run. */
function seeNothing(): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeStrings,
    run: undefined,
    showing: 'graph',
  };
}

async function showList(page: Page, init: RunsInit): Promise<Harness> {
  const harness = await mount(page, 'runs');
  await harness.show(init);

  return harness;
}

async function showRun(page: Page, init: SeeInit): Promise<Harness> {
  const harness = await mount(page, 'see');
  await harness.show(init);

  return harness;
}

/** The warn colour, as the light theme resolves it.
 *  Recovery is drawn in it wherever it is drawn. */
const WARN = 'rgb(233, 162, 59)';

/** The tint of it a whole surface is washed in. */
const WARN_TINT = 'color(srgb 0.964314 0.925333 0.868784)';

function tagColour(page: Page, runId: string): Promise<string> {
  return page
    .locator(`[data-run="${runId}"] .run-tag`)
    .evaluate((node) => getComputedStyle(node).color);
}

test.describe('the local stack', () => {
  test('draws a row per service and names the one about to run', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        stack: {
          available: true,
          busy: undefined,
          detail: undefined,
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
        },
      }),
    );

    const app = page.locator('[data-service="app"]');
    await expect(app).toContainText('built 12 s ago · :3000');
    await expect(app).toContainText('running');
    await expect(
      page.locator('[data-service="postgres"] [data-rebuild]'),
    ).toHaveCount(0);
  });

  test('offers Start when nothing is running, and Stop once it is', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({
        stack: {
          available: true,
          busy: undefined,
          detail: undefined,
          services: [
            { service: 'app', state: 'exited', health: 'none', detail: '' },
          ],
        },
      }),
    );

    await expect(page.locator('[data-stack-toggle]')).toHaveText('Start');
    await page.locator('[data-stack-toggle]').click();
    expect(await harness.postedOfType('stackUp')).toEqual([
      { type: 'stackUp' },
    ]);

    await harness.show(
      runsInit({
        stack: {
          available: true,
          busy: undefined,
          detail: undefined,
          services: [
            { service: 'app', state: 'running', health: 'healthy', detail: '' },
          ],
        },
      }),
    );

    await expect(page.locator('[data-stack-toggle]')).toHaveText('Stop');
    await page.locator('[data-stack-toggle]').click();
    expect(await harness.postedOfType('stackDown')).toEqual([
      { type: 'stackDown' },
    ]);
  });

  test('rebuilds the app alone', async ({ page }) => {
    const harness = await showList(
      page,
      runsInit({
        stack: {
          available: true,
          busy: undefined,
          detail: undefined,
          services: [
            {
              service: 'app',
              state: 'running',
              health: 'healthy',
              detail: 'built 1 h ago',
            },
          ],
        },
      }),
    );

    await page.locator('[data-service="app"] [data-rebuild]').click();

    expect(await harness.postedOfType('stackRebuild')).toEqual([
      { type: 'stackRebuild' },
    ]);
  });

  test('says why there is nothing to start, when there is nothing', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        stack: {
          available: false,
          busy: undefined,
          detail: 'Docker is not on the PATH.',
          services: [],
        },
      }),
    );

    await expect(page.locator('[data-zone="stack"]')).toContainText(
      'Docker is not on the PATH.',
    );
    await expect(page.locator('[data-stack-toggle]')).toHaveCount(0);
  });
});

test.describe('a test run', () => {
  const WORKFLOWS = [
    { name: 'groom_booking', title: 'Groom booking', mode: 'manual' as const },
    { name: 'nightly_sync', title: 'Nightly sync', mode: 'schedule' as const },
  ];

  test('picks a workflow, types input, and sends both', async ({ page }) => {
    const harness = await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '',
          hint: undefined,
          problem: undefined,
        },
      }),
    );

    await expect(page.locator('[data-workflow-picker]')).toHaveValue(
      'groom_booking',
    );
    await page.locator('[data-input]').fill('{"bookingId":7}');
    await page.locator('[data-run-workflow]').click();

    expect(await harness.postedOfType('runWorkflow')).toEqual([
      {
        type: 'runWorkflow',
        workflow: 'groom_booking',
        input: '{"bookingId":7}',
      },
    ]);
  });

  test('tells the extension a different workflow was picked', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '',
          hint: undefined,
          problem: undefined,
        },
      }),
    );

    await page.locator('[data-workflow-picker]').selectOption('nightly_sync');

    expect(await harness.postedOfType('selectWorkflow')).toEqual([
      { type: 'selectWorkflow', workflow: 'nightly_sync' },
    ]);
  });

  /** A scheduled workflow is listed so a person can
   *  see it exists, and offers no way to run it by
   *  hand. */
  test('says a scheduled workflow runs on its own', async ({ page }) => {
    await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'nightly_sync',
          input: '',
          hint: undefined,
          problem: undefined,
        },
      }),
    );

    await expect(page.locator('[data-zone="test-run"]')).toContainText(
      'runs on its schedule',
    );
    await expect(page.locator('[data-run-workflow]')).toHaveCount(0);
  });

  test('shows the idempotency hint for the workflow now picked', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '',
          hint: 'claimId is the idempotency key · a new value is a new run',
          problem: undefined,
        },
      }),
    );

    await expect(page.locator('[data-zone="test-run"]')).toContainText(
      'claimId is the idempotency key',
    );
  });

  test('says the app is stale and offers the same Rebuild', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '',
          hint: undefined,
          problem: {
            detail: 'The running app was built before this workflow.',
            rebuildToRun: true,
          },
        },
      }),
    );

    const problem = page.locator('[data-problem]');
    await expect(problem).toContainText('built before this workflow');
    await problem.locator('[data-rebuild]').click();

    expect(await harness.postedOfType('stackRebuild')).toEqual([
      { type: 'stackRebuild' },
    ]);
  });

  test('offers no Rebuild for a problem Rebuild does not fix', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '',
          hint: undefined,
          problem: {
            detail: 'That input is not JSON, so nothing was sent.',
            rebuildToRun: false,
          },
        },
      }),
    );

    await expect(page.locator('[data-problem]')).toContainText('not JSON');
    await expect(page.locator('[data-problem] [data-rebuild]')).toHaveCount(0);
  });
});

test.describe('the run being followed', () => {
  const LIVE = {
    workflowId: 'run_1_a1b2',
    workflow: 'groom_booking',
    status: 'PENDING',
    steps: [
      liveStep({ name: 'find_slot', nodeId: 'find_slot' }),
      liveStep({
        name: 'book',
        nodeId: 'book',
        state: 'waiting',
        functionId: 1,
      }),
    ],
    recovered: false,
    recoveryAttempts: 1,
    outcome: 'running' as const,
    error: undefined,
    applicationVersion: 'v0.1.0',
    createdAt: 1000,
    startedAt: 1000,
    completedAt: undefined,
    input: undefined,
    forkedFrom: undefined,
  };

  test('marks each step with what the ledger says about it', async ({
    page,
  }) => {
    await showList(page, runsInit({ live: LIVE }));

    await expect(
      page.locator('[data-zone="running-now"] [data-state="done"]'),
    ).toContainText('find_slot');
    await expect(
      page.locator('[data-zone="running-now"] [data-state="waiting"]'),
    ).toContainText('book');
  });

  /**
   * The two ways a watch stops itself, kept apart:
   * a parked run is waiting on a person, a quiet one
   * is waiting on nobody.
   */
  test('tells a parked run apart from one that went quiet', async ({
    page,
  }) => {
    await showList(page, runsInit({ live: { ...LIVE, outcome: 'waiting' } }));
    await expect(page.locator('[data-zone="running-now"]')).toContainText(
      'waiting · refresh to check',
    );

    await showList(page, runsInit({ live: { ...LIVE, outcome: 'quiet' } }));
    await expect(page.locator('[data-zone="running-now"]')).toContainText(
      'quiet · refresh to check',
    );
  });

  test('draws nothing when no run is being followed', async ({ page }) => {
    await showList(page, runsInit({ live: undefined }));

    await expect(page.locator('[data-zone="running-now"]')).toHaveCount(0);
  });
});

test.describe('this session', () => {
  test('offers a rerun for a manual workflow', async ({ page }) => {
    const harness = await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_1',
            workflow: 'groom_booking',
            outcome: 'done',
            when: '14:02 · 8.2 s',
            stepCount: 3,
            recovered: false,
            error: undefined,
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    const row = page.locator('[data-session-row="run_1"]');
    await expect(row).toHaveAttribute('data-outcome', 'done');
    await expect(row.locator('[data-rerun]')).toHaveText(
      'Rerun with same input',
    );

    await row.locator('[data-rerun]').click();
    expect(await harness.postedOfType('rerun')).toEqual([
      { type: 'rerun', workflowId: 'run_1' },
    ]);

    await row.locator('[data-open-run]').click();
    expect(await harness.postedOfType('openRun')).toEqual([
      { type: 'openRun', workflowId: 'run_1' },
    ]);
  });

  /** The route mints the id from the event's own key,
   *  so sending it again is the same run — the row
   *  says that rather than offering a rerun. */
  test('offers to send the event again for a keyed workflow', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_2',
            workflow: 'expense_claim',
            outcome: 'done',
            when: '14:05',
            stepCount: 1,
            recovered: false,
            error: undefined,
            keyed: true,
            via: 'start',
          },
        ],
      }),
    );

    await expect(
      page.locator('[data-session-row="run_2"] [data-rerun]'),
    ).toHaveText('Send the event again');
  });

  /**
   * A fork was never handed an input in this
   * window: it carries the input of the run it came
   * from, and that lives in the ledger. There is
   * nothing here to send again, so the row does not
   * offer to — not even for a workflow whose events
   * are keyed, where the label would otherwise read
   * as sending the same one twice.
   */
  test('offers no Rerun on a replayed row', async ({ page }) => {
    await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_9',
            workflow: 'expense_claim',
            outcome: 'running',
            when: '14:11',
            stepCount: 1,
            recovered: false,
            error: undefined,
            keyed: true,
            via: 'replay',
          },
        ],
      }),
    );

    const row = page.locator('[data-session-row="run_9"]');
    await expect(row.locator('[data-open-run]')).toHaveCount(1);
    await expect(row.locator('[data-rerun]')).toHaveCount(0);
  });

  test('asks the agent why, only where there is a failure to ask about', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_3',
            workflow: 'groom_booking',
            outcome: 'failed',
            when: '14:09',
            stepCount: 2,
            recovered: false,
            error: 'CDC_PASS rotated',
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    const row = page.locator('[data-session-row="run_3"]');
    await expect(row).toContainText('CDC_PASS rotated');
    await row.locator('[data-ask-agent]').click();

    expect(await harness.postedOfType('askAgent')).toEqual([
      { type: 'askAgent', workflowId: 'run_3' },
    ]);
  });

  test('has no Ask agent why on a run that has not failed', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_4',
            workflow: 'groom_booking',
            outcome: 'done',
            when: '14:11',
            stepCount: 2,
            recovered: false,
            error: undefined,
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    await expect(
      page.locator('[data-session-row="run_4"] [data-ask-agent]'),
    ).toHaveCount(0);
  });

  /**
   * A run this window started is a row here once it
   * is written to the database, not two — one here
   * and a second one in the plain ledger below.
   */
  test('draws a run only once it also has a row in the ledger', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        rows: [
          {
            workflowId: 'wf_c9d2f3',
            name: 'groom_booking',
            status: 'SUCCESS',
            severity: 'ok',
            when: '14:02 · 8.2 s',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: undefined,
            stoppedAt: undefined,
            operations: undefined,
          },
        ],
        session: [
          {
            workflowId: 'wf_c9d2f3',
            workflow: 'groom_booking',
            outcome: 'done',
            when: '14:02 · 8.2 s',
            stepCount: 3,
            recovered: false,
            error: undefined,
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    await expect(page.locator('[data-session-row="wf_c9d2f3"]')).toHaveCount(1);
    await expect(page.locator('.run-rows [data-run="wf_c9d2f3"]')).toHaveCount(
      0,
    );
  });
});

test.describe('the footer', () => {
  test('says where this session lives, beside the durable truth', async ({
    page,
  }) => {
    await showList(page, runsInit());

    await expect(page.locator('.runs-foot')).toContainText(
      'held in the extension host for this session',
    );
    await expect(page.locator('.runs-foot')).toContainText(
      'dbos.workflow_status',
    );
  });

  /**
   * Conductor is a licence this product does not
   * need, so a window that has none is never told
   * about one. The line is provenance — where runs
   * other than these live — and belongs beside the
   * ledger it names rather than beside Run or
   * Rebuild.
   */
  test('offers Conductor only when it is configured', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await expect(page.locator('[data-production="configured"]')).toHaveCount(0);
    await expect(page.locator('[data-open-production]')).toHaveCount(0);

    await harness.show(runsInit({ production: { configured: true } }));

    await expect(page.locator('[data-production="configured"]')).toContainText(
      'DBOS Conductor · configured',
    );
    await page.locator('[data-open-production]').click();

    expect(await harness.postedOfType('openProduction')).toEqual([
      { type: 'openProduction' },
    ]);
  });
});

test.describe('the run list', () => {
  test('offers the three filters with what each would show', async ({
    page,
  }) => {
    await showList(page, runsInit());

    await expect(page.locator('[data-filter="all"]')).toContainText('6');
    await expect(page.locator('[data-filter="failed"]')).toContainText('1');
    await expect(page.locator('[data-filter="recovered"]')).toContainText('1');

    await expect(page.locator('[data-filter="all"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('asks the extension for a different filter', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-filter="failed"]').click();

    expect(await harness.postedOfType('runFilter')).toEqual([
      { type: 'runFilter', filter: 'failed' },
    ]);
  });

  /**
   * The three states the design draws, told apart
   * without reading anything: a mark, an accent rule
   * down the edge of a run that recovered, and the
   * failure in the failure colour.
   */
  test('draws a plain success, a recovered one and a failure apart', async ({
    page,
  }) => {
    await showList(page, runsInit());

    const recovered = page.locator('[data-run="wf_c9d2f3"]');
    await expect(recovered).toHaveAttribute('data-recovered', 'true');
    await expect(recovered).toContainText('↻ recovered');
    await expect(recovered).toContainText('14:02 · 8.2 s');

    const plain = page.locator('[data-run="wf_a1b4e7"]');
    await expect(plain).toHaveAttribute('data-recovered', 'false');
    await expect(plain).not.toContainText('↻ recovered');

    const failed = page.locator('[data-run="wf_77c101"]');
    await expect(failed).toHaveAttribute('data-severity', 'failed');
    await expect(failed).toContainText('login failed — CDC_PASS rotated');
  });

  /**
   * A run parked on somebody is `PENDING` in the
   * status column, exactly like one that is
   * executing a step. What tells them apart is the
   * shape of the last operation, and the row says
   * which block and since when.
   */
  test('marks a run waiting on a person, and says since when', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        rows: [
          {
            workflowId: 'wf_parked',
            name: 'expense_claim',
            status: 'PENDING',
            severity: 'waiting',
            when: '14:06',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: 'waiting · manager_ok · 10:31',
            stoppedAt: '10:31',
            operations: 4,
          },
        ],
      }),
    );

    const row = page.locator('[data-run="wf_parked"]');

    await expect(row.locator('.run-mark')).toHaveText('◐');

    const summary = row.locator('.run-summary');
    await expect(summary).toHaveText('waiting · manager_ok · 10:31');
    await expect(summary).toHaveAttribute('data-stopped-at', '10:31');
    await expect(summary).toHaveAttribute('data-derived', 'true');
    await expect(summary).toHaveAttribute('title', runsStrings.derivedTitle);
  });

  test('hands the id of a row to the window', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-copy-run-id="wf_c9d2f3"]').click();

    expect(await harness.postedOfType('copyRunId')).toEqual([
      { type: 'copyRunId', workflowId: 'wf_c9d2f3' },
    ]);
  });

  /**
   * Nothing on this panel is a service somewhere.
   * The footer names the two tables the list is
   * projected from, in the project's own database.
   */
  test('says the list is a projection of the local ledger', async ({
    page,
  }) => {
    await showList(page, runsInit());

    await expect(page.locator('.runs-foot')).toContainText(
      'local only · projected from the local DBOS ledger: ' +
        'dbos.workflow_status + dbos.operation_outputs',
    );
  });

  /**
   * The accent rule is the one ornament on a row, so
   * it has to be a rule a person can see and not
   * just an attribute a test can read.
   *
   * Recovery is drawn in the warn colour and not in
   * the brand one, everywhere it is drawn: a run
   * DBOS picked back up is a thing that happened to
   * the run, and the brand colour means a person or
   * the product did this. The literal is the light
   * theme's, which is what the harness mounts.
   */
  test('rules the edge of a recovered row in the accent', async ({ page }) => {
    await showList(page, runsInit());

    const edge = await page
      .locator('[data-run="wf_c9d2f3"]')
      .evaluate((node) => getComputedStyle(node).borderLeftColor);
    const plain = await page
      .locator('[data-run="wf_a1b4e7"]')
      .evaluate((node) => getComputedStyle(node).borderLeftColor);

    expect(edge).not.toBe(plain);
    expect(edge).toBe(WARN);
    expect(await tagColour(page, 'wf_c9d2f3')).toBe(WARN);
  });

  /**
   * No mockup draws a run DBOS gave up recovering.
   * It is a failure and it is not the same news as
   * one that threw, so it gets its own mark — and
   * this is where that decision is pinned.
   */
  test('marks a run DBOS gave up on apart from one that threw', async ({
    page,
  }) => {
    await showList(page, runsInit());

    const exhausted = page.locator('[data-run="wf_ff0912"]');
    await expect(exhausted).toHaveAttribute('data-severity', 'exhausted');
    await expect(exhausted).toContainText('gave up after 3 attempts');

    const mark = (run: string): Promise<string | null> =>
      page.locator(`[data-run="${run}"] .run-mark`).textContent();

    expect(await mark('wf_ff0912')).not.toBe(await mark('wf_77c101'));
  });

  test('opens a run when its row is clicked', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_77c101"]').click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_77c101' },
    ]);
  });

  /** The boundary the design draws, drawn where a
   *  person can see it. */
  test('says what it is reading and what it is not', async ({ page }) => {
    await showList(page, runsInit());

    await expect(page.locator('.runs-foot')).toContainText(
      'dbos.workflow_status · localhost:5432/app',
    );
    await expect(page.locator('.runs-foot')).toContainText('DBOS Conductor');
  });

  test('says why there is no list, when there is none', async ({ page }) => {
    await showList(
      page,
      runsInit({
        state: 'untrusted',
        rows: [],
        counts: { all: 0, failed: 0, recovered: 0 },
      }),
    );

    await expect(page.locator('.state')).toHaveText(runsStrings.untrusted);
    await expect(page.locator('.run-row')).toHaveCount(0);
  });

  test('says a database would not answer, and what it said', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        state: 'unreachable',
        detail: 'That database would not answer: ECONNREFUSED',
        rows: [],
      }),
    );

    await expect(page.locator('.state')).toContainText('ECONNREFUSED');
  });
});

test.describe('one run in detail', () => {
  test('says which run it is and how it went', async ({ page }) => {
    await showRun(page, seeInit());

    await expect(page.locator('.crumb')).toHaveText(
      'mBoss › runs › groom_booking › wf_c9d2f3',
    );
    await expect(page.locator('.see-head .title')).toHaveText(
      'SUCCESS · 8.2 s total',
    );
  });

  test('banners a run DBOS picked back up', async ({ page }) => {
    await showRun(page, seeInit());

    const banner = page.locator('[data-recovered-banner]');
    await expect(banner.locator('.eyebrow')).toHaveText(
      'Recovered — completed durable operations were not re-executed',
    );
    await expect(banner).toContainText('derived from the widest gap');

    // Each figure wears its own chip. A derived
    // number a person reads as a recorded one is
    // the whole failure mode of a flight recorder,
    // and a number inside the paragraph wears
    // nothing.
    await expect(banner.locator('[data-recovered-down]')).toContainText(
      'nothing ran for about 2.9 s',
    );
    await expect(banner.locator('[data-recovered-reused]')).toContainText(
      '2 durable operations reused',
    );
    await expect(
      banner.locator(`.provenance[data-provenance='derived']`),
    ).toHaveText([seeStrings.derived, seeStrings.derived]);

    // Washed in the warn colour, like every other
    // surface that says a run was picked back up.
    await expect(banner).toHaveCSS('background-color', WARN_TINT);
    await expect(banner.locator('.eyebrow')).toHaveCSS('color', WARN);
  });

  /**
   * Nothing to place is nothing to chip: a run
   * whose steps are timed too closely together to
   * say where the gap was still gets the banner,
   * and gets no figures.
   */
  test('chips no figures where the gap could not be placed', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          recovered: {
            heading:
              'Recovered — completed durable operations were not re-executed',
            body:
              'DBOS picked this run back up. Its steps are timed too ' +
              'closely together to say where the process went down; the ' +
              'recovery count is in the ledger.',
            figures: undefined,
          },
        }),
      ),
    );

    const banner = page.locator('[data-recovered-banner]');
    await expect(banner).toContainText('too closely together');
    await expect(banner.locator('[data-recovered-down]')).toHaveCount(0);
  });

  test('draws no banner over a run that never crashed', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ recovered: undefined })));

    await expect(page.locator('[data-recovered-banner]')).toHaveCount(0);
  });

  /**
   * The page quotes its sources; it does not
   * decorate them.
   *
   * Asked of the sections this view actually draws
   * rather than of the class names an earlier one
   * decorated with. A check for a name nothing
   * renders is equally true of a blank page, of this
   * page, and of a page covered in corner marks
   * under some other name.
   */
  test('frames its sections without ornament', async ({ page }) => {
    await showRun(page, seeInit());

    const sections = page.locator('section');

    await expect(sections.first()).toBeVisible();

    const drawn = await sections.evaluateAll((all) =>
      all.flatMap((element) => [
        getComputedStyle(element).backgroundImage,
        ...['::before', '::after'].map((part) => {
          const style = getComputedStyle(element, part);

          return `${style.content} ${style.backgroundImage}`;
        }),
      ]),
    );

    expect([...new Set(drawn)].sort()).toEqual(['none', 'none none']);
  });

  /**
   * `<step> ✓` against `<step> ✓ restored` is the
   * one distinction this whole view exists to draw.
   */
  test('marks the steps whose output came back from Postgres', async ({
    page,
  }) => {
    await showRun(page, seeInit());

    await expect(page.locator('[data-chip="0"]')).toContainText('restored');
    await expect(page.locator('[data-chip="1"]')).toContainText('restored');
    await expect(page.locator('[data-chip="2"]')).not.toContainText('restored');

    await expect(page.locator('[data-chip="2"]')).toContainText(
      'book_appointment',
    );
  });

  /**
   * The signature of the page: a hole in the record
   * drawn as one, hatched, with a failure-coloured
   * edge where the process was last seen and an
   * accent edge where DBOS picked it back up.
   */
  test('hatches the band nothing ran in, and labels both edges', async ({
    page,
  }) => {
    await showRun(page, seeInit());

    // One band for the whole chart, not one per
    // row: nothing ran anywhere in that interval.
    await expect(page.locator('[data-band]')).toHaveCount(1);

    const band = page.locator('[data-band]');
    const style = await band.evaluate((node) => {
      const computed = getComputedStyle(node);

      return {
        image: computed.backgroundImage,
        left: computed.borderLeftStyle,
        right: computed.borderRightStyle,
        leftColor: computed.borderLeftColor,
        rightColor: computed.borderRightColor,
        width: (node as HTMLElement).style.width,
      };
    });

    expect(style.image).toContain('repeating-linear-gradient');
    expect(style.left).toBe('dashed');
    expect(style.right).toBe('dashed');
    expect(style.leftColor).not.toBe(style.rightColor);
    expect(style.width).toBe('35%');

    await expect(page.locator('[data-band-down]')).toHaveText(
      'process down · 2.9 s',
    );
    await expect(page.locator('[data-band-resumed]')).toHaveText(
      'resumed by DBOS',
    );
    await expect(page.locator('.legend')).toContainText(
      'hatched = process down',
    );
  });

  test('places every bar where the extension put it', async ({ page }) => {
    await showRun(page, seeInit());

    for (const [index, left] of ['0%', '10%', '20%'].entries()) {
      await expect(page.locator(`[data-bar="${index}"]`)).toHaveAttribute(
        'style',
        new RegExp(`left: ${left};`),
      );
    }
  });

  /**
   * A restored bar is where the step ran the first
   * time and nothing ran there again, so it is drawn
   * hollow rather than filled.
   */
  test('draws a restored bar apart from one that ran', async ({ page }) => {
    await showRun(page, seeInit());

    const fill = (bar: number): Promise<string> =>
      page
        .locator(`[data-bar="${bar}"]`)
        .evaluate((node) => getComputedStyle(node).backgroundColor);

    expect(await fill(0)).not.toBe(await fill(2));

    // Hollow, and edged in the recovery colour
    // rather than the brand one.
    await expect(page.locator('[data-bar="0"]')).toHaveCSS(
      'border-top-color',
      WARN,
    );
  });

  /**
   * A step DBOS never timed keeps its row and gets
   * no bar: a step missing from the chart is a step
   * nobody knows ran.
   */
  test('keeps a step it cannot place, without a bar', async ({ page }) => {
    const run = seeRun();
    await showRun(
      page,
      seeInit({
        ...run,
        timeline: {
          ...run.timeline,
          bars: [
            ...run.timeline.bars,
            {
              functionId: 3,
              name: 'send_confirmation',
              at: undefined,
              restored: false,
              failed: false,
            },
          ],
        },
      }),
    );

    await expect(page.locator('.chart-row')).toHaveCount(4);
    await expect(page.locator('[data-bar="3"]')).toHaveCount(0);
  });

  /**
   * A picture of the table, with the columns the
   * table has — and no attempts column, because
   * DBOS records no per-step attempt count anywhere
   * for one to be read out of.
   */
  test('shows the operation_outputs rows as a table', async ({ page }) => {
    await showRun(page, seeInit());

    await expect(page.locator('.raw-block .eyebrow')).toHaveText(
      'dbos.operation_outputs',
    );
    await expect(page.locator('.raw thead th')).toHaveText([
      'step',
      'function',
      'output',
      'committed',
    ]);
    await expect(page.locator('[data-raw-row="0"]')).toContainText('{"n":0}');
    await expect(page.locator('.raw tbody tr')).toHaveCount(3);
  });

  /** The four rows the design asks for, plus the
   *  line that says what they are. */
  test('shows the recovery ledger the design names', async ({ page }) => {
    await showRun(page, seeInit());

    await expect(page.locator('.rail .eyebrow')).toHaveText(
      'dbos.workflow_status',
    );
    await expect(page.locator('[data-rail="recovery_attempts"]')).toContainText(
      '2',
    );
    await expect(page.locator('[data-rail="status"]')).toContainText('SUCCESS');
    await expect(page.locator('[data-rail="executor_id"]')).toContainText(
      'local-dev',
    );
    await expect(page.locator('.ledger-note')).toContainText(
      'just rows in Postgres',
    );
  });

  test('replays from the step the rail is describing', async ({ page }) => {
    const harness = await showRun(page, seeInit());

    await expect(page.locator('[data-replay]')).toHaveText(
      '⟲ Replay from this step',
    );
    await page.locator('[data-replay]').click();

    expect(await harness.postedOfType('replay')).toEqual([
      { type: 'replay', functionId: 2 },
    ]);
  });

  test('changes which step a replay would start from', async ({ page }) => {
    const harness = await showRun(page, seeInit());

    await page.locator('[data-chip="1"]').click();

    expect(await harness.postedOfType('stepSelect')).toEqual([
      { type: 'stepSelect', functionId: 1 },
    ]);
  });

  /**
   * A fork inherits its run's application version
   * unless one is named, and a worker dequeues only
   * its own — so what the panel says after a replay
   * is the one thing that explains a new run sitting
   * still.
   */
  test('says what a replay did and what it is waiting for', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          note:
            'Replaying as wf_fork1 under version v0.5.0, not the v0.4.1 ' +
            'this run used. It starts when your app is running that version.',
        }),
      ),
    );

    await expect(page.locator('[data-replay-note]')).toContainText('wf_fork1');
    await expect(page.locator('[data-replay-note]')).toContainText('v0.5.0');
  });

  test('offers no replay before a step has been picked', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ selectedStep: undefined })));

    await expect(page.locator('[data-replay]')).toBeDisabled();
  });

  test('has nothing to draw before a run is picked', async ({ page }) => {
    await showRun(page, seeNothing());

    await expect(page.locator('.state')).toHaveText(
      'Pick a run to see what it did.',
    );
  });
});

/**
 * Every panel in this extension sits inside
 * whichever theme the user chose, and a panel that
 * ignores that is the one thing every VS Code user
 * notices immediately.
 */
test.describe('in every theme', () => {
  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`draws the list on the editor own ground in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'runs', theme);
      await harness.show(runsInit());

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      await expect(page.locator('[data-run="wf_c9d2f3"]')).toBeVisible();
      expect(ground).not.toBe('rgba(0, 0, 0, 0)');
    });

    test(`hatches the band against ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'see', theme);
      await harness.show(seeInit());

      const image = await page
        .locator('[data-band]')
        .evaluate((node) => getComputedStyle(node).backgroundImage);

      expect(image).toContain('repeating-linear-gradient');
    });
  }
});

/**
 * The saved workflow, and the run drawn onto it.
 *
 * The graph is a picture of the document as it is
 * saved now, which may have moved on since the run
 * — so the caption says which revision is drawn.
 */
test.describe('one run, as a graph', () => {
  /**
   * A person who panned and zoomed to look at
   * something has to still be looking at it after
   * they check the trace and come back. The inactive
   * pane keeps its layout box and is hidden with
   * `visibility`, never with `display`: the graph
   * library measures its own pane, and a pane with
   * no box comes back zero by zero and re-frames
   * itself.
   */
  test('keeps the graph where it was left when the tabs change', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ graph: GRAPH }), 'graph'),
    );
    await graphAtRest(page);

    const pane = page.locator('.run-flow');
    const box = await pane.boundingBox();
    if (box === null) throw new Error('the graph pane has no box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + 40);
    await page.mouse.up();
    await page.mouse.wheel(0, -120);

    await graphAtRest(page);
    const before = await transformOf(page);

    // The host answers a tab press with a fresh
    // init, the way the extension does. One mount
    // throughout: a second would be a new page
    // rather than a tab change.
    for (let round = 0; round < 2; round += 1) {
      await page.locator('[data-see-tab="trace"]').click();
      await harness.show(seeInit(seeRun({ graph: GRAPH }), 'trace'));
      await page.locator('[data-see-tab="graph"]').click();
      await harness.show(seeInit(seeRun({ graph: GRAPH }), 'graph'));
    }

    await graphAtRest(page);

    expect(await transformOf(page)).toBe(before);
  });

  test('draws the saved workflow, with what the run did to each block', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    await expect(page.locator('[data-run-node]')).toHaveCount(2);
    await expect(
      page.locator('[data-run-node="parse_request"]'),
    ).toHaveAttribute('data-state', 'done');
    await expect(page.locator('[data-run-node="find_slot"]')).toHaveAttribute(
      'data-state',
      'failed',
    );
    await expect(page.locator('[data-graph-caption]')).toHaveText(
      'workflow as saved · revision 4',
    );
  });

  test('says a run whose workflow the project lost has no picture', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ graph: undefined }), 'graph'));

    await expect(page.locator('[data-run-node]')).toHaveCount(0);
    await expect(page.locator('[data-graph-caption]')).toHaveText(
      NO_SAVED_WORKFLOW,
    );
  });

  test('tones every block by what the run did there', async ({ page }) => {
    await showRun(
      page,
      seeInit(seeRun({ graph: RUNNING_GRAPH, live: RUNNING }), 'graph'),
    );
    await graphAtRest(page);

    await expect(
      page.locator('[data-run-node="parse_request"]'),
    ).toHaveAttribute('data-state', 'done');
    await expect(page.locator('[data-run-node="find_slot"]')).toHaveAttribute(
      'data-state',
      'failed',
    );
    await expect(page.locator('[data-run-node="await_reply"]')).toHaveAttribute(
      'data-state',
      'waiting',
    );
  });

  /**
   * Where a run is *now* is in no column: it is
   * worked out from the last block that recorded
   * anything, so the block it lights says `derived`
   * on the mark itself. And only the arm the branch
   * is recorded as having taken is lit — the other
   * is somewhere the run demonstrably did not go.
   */
  test('lights where the run is now, and says it was derived', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(seeRun({ graph: RUNNING_GRAPH, live: RUNNING }), 'graph'),
    );
    await graphAtRest(page);

    const ahead = page.locator('[data-run-node="charge_it"]');
    await expect(ahead).toHaveAttribute('data-state', 'running');
    await expect(ahead.locator('.node-run')).toHaveAttribute(
      'title',
      seeStrings.derived,
    );

    await expect(page.locator('[data-run-node="refund_it"]')).toHaveAttribute(
      'data-state',
      'dormant',
    );
  });

  /**
   * The block a person picked reads as picked on
   * both views of the run at once: the group in the
   * trace, and the block that group belongs to on
   * the graph.
   */
  test('halos the block whose group is picked', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          graph: RUNNING_GRAPH,
          live: RUNNING,
          groups: GROUPS,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
        'graph',
      ),
    );
    await graphAtRest(page);

    await expect(page.locator('[data-run-node="find_slot"]')).toHaveAttribute(
      'data-state',
      'selected',
    );
    await expect(
      page.locator('[data-trace-group="find_slot"]'),
    ).toHaveAttribute('aria-current', 'true');
  });

  test('hands the block somebody clicked to the extension', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ graph: GRAPH }), 'graph'),
    );
    await graphAtRest(page);

    await page.locator('[data-run-node="find_slot"]').click();

    expect(await harness.postedOfType('seeNode')).toEqual([
      { type: 'seeNode', nodeId: 'find_slot' },
    ]);
  });
});

test.describe('one run, as a trace', () => {
  test('keeps a group closed until it is opened', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    const closed = page.locator('[data-trace-group="parse_request"]');
    await expect(closed).not.toHaveAttribute('open', '');

    await closed.locator('.trace-head').click();

    await expect(closed).toHaveAttribute('open', '');
  });

  test('opens the group that failed', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    await expect(
      page.locator('[data-trace-group="find_slot"]'),
    ).toHaveAttribute('open', '');
  });

  test('shows the SDK own rows only when they are asked for', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    await expect(page.locator('[data-owner="sdk"]')).toHaveCount(0);

    const harness = await showRun(
      page,
      seeInit(seeRun({ groups: GROUPS, showRaw: true })),
    );

    const sdk = page.locator('[data-owner="sdk"]');
    await expect(sdk).toHaveCount(1);
    await expect(sdk).toHaveAttribute('title', seeStrings.dbosOwned);

    await page.locator('[data-raw-toggle]').click();

    expect(await harness.postedOfType('seeRaw')).toEqual([
      { type: 'seeRaw', raw: false },
    ]);
  });

  /** Chipped derived, because it is a deadline the
   *  SDK wrote down rather than something that has
   *  happened. */
  test('says when a parked block gives up, and that it worked it out', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    const wakes = page.locator('[data-wakes]');
    await expect(wakes).toContainText('times out 14:04:11.000');
    await expect(wakes.locator('.provenance')).toHaveAttribute(
      'data-provenance',
      'derived',
    );
  });

  test('says a group belongs to no block in the saved workflow', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    await expect(
      page.locator('[data-trace-group=""] [data-unattributed]'),
    ).toHaveText(seeStrings.unattributed);
  });

  test('marks the row a block belongs to', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          groups: GROUPS,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );

    await expect(
      page.locator('[data-trace-group="find_slot"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-trace-op="1"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

test.describe('what the run page says about itself', () => {
  for (const [state, said] of [
    ['following', seeStrings.following.following],
    ['waiting', seeStrings.following.waiting],
    ['quiet', seeStrings.following.quiet],
  ] as const) {
    test(`says it is ${state}`, async ({ page }) => {
      await showRun(page, seeInit(seeRun({ following: state })));

      await expect(page.locator('[data-following]')).toContainText(said);
    });
  }

  /**
   * The trace's own disclosure control under
   * `all: unset`, which is the second half of the
   * question the token layer's `.tab` answered.
   */
  test('keeps the focus ring on the control that opens a group', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    const head = page.locator('[data-trace-group="parse_request"] .trace-head');
    await head.focus();

    await expect(head).not.toHaveCSS('outline-style', 'none');
    await expect(head).toHaveCSS('letter-spacing', 'normal');
  });

  test('offers a way to look again', async ({ page }) => {
    const harness = await showRun(page, seeInit());

    await page.locator('[data-see-refresh]').click();

    expect(await harness.postedOfType('seeRefresh')).toEqual([
      { type: 'seeRefresh' },
    ]);
  });

  test('draws what the run was started with', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          input: { text: '{\n  "email": "ada@example.com"\n}', cut: false },
        }),
      ),
    );

    const shown = page.locator('[data-workflow-input]');
    await expect(shown).toContainText('ada@example.com');
    await expect(shown).toContainText(seeStrings.asRecorded);
  });
});

/** The two blocks the graph fixture draws, laid out
 *  the way core would lay them out. */
const GRAPH: SeeGraph = {
  ir: {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      { id: 'find_slot', kind: 'step', title: 'Find a slot', config: {} },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'parse_request', port: 'out' },
        to: { node: 'find_slot' },
      },
    ],
  } as unknown as SeeGraph['ir'],
  boxes: {
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 160, w: 230, h: 64 },
  },
  labels: paletteLabels,
  unassigned: 'unassigned',
  caption: 'workflow as saved · revision 4',
  decided: {},
};

/**
 * The same run, still going, on a workflow that
 * branches.
 *
 * Four things are true of it at once and each is
 * drawn differently: one block finished, one threw,
 * one is parked on a person, and one is where the
 * run is *now* — which the ledger does not record
 * and the page therefore works out.
 */
const RUNNING_GRAPH: SeeGraph = {
  ir: {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      { id: 'find_slot', kind: 'step', title: 'Find a slot', config: {} },
      {
        id: 'await_reply',
        kind: 'durableWait',
        title: 'Ask',
        config: {
          source: { kind: 'form', email: 'parse_request' },
          onTimeout: 'abort',
        },
      },
      {
        id: 'how_big',
        kind: 'branch',
        title: 'How big',
        config: {
          cases: [
            { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
          ],
          elsePort: 'small',
        },
      },
      { id: 'charge_it', kind: 'step', title: 'Charge it', config: {} },
      { id: 'refund_it', kind: 'step', title: 'Refund it', config: {} },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'parse_request', port: 'out' },
        to: { node: 'find_slot' },
      },
      {
        id: 'e2',
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'await_reply' },
      },
      {
        id: 'e3',
        from: { node: 'await_reply', port: 'out' },
        to: { node: 'how_big' },
      },
      {
        id: 'e4',
        from: { node: 'how_big', port: 'large' },
        to: { node: 'charge_it' },
      },
      {
        id: 'e5',
        from: { node: 'how_big', port: 'small' },
        to: { node: 'refund_it' },
      },
    ],
  } as unknown as SeeGraph['ir'],
  boxes: {
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 160, w: 230, h: 64 },
    await_reply: { x: 0, y: 320, w: 230, h: 64 },
    how_big: { x: 0, y: 480, w: 230, h: 64 },
    charge_it: { x: -160, y: 640, w: 230, h: 64 },
    refund_it: { x: 160, y: 640, w: 230, h: 64 },
  },
  labels: paletteLabels,
  unassigned: 'unassigned',
  caption: 'workflow as saved · revision 4',
  // The arm the run is recorded as having taken.
  // The other one is somewhere it demonstrably did
  // not go.
  decided: { how_big: 'large' },
};

/** What the ledger holds for that run: the last row
 *  is the block it parked on, which is where the
 *  walk to the frontier starts. */
const RUNNING = liveRun({
  workflowId: 'wf_c9d2f3',
  workflow: 'groom_booking',
  status: 'PENDING',
  outcome: 'running',
  steps: [
    liveStep({ name: 'parse_request', nodeId: 'parse_request' }),
    liveStep({
      name: 'find_slot',
      nodeId: 'find_slot',
      state: 'failed',
      functionId: 1,
    }),
    liveStep({
      name: 'await_reply.register',
      nodeId: 'await_reply',
      state: 'waiting',
      functionId: 2,
    }),
  ],
});

const GROUPS: TraceGroupView[] = [
  {
    nodeId: 'parse_request',
    title: 'Parse',
    qualifier: undefined,
    wakes: undefined,
    open: false,
    failed: false,
    operations: [
      {
        functionId: 0,
        name: 'parse_request',
        owner: 'node',
        state: 'done',
        at: '14:02:11.100',
        output: '{}',
        outputCut: false,
        error: undefined,
        restored: false,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
    ],
  },
  {
    nodeId: 'find_slot',
    title: 'Find a slot',
    qualifier: '· round 2',
    wakes: 'times out 14:04:11.000',
    open: true,
    failed: true,
    operations: [
      {
        functionId: 1,
        name: 'find_slot.r2',
        owner: 'node',
        state: 'failed',
        at: '14:02:14.900',
        output: undefined,
        outputCut: false,
        error: 'no slot left',
        restored: false,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
      {
        functionId: 2,
        name: 'DBOS.sleep',
        owner: 'sdk',
        state: 'done',
        at: '14:02:15.000',
        output: '1739880139200',
        outputCut: false,
        error: undefined,
        restored: false,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
    ],
  },
  {
    nodeId: undefined,
    title: '',
    qualifier: undefined,
    wakes: undefined,
    open: false,
    failed: false,
    operations: [
      {
        functionId: 3,
        name: 'gone_away',
        owner: 'unmapped',
        state: 'done',
        at: '14:02:16.000',
        output: '{}',
        outputCut: false,
        error: undefined,
        restored: true,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
    ],
  },
];

/** The graph's viewport transform, once nothing is
 *  moving. A spec against the built bundle has no
 *  `useReactFlow`, so the DOM string is the only
 *  way to read it. */
async function graphAtRest(page: Page): Promise<void> {
  let last = await transformOf(page);

  await expect
    .poll(async () => {
      const now = await transformOf(page);
      const still = now !== '' && now === last;

      last = now;

      return still;
    })
    .toBe(true);
}

function transformOf(page: Page): Promise<string> {
  return page
    .locator('.react-flow__viewport')
    .evaluate((viewport) => (viewport as HTMLElement).style.transform);
}
