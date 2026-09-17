import { expect, test, type Page } from '@playwright/test';

import type { RunRow, RunsInit } from '../../src/webview/protocol.js';

import { liveStep } from '../../src/test-support/runs.js';
import { filled } from '../../src/webview/fill.js';
import { glyphOf } from '../../src/webview/states.js';

import { WARN } from './fixtures/runs.js';
import { mount, THEMES_ALL, type Harness, type ThemeKind } from './harness.js';
import { runsWords as runsStrings } from './words.js';

/**
 * A run history, on screen.
 *
 * The list is a ledger read top to bottom, where a
 * failure says what it was on its own row. The run
 * a row opens is drawn in an editor tab of its own,
 * and its cases are in that tab's spec.
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
    state: 'done',
    line: 'done · 14:02 · 8.2 s · ↻ recovered',
    recovered: true,
    recoveredNote: undefined,
    error: undefined,
    stoppedAt: undefined,
    operations: undefined,
    lineage: [],
    startStep: undefined,
    failedStep: undefined,
  },
  {
    workflowId: 'wf_a1b4e7',
    name: 'groom_booking',
    status: 'SUCCESS',
    state: 'done',
    line: 'done · 13:57 · 4.8 s',
    recovered: false,
    recoveredNote: undefined,
    error: undefined,
    stoppedAt: undefined,
    operations: undefined,
    lineage: [],
    startStep: undefined,
    failedStep: undefined,
  },
  {
    workflowId: 'wf_77c101',
    name: 'nightly_sync',
    status: 'ERROR',
    state: 'failed',
    line: 'failed · sync_rows · 13:41 · 1.2 s',
    recovered: false,
    recoveredNote: undefined,
    error: 'login failed — CDC_PASS rotated',
    stoppedAt: '13:41',
    operations: 3,
    lineage: [],
    startStep: undefined,
    failedStep: 2,
  },
  {
    workflowId: 'wf_ff0912',
    name: 'nightly_sync',
    status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    state: 'failed',
    line: 'gave up · after sync_rows · 13:20',
    recovered: true,
    recoveredNote: 'recovered from 3 crashes · derived',
    error: 'gave up after 3 attempts',
    stoppedAt: '13:19',
    operations: 2,
    lineage: [],
    startStep: undefined,
    failedStep: undefined,
  },
];

/** One row, as a case changes it. */
function listRow(over: Partial<RunRow>): RunRow {
  return {
    workflowId: 'wf_c9d2f3',
    name: 'groom_booking',
    status: 'SUCCESS',
    state: 'done',
    line: 'done · 14:02 · 8.2 s',
    recovered: false,
    recoveredNote: undefined,
    error: undefined,
    stoppedAt: undefined,
    operations: undefined,
    lineage: [],
    startStep: undefined,
    failedStep: undefined,
    ...over,
  };
}

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
    counts: { all: 6, active: 1, failed: 1 },
    rows: ROWS,
    selected: undefined,
    stack: {
      available: true,
      answered: true,
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

async function showList(
  page: Page,
  init: RunsInit,
  theme: ThemeKind = 'light',
): Promise<Harness> {
  const harness = await mount(page, 'runs', theme);
  await harness.show(init);

  return harness;
}

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
          answered: true,
          busy: undefined,
          detail: undefined,
          services: [
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
          answered: true,
          busy: undefined,
          detail: undefined,
          services: [
            {
              service: 'app',
              state: 'exited',
              health: 'none',
              ports: [],
              detail: '',
            },
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
          answered: true,
          busy: undefined,
          detail: undefined,
          services: [
            {
              service: 'app',
              state: 'running',
              health: 'healthy',
              ports: [3000],
              detail: '',
            },
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
          answered: true,
          busy: undefined,
          detail: undefined,
          services: [
            {
              service: 'app',
              state: 'running',
              health: 'healthy',
              ports: [3000],
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
          answered: false,
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

  /**
   * The extension holds the input, so every change
   * to the box is said as it is made, and a start
   * names only the workflow: what it runs with is
   * whatever the extension was last told.
   */
  test('says each change to the input, and starts without it', async ({
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

    await expect(page.locator('[data-workflow-picker]')).toHaveValue(
      'groom_booking',
    );
    await page.locator('[data-input]').fill('{"bookingId":');
    await page.locator('[data-input]').fill('{"bookingId":7}');
    await page.locator('[data-run-workflow]').click();

    expect(await harness.postedOfType('runInput')).toEqual([
      { type: 'runInput', workflow: 'groom_booking', text: '{"bookingId":' },
      { type: 'runInput', workflow: 'groom_booking', text: '{"bookingId":7}' },
    ]);
    expect(await harness.postedOfType('runWorkflow')).toEqual([
      { type: 'runWorkflow', workflow: 'groom_booking' },
    ]);
  });

  /**
   * A view in the side bar is torn down the moment
   * it is hidden. What was typed is the extension's
   * now, so the box a view comes back with is the
   * box it left.
   */
  test('shows the input the extension holds when it comes back', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        testRun: {
          workflows: WORKFLOWS,
          selected: 'groom_booking',
          input: '{"n":1}',
          hint: undefined,
          problem: undefined,
        },
      }),
    );

    await expect(page.locator('[data-input]')).toHaveCount(1);
    await expect(page.locator('[data-input]')).toHaveValue('{"n":1}');
  });

  /** No workflow is set while none can be run, and
   *  what is typed is still the extension's. */
  test('says a change to the input with no workflow set', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-input]').fill('{}');

    expect(await harness.postedOfType('runInput')).toEqual([
      { type: 'runInput', text: '{}' },
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
            workflowId: 'wf_refused',
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
            workflowId: undefined,
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
    executorId: 'local-dev',
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
    recordedInput: undefined,
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

  /**
   * A quiet run is one the watch let go of, not one
   * that ended: DBOS still has it `PENDING` and it
   * can still be stopped. So all three of the
   * stopped-and-not-stopped states offer it.
   */
  test('offers Cancel while a run is running, waiting or quiet', async ({
    page,
  }) => {
    for (const outcome of ['running', 'waiting', 'quiet'] as const) {
      const harness = await showList(
        page,
        runsInit({ live: { ...LIVE, outcome } }),
      );

      const zone = page.locator('[data-zone="running-now"]');
      await expect(zone.locator('[data-resume-run]')).toHaveCount(0);
      await zone.locator('[data-cancel-run]').click();

      expect(await harness.postedOfType('cancelRun')).toEqual([
        { type: 'cancelRun', workflowId: 'run_1_a1b2' },
      ]);
    }
  });

  test('offers Resume once it is cancelled', async ({ page }) => {
    const harness = await showList(
      page,
      runsInit({
        live: { ...LIVE, outcome: 'cancelled', status: 'CANCELLED' },
      }),
    );

    const zone = page.locator('[data-zone="running-now"]');
    await expect(zone.locator('[data-cancel-run]')).toHaveCount(0);
    await zone.locator('[data-resume-run]').click();

    expect(await harness.postedOfType('resumeRun')).toEqual([
      { type: 'resumeRun', workflowId: 'run_1_a1b2' },
    ]);
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
        rows: [listRow({})],
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

  /**
   * The one row where sending the run again is not
   * what somebody means. A cancelled run has its
   * whole recorded history sitting in the ledger,
   * and picking it back up carries on from there —
   * so the row offers that instead of a second run
   * from the top.
   */
  test('offers Resume in place of Rerun on a cancelled row', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_5',
            workflow: 'groom_booking',
            outcome: 'cancelled',
            when: '14:14 · 3.1 s',
            stepCount: 2,
            recovered: false,
            error: undefined,
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    const row = page.locator('[data-session-row="run_5"]');
    await expect(row).toHaveAttribute('data-outcome', 'cancelled');
    await expect(row.locator('[data-rerun]')).toHaveCount(0);

    await row.locator('[data-resume-run]').click();
    expect(await harness.postedOfType('resumeRun')).toEqual([
      { type: 'resumeRun', workflowId: 'run_5' },
    ]);
  });

  /** Nobody has to look into a run somebody stopped
   *  on purpose: there is no error, and no question
   *  to hand over. */
  test('offers no Ask agent on a cancelled row', async ({ page }) => {
    await showList(
      page,
      runsInit({
        session: [
          {
            workflowId: 'run_6',
            workflow: 'groom_booking',
            outcome: 'cancelled',
            when: '14:14 · 3.1 s',
            stepCount: 2,
            recovered: false,
            error: 'cancelled at find_slot',
            keyed: false,
            via: 'start',
          },
        ],
      }),
    );

    await expect(
      page.locator('[data-session-row="run_6"] [data-ask-agent]'),
    ).toHaveCount(0);
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
    await showList(
      page,
      runsInit({ counts: { all: 6, active: 2, failed: 1 } }),
    );

    await expect(page.locator('[data-filter="all"]')).toHaveCount(1);
    await expect(page.locator('[data-filter="all"]')).toContainText('6');
    await expect(page.locator('[data-filter="active"]')).toContainText('2');
    await expect(page.locator('[data-filter="failed"]')).toContainText('1');
    await expect(page.locator('[data-filter="recovered"]')).toHaveCount(0);

    await expect(page.locator('[data-filter="all"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('asks the extension for a different filter', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-filter="failed"]').click();
    await page.locator('[data-filter="active"]').click();

    expect(await harness.postedOfType('runFilter')).toEqual([
      { type: 'runFilter', filter: 'failed' },
      { type: 'runFilter', filter: 'active' },
    ]);
  });

  /**
   * Three states told apart without reading
   * anything: a mark, an accent rule down the edge
   * of a run that recovered, and the failure in the
   * failure colour.
   */
  test('draws a plain success, a recovered one and a failure apart', async ({
    page,
  }) => {
    await showList(page, runsInit());

    const recovered = page.locator('[data-run="wf_c9d2f3"]');
    await expect(recovered).toHaveAttribute('data-recovered', 'true');
    await expect(recovered).toContainText('↻ recovered');
    await expect(recovered.locator('.run-summary')).toHaveText(
      'done · 14:02 · 8.2 s · ↻ recovered',
    );

    const plain = page.locator('[data-run="wf_a1b4e7"]');
    await expect(plain).toHaveAttribute('data-recovered', 'false');
    await expect(plain).not.toContainText('↻ recovered');

    const failed = page.locator('[data-run="wf_77c101"]');
    await expect(failed).toHaveAttribute('data-outcome', 'failed');
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
          listRow({
            workflowId: 'wf_parked',
            name: 'expense_claim',
            status: 'PENDING',
            state: 'waiting',
            line: 'waiting · manager_ok · since 10:31',
            stoppedAt: '10:31',
            operations: 1,
          }),
        ],
      }),
    );

    const row = page.locator('[data-run="wf_parked"]');

    await expect(row).toHaveAttribute('data-outcome', 'waiting');
    await expect(row.locator('.run-mark')).toHaveText(glyphOf('waiting').mark);

    const summary = row.locator('.run-summary');
    await expect(summary).toHaveText('waiting · manager_ok · since 10:31');
    await expect(summary).toHaveAttribute('data-stopped-at', '10:31');
    await expect(summary).toHaveAttribute('data-derived', 'true');
    await expect(summary).toHaveAttribute('title', runsStrings.derivedTitle);
  });

  test('hands the id of a row to the window', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_c9d2f3"]').hover();
    await page.locator('[data-copy-run-id="wf_c9d2f3"]').click();

    expect(await harness.postedOfType('copyRunId')).toEqual([
      { type: 'copyRunId', workflowId: 'wf_c9d2f3' },
    ]);
  });

  test('keeps the hidden copy control keyboard accessible', async ({
    page,
  }) => {
    const harness = await showList(page, runsInit());
    const copy = page.locator('[data-copy-run-id="wf_c9d2f3"]');

    await copy.focus();
    await expect(copy).toHaveCSS('opacity', '1');
    await copy.press('Enter');

    expect(await harness.postedOfType('copyRunId')).toEqual([
      { type: 'copyRunId', workflowId: 'wf_c9d2f3' },
    ]);
  });

  /**
   * Nothing on this panel is a service somewhere.
   * The footer names the two tables the list is
   * projected from, in the project's own database.
   */
  /**
   * Both lines come off `forked_from`, which every
   * row already selects — so the replay is drawn
   * only because it happens to be on this page, and
   * no row costs a query of its own. The words are
   * the Inspector's lineage lines, with the short id
   * where the id goes.
   */
  test('says which run a row is a replay of, and from which step', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        rows: [
          listRow({
            workflowId: 'wf_c9d2f3',
            status: 'ERROR',
            state: 'failed',
            line: 'failed · 14:02 · 8.2 s',
            failedStep: 2,
            lineage: [
              {
                direction: 'to',
                workflowId: 'wf_fork1',
                short: '#f0rk',
                startStep: 2,
                word: 'done',
              },
            ],
          }),
          listRow({
            workflowId: 'wf_fork1',
            line: 'done · replay of #c9d2 · 14:09 · 3.1 s',
            startStep: 2,
            lineage: [
              {
                direction: 'of',
                workflowId: 'wf_c9d2f3',
                short: '#c9d2',
                startStep: 2,
              },
            ],
          }),
        ],
      }),
    );

    const fromStep = filled(runsStrings.fromStep, '2');

    await expect(
      page.locator('[data-run="wf_c9d2f3"] [data-run-fork]'),
    ).toHaveText(filled(runsStrings.replayTo, fromStep, '#f0rk', 'done'));
    await expect(
      page.locator('[data-run="wf_fork1"] [data-replay-of]'),
    ).toHaveText(filled(runsStrings.replayOf, '#c9d2', fromStep));
    await expect(
      page.locator('[data-run="wf_c9d2f3"] [data-replay-of]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-run="wf_fork1"] .run-summary')).toHaveText(
      'done · replay of #c9d2 · 14:09 · 3.1 s',
    );
  });

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
   * A run DBOS gave up recovering is a failure, so
   * it wears the failed mark; its line is what says
   * it was not one that threw.
   */
  test('draws a run DBOS gave up on as a failure that says it gave up', async ({
    page,
  }) => {
    await showList(page, runsInit());

    const exhausted = page.locator('[data-run="wf_ff0912"]');
    await expect(exhausted).toHaveAttribute('data-outcome', 'failed');
    await expect(exhausted.locator('.run-summary')).toContainText('gave up');
    await expect(exhausted).toContainText('gave up after 3 attempts');
    await expect(exhausted.locator('.run-note')).toHaveText(
      'recovered from 3 crashes · derived',
    );

    const mark = (run: string): Promise<string | null> =>
      page.locator(`[data-run="${run}"] .run-mark`).textContent();

    expect(await mark('wf_77c101')).toBe(glyphOf('failed').mark);
    expect(await mark('wf_ff0912')).toBe(await mark('wf_77c101'));
  });

  test('selects a run when its row is clicked', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_77c101"]').click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_77c101' },
    ]);
  });

  test('selects a run when its outcome mark is clicked', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_77c101"] .run-mark').click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_77c101' },
    ]);
    expect(await harness.postedOfType('copyRunId')).toEqual([]);
  });

  for (const theme of THEMES_ALL) {
    test(`ellipsizes a long run id in a narrow ${theme} panel`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 300, height: 800 });
      await showList(page, runsInit(), theme);

      const id = page.locator('[data-run="wf_c9d2f3"] .run-id');
      const style = await id.evaluate((node) => {
        const css = getComputedStyle(node);
        return {
          overflow: css.overflow,
          textOverflow: css.textOverflow,
          whiteSpace: css.whiteSpace,
          width: node.getBoundingClientRect().width,
        };
      });

      expect(style).toMatchObject({
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
      expect(style.width).toBeGreaterThan(60);
    });
  }

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
        counts: { all: 0, active: 0, failed: 0 },
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

  test('says which file holds no database to read', async ({ page }) => {
    const detail = '/demo/.env is not readable, so there is no database.';

    await showList(page, runsInit({ state: 'no-database', detail, rows: [] }));

    await expect(page.locator('.state')).toHaveText(detail);
  });

  /**
   * Nothing has been read yet, and whatever the
   * view drew below its header now would be
   * replaced a moment later.
   */
  test('draws its header alone before the first read', async ({ page }) => {
    await showList(
      page,
      runsInit({
        state: 'loading',
        rows: [],
        counts: { all: 0, active: 0, failed: 0 },
        stack: {
          available: false,
          answered: false,
          services: [],
          busy: undefined,
          detail: undefined,
        },
      }),
    );

    const runs = page.locator('.runs');

    await expect(runs.locator('.runs-head')).toContainText(runsStrings.heading);
    await expect(runs.locator(':scope > *')).toHaveCount(1);
  });
});

test.describe('one run in detail', () => {
  test('replays a whole run from the list', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_c9d2f3"]').hover();
    await page.locator('[data-replay-run="wf_c9d2f3"]').click();

    expect(await harness.postedOfType('replayRun')).toEqual([
      { type: 'replayRun', workflowId: 'wf_c9d2f3' },
    ]);
  });
});

/**
 * Every panel in this extension sits inside
 * whichever theme the user chose, and a panel that
 * ignores that is the one thing every VS Code user
 * notices immediately.
 */
test.describe('in every theme', () => {
  for (const theme of THEMES_ALL) {
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
  }
});
