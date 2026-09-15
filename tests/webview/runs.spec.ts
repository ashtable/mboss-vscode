import { expect, test, type Page } from '@playwright/test';

import type { RunRow, RunsInit } from '../../src/webview/protocol.js';

import { GRID } from '../../src/canvas/grid.js';
import { liveStep } from '../../src/test-support/runs.js';
import { filled } from '../../src/webview/fill.js';

import { LIBRARY_COLOURS } from './fixtures/library.js';
import {
  GRAPH,
  GROUPS,
  LINEAGE,
  NO_SAVED_WORKFLOW,
  QUEUED,
  QUEUED_GRAPH,
  QUEUED_GROUPS,
  QUEUE_READ,
  REPLAYED,
  RUNNING,
  RUNNING_GRAPH,
  WARN,
  WARN_TINT,
  graphAtRest,
  seeInit,
  seeNothing,
  seeRun,
  showRun,
  transformOf,
} from './fixtures/runs.js';
import { mount, THEMES_ALL, type Harness, type ThemeKind } from './harness.js';
import { colourOf, sameColour, type Role } from './palette.js';
import {
  canvasWords,
  inspectorWords as inspectorStrings,
  runsWords as runsStrings,
  seeWords as seeStrings,
} from './words.js';

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
    word: 'done',
    when: '14:02 · 8.2 s',
    recovered: true,
    recoveredNote: undefined,
    error: undefined,
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
    replayOf: undefined,
    forks: [],
  },
  {
    workflowId: 'wf_a1b4e7',
    name: 'groom_booking',
    status: 'SUCCESS',
    word: 'done',
    when: '13:57 · 4.8 s',
    recovered: false,
    recoveredNote: undefined,
    error: undefined,
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
    replayOf: undefined,
    forks: [],
  },
  {
    workflowId: 'wf_77c101',
    name: 'nightly_sync',
    status: 'ERROR',
    word: 'failed',
    when: '13:41 · 1.2 s',
    recovered: false,
    recoveredNote: undefined,
    error: 'login failed — CDC_PASS rotated',
    summary: 'failed · sync_rows',
    stoppedAt: '13:41',
    operations: 3,
    replayOf: undefined,
    forks: [],
  },
  {
    workflowId: 'wf_ff0912',
    name: 'nightly_sync',
    status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    word: 'gaveUp',
    when: '13:20 · 61.0 s',
    recovered: true,
    recoveredNote: 'recovered from 3 crashes',
    error: 'gave up after 3 attempts',
    summary: undefined,
    stoppedAt: undefined,
    operations: undefined,
    replayOf: undefined,
    forks: [],
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
        rows: [
          {
            workflowId: 'wf_c9d2f3',
            name: 'groom_booking',
            status: 'SUCCESS',
            word: 'done',
            when: '14:02 · 8.2 s',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: undefined,
            stoppedAt: undefined,
            operations: undefined,
            replayOf: undefined,
            forks: [],
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
            word: 'waiting',
            when: '14:06',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: 'waiting · manager_ok · 10:31',
            stoppedAt: '10:31',
            operations: 4,
            replayOf: undefined,
            forks: [],
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
   * row already selects — so the child is drawn only
   * because it happens to be on this page, and no
   * row costs a query of its own.
   */
  test('says which run a row is a replay of, and what came out of it', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({
        rows: [
          {
            workflowId: 'wf_c9d2f3',
            name: 'groom_booking',
            status: 'ERROR',
            word: 'failed',
            when: '14:02 · 8.2 s',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: undefined,
            stoppedAt: undefined,
            operations: undefined,
            replayOf: undefined,
            forks: ['└ replay → wf_fork1 · SUCCESS'],
          },
          {
            workflowId: 'wf_fork1',
            name: 'groom_booking',
            status: 'SUCCESS',
            word: 'done',
            when: '14:09 · 3.1 s',
            recovered: false,
            recoveredNote: undefined,
            error: undefined,
            summary: undefined,
            stoppedAt: undefined,
            operations: undefined,
            replayOf: 'replay of wf_c9d2f3',
            forks: [],
          },
        ],
      }),
    );

    await expect(
      page.locator('[data-run="wf_c9d2f3"] [data-run-fork]'),
    ).toHaveText('└ replay → wf_fork1 · SUCCESS');
    await expect(
      page.locator('[data-run="wf_fork1"] [data-replay-of]'),
    ).toHaveText('replay of wf_c9d2f3');
    await expect(
      page.locator('[data-run="wf_c9d2f3"] [data-replay-of]'),
    ).toHaveCount(0);
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
    await expect(exhausted).toHaveAttribute('data-severity', 'gaveUp');
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

  test('opens a run when its outcome mark is clicked', async ({ page }) => {
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
              reused: false,
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
      '↺ Replay From Here',
    );
    await page.locator('[data-replay]').click();

    expect(await harness.postedOfType('replayFrom')).toEqual([
      { type: 'replayFrom', workflowId: 'wf_c9d2f3', functionId: 2 },
    ]);
  });

  /**
   * A row DBOS wrote for itself, a row inside a
   * wait, a row the run is still sitting on: none of
   * them is a point a replay can begin at, and each
   * has a reason a person can act on. The reason is
   * the row's title rather than a gap where the
   * button was.
   */
  test('says why a row is not offered as a boundary', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          groups: GROUPS,
          // The SDK's own rows are drawn only where
          // somebody asked for them, and one of them
          // is the case.
          showRaw: true,
          chips: [
            {
              functionId: 0,
              name: 'parse_request',
              restored: false,
              reused: false,
              failed: false,
              replayable: true,
              because: undefined,
            },
            {
              functionId: 1,
              name: 'find_slot',
              restored: false,
              reused: false,
              failed: false,
              replayable: false,
              because: 'The run is sitting here now.',
            },
          ],
        }),
        'trace',
      ),
    );

    // The SDK's own row: withheld, and it already
    // says whose row it is, so that sentence stays
    // the one on it.
    await expect(page.locator('[data-trace-op="2"]')).toHaveAttribute(
      'data-replayable',
      'false',
    );

    const row = page.locator('[data-trace-op="3"]');

    await expect(row).toHaveAttribute('data-replayable', 'false');
    await expect(row).toHaveAttribute('title', 'The run is sitting here now.');

    const chip = page.locator('[data-chip="1"]');

    await expect(chip).toHaveAttribute('data-replayable', 'false');
    await expect(chip).toHaveAttribute('title', 'The run is sitting here now.');
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

  test('replays a whole run from the list', async ({ page }) => {
    const harness = await showList(page, runsInit());

    await page.locator('[data-run="wf_c9d2f3"]').hover();
    await page.locator('[data-replay-run="wf_c9d2f3"]').click();

    expect(await harness.postedOfType('replayRun')).toEqual([
      { type: 'replayRun', workflowId: 'wf_c9d2f3' },
    ]);
  });

  test('offers no replay before a step has been picked', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ selectedStep: undefined })));

    await expect(page.locator('[data-replay]')).toBeDisabled();
  });

  /**
   * A replay forks a new execution and the run it
   * came from stays exactly where it was, so the
   * tree is drawn from the top whichever end of the
   * fork the page is showing — and the line under it
   * says both runs are still there.
   */
  test('draws the lineage tree', async ({ page }) => {
    const harness = await showRun(page, seeInit(seeRun({ lineage: LINEAGE })));
    const tree = page.locator('[data-lineage]');

    await expect(tree.locator('[data-lineage-run="wf_a1b4e7"]')).toContainText(
      'ERROR',
    );
    await expect(tree.locator('[data-lineage-from="wf_c9d2f3"]')).toContainText(
      'replay from Refund payment',
    );
    await expect(
      tree.locator('[data-lineage-run="wf_c9d2f3"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(tree.locator('[data-lineage-note]')).toHaveText(
      seeStrings.bothRemain,
    );

    await tree.locator('[data-lineage-id="wf_a1b4e7"]').click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_a1b4e7' },
    ]);
  });

  test('draws no lineage for a run with no replay either side', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun()));

    await expect(page.locator('[data-lineage]')).toHaveCount(0);
  });

  test('has nothing to draw before a run is picked', async ({ page }) => {
    await showRun(page, seeNothing());

    await expect(page.locator('.state')).toHaveText(
      'Pick a run to see what it did.',
    );
  });

  /**
   * The rail is one card about whatever is selected,
   * then the ways on from it.
   *
   * The card is the Inspector's own — the same
   * component the editor canvas draws — so what a
   * run recorded about a block reads the same
   * wherever somebody is standing when they ask.
   */
  test('shows the Evidence card for the block that is selected', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          graph: GRAPH,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );

    const card = page.locator('.rail [data-evidence="block"]');

    await expect(card).toHaveCount(1);
    await expect(card.locator('.evidence-title')).toHaveText('Find a slot');
    await expect(card.locator('.run-status')).toContainText(
      inspectorStrings.runStates.failed,
    );
  });

  /**
   * A queue block gets a card of its own, drawn from
   * the counts and from the one read a selection
   * costs — and the way to a child from here is the
   * page's own way of showing a run, because this
   * page is already showing one.
   */
  test('shows a queue block’s card, and selects the run an item started', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          graph: QUEUED_GRAPH,
          live: { ...QUEUED, queueEvidence: { index_pages: QUEUE_READ } },
          selected: { nodeId: 'index_pages', functionId: undefined },
        }),
      ),
    );

    const card = page.locator('.rail [data-evidence="queue"]');

    await expect(card).toHaveCount(1);
    await expect(
      card.locator('[data-evidence-field="queued"] .value'),
    ).toHaveText('42');
    await expect(
      card.locator('[data-evidence-field="observedStarts"] .value'),
    ).toHaveText('74 in the last 60 s');

    await card.locator('[data-queue-item="wf_child_9f21"]').click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_child_9f21' },
    ]);
    expect(await harness.postedOfType('inspectQueue')).toEqual([
      { type: 'inspectQueue', workflowId: 'wf_c9d2f3', nodeId: 'index_pages' },
    ]);
  });

  test('shows the run-level card with nothing selected', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH })));

    const card = page.locator('.rail [data-evidence="run"]');

    await expect(card).toHaveCount(1);
    await expect(card.locator('.evidence-title')).toContainText('wf_c9d2f3');
  });

  /** The button is a way to the run page, and this
   *  rail is the run page. */
  test('omits Open run on the run page', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH })));

    await expect(page.locator('[data-evidence-action="openRun"]')).toHaveCount(
      0,
    );
  });

  /**
   * The rest of the card's doors are the same ones
   * the canvas draws, because it is the same card:
   * the code the block runs and the agent are
   * reached from wherever somebody is standing when
   * they ask.
   */
  test('reaches the code and the agent from the rail', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          graph: GRAPH,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );

    await page.locator('.rail [data-evidence-action="openFunction"]').click();
    await page.locator('.rail [data-evidence-action="askAgent"]').click();

    expect(await harness.postedOfType('openFunction')).toEqual([
      { type: 'openFunction', nodeId: 'find_slot' },
    ]);
    expect(await harness.postedOfType('askAgent')).toEqual([
      { type: 'askAgent', workflowId: 'wf_c9d2f3', nodeId: 'find_slot' },
    ]);
  });

  /**
   * Cancel is meaningless once a run has stopped and
   * Resume is meaningless while one is still going,
   * so the two can never be offered together.
   */
  test('offers Cancel or Resume, never both', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          controls: {
            cancel: true,
            resume: false,
            cancelled: undefined,
            lastRecorded: 'book_appointment · step 2',
          },
        }),
      ),
    );

    await expect(page.locator('[data-cancel]')).toHaveText('Cancel run');
    await expect(page.locator('[data-resume]')).toHaveCount(0);

    await page.locator('[data-cancel]').click();

    expect(await harness.postedOfType('cancelRun')).toEqual([
      { type: 'cancelRun', workflowId: 'wf_c9d2f3' },
    ]);

    await harness.show(
      seeInit(
        seeRun({
          word: 'cancelled',
          controls: {
            cancel: false,
            resume: true,
            cancelled: '10:58:22 · by you',
            lastRecorded: 'book_appointment · step 2',
          },
        }),
      ),
    );

    await expect(page.locator('[data-cancel]')).toHaveCount(0);
    await expect(page.locator('[data-resume]')).toHaveText('Resume');
    await expect(page.locator('[data-cancelled]')).toContainText('by you');
    await expect(page.locator('[data-last-recorded]')).toContainText(
      'book_appointment · step 2',
    );

    await page.locator('[data-resume]').click();

    expect(await harness.postedOfType('resumeRun')).toEqual([
      { type: 'resumeRun', workflowId: 'wf_c9d2f3' },
    ]);
  });

  /**
   * Picking a stopped run back up is the thing to do
   * with it, and Replay below it is not: a replay
   * forks a second run, and this one is still there
   * to be finished.
   */
  test('makes Resume the primary action', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          word: 'cancelled',
          controls: {
            cancel: false,
            resume: true,
            cancelled: '10:58:22',
            lastRecorded: 'book_appointment · step 2',
          },
        }),
      ),
    );

    await expect(page.locator('[data-resume]')).toHaveClass(/primary/);
    await expect(page.locator('[data-replay]')).not.toHaveClass(/primary/);
    await expect(page.locator('[data-resume-hint]')).toHaveText(
      'Resume continues from the recorded history · completed durable ' +
        'operations are not re-executed',
    );
  });

  /** A finished run that recorded nothing of its own
   *  has neither control on offer and nothing to say
   *  about how far it got, and an empty framed box
   *  under the ledger would read as something that
   *  failed to load. */
  test('draws no controls block with nothing to say and nothing to do', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          controls: {
            cancel: false,
            resume: false,
            cancelled: undefined,
            lastRecorded: undefined,
          },
        }),
      ),
    );

    await expect(page.locator('.controls')).toHaveCount(0);
  });

  /** And it takes the weight back the moment there
   *  is no run to pick up. */
  test('makes Replay the primary action with nothing to resume', async ({
    page,
  }) => {
    await showRun(page, seeInit());

    await expect(page.locator('[data-replay]')).toHaveClass(/primary/);
  });

  /**
   * Said only where it is true. DBOS puts the count
   * back to nothing when it picks a dead-lettered
   * run up again, and a person resuming one is
   * entitled to know the give-up clock restarts.
   */
  test('says recovery_attempts starts again from 0 on a run that gave up', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          word: 'gaveUp',
          controls: {
            cancel: false,
            resume: true,
            cancelled: undefined,
            lastRecorded: 'book_appointment · step 2',
          },
        }),
      ),
    );

    await expect(page.locator('[data-attempts-reset]')).toHaveText(
      'recovery_attempts starts again from 0',
    );

    await harness.show(
      seeInit(
        seeRun({
          word: 'cancelled',
          controls: {
            cancel: false,
            resume: true,
            cancelled: '10:58:22',
            lastRecorded: 'book_appointment · step 2',
          },
        }),
      ),
    );

    await expect(page.locator('[data-attempts-reset]')).toHaveCount(0);
  });

  /** The way back to Build. It opens the document
   *  and projects nothing onto it. */
  test('posts openWorkflow from Edit workflow', async ({ page }) => {
    const harness = await showRun(page, seeInit());

    await expect(page.locator('[data-edit-workflow]')).toHaveText(
      seeStrings.editWorkflow,
    );

    await page.locator('[data-edit-workflow]').click();

    expect(await harness.postedOfType('openWorkflow')).toEqual([
      { type: 'openWorkflow', workflowId: 'wf_c9d2f3' },
    ]);
  });

  /** One button, and it acts on the step both views
   *  of the run are marking. */
  test('posts replayFrom with the shared selection', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          graph: GRAPH,
          selectedStep: 1,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );

    await expect(page.locator('[data-replay]')).toHaveCount(1);
    await page.locator('[data-replay]').click();

    expect(await harness.postedOfType('replayFrom')).toEqual([
      { type: 'replayFrom', workflowId: 'wf_c9d2f3', functionId: 1 },
    ]);
  });

  /**
   * The rail only ever shows what the run recorded.
   * Configuration is set on the document, and the
   * document is the editor's.
   */
  test('has no Configure tab', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH })));

    await expect(page.locator('.rail [role="tab"]')).toHaveCount(0);
    await expect(
      page.getByText(inspectorStrings.tabs.configure, { exact: true }),
    ).toHaveCount(0);
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
  test('positions graph nodes with the React Flow sheet', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    await expect(page.locator('.react-flow__node').first()).toHaveCSS(
      'position',
      'absolute',
    );
  });

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

    await expect(page.locator('[data-run-node]')).toHaveCount(3);
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

  /**
   * A trigger writes no row of its own — it compiles
   * into the way the workflow is started rather than
   * into a durable operation — so the run itself is
   * the evidence that it fired. Left grey it would
   * be the one block on a page about a run claiming
   * nothing happened at it.
   */
  test('draws the trigger of a run that exists as done', async ({ page }) => {
    await showRun(
      page,
      seeInit(seeRun({ graph: RUNNING_GRAPH, live: RUNNING }), 'graph'),
    );
    await graphAtRest(page);

    const blocks = page.locator('[data-run-node]');

    await expect(blocks).toHaveCount(7);
    await expect(blocks.first()).toHaveAttribute(
      'data-run-node',
      'booking_requested',
    );
    await expect(blocks.first()).toHaveAttribute('data-state', 'done');
    await expect(blocks.first().locator('.node-line')).toHaveText(
      `${canvasWords.kinds.trigger} · ${filled(
        canvasWords.triggerPhrases.event,
        'booking.requested',
      )}`,
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

  /**
   * A queue block records nothing about the work its
   * children do, so what they are doing is counted
   * and put on the line under its title. This page
   * draws the same block face the canvas does, and
   * it is the page somebody watching a batch go
   * through is actually on.
   */
  test('counts a queue block’s children on the graph', async ({ page }) => {
    await showRun(
      page,
      seeInit(seeRun({ graph: QUEUED_GRAPH, live: QUEUED }), 'graph'),
    );
    await graphAtRest(page);

    const block = page.locator('[data-run-node="index_pages"]');
    const line = block.locator('.node-line');

    await expect(block).toHaveAttribute('data-state', 'running');
    await expect(line).toHaveAttribute('data-line', 'counts');
    await expect(line).toHaveText('8 running · 42 queued');
    await expect(line).toHaveAttribute('title', seeStrings.derived);
  });

  /**
   * The wires are drawn between the ports, so the
   * ports have to be on the page — but nothing here
   * is wired, dragged or dropped on. A port a run
   * page showed would be offering an edit from a
   * page about something that already happened, and
   * one that took a click would swallow the click
   * that picks the block under it.
   */
  test('draws its wires from ports nothing sees or hits', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    const block = page.locator('[data-run-node="parse_request"]');
    const ports = page.locator('.react-flow__handle');

    // Three blocks, each with the two the library
    // routes its wires between.
    await expect(ports).toHaveCount(6);

    for (const port of await ports.all()) {
      await expect(port).toHaveCSS('opacity', '0');
      await expect(port).toHaveCSS('pointer-events', 'none');
    }

    // Hovering a block is what reveals its ports on
    // the canvas. Here there is nothing to reveal.
    await block.hover();
    await expect(ports.first()).toHaveCSS('opacity', '0');

    const hit = await block
      .locator('.react-flow__handle')
      .first()
      .evaluate((port) => {
        const box = port.getBoundingClientRect();
        const at = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );

        return at?.closest('[data-run-node]')?.getAttribute('data-run-node');
      });

    expect(hit).toBe('parse_request');
  });

  /**
   * The arrowheads are declared once for the page
   * and drawn wherever they are referenced, so the
   * element holding them takes up no room. Left to
   * lay itself out it is an SVG of the default 300
   * by 150, which pushes the graph down inside a
   * frame that clips and takes the trigger off the
   * top of it.
   */
  test('gives the arrowheads it declares no room', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    await expect(page.locator('.wire-markers')).toHaveCount(1);

    const laidOut = await page.evaluate(() => {
      const markers = document.querySelector('.wire-markers');
      const pane = document.querySelector('.run-flow');
      const flow = document.querySelector('.react-flow');

      if (markers === null || pane === null || flow === null) return undefined;

      const box = markers.getBoundingClientRect();
      // Where the pane's content starts, which is
      // under the hairline it is framed in.
      const inside =
        pane.getBoundingClientRect().top +
        Number.parseFloat(getComputedStyle(pane).borderTopWidth);

      return {
        width: box.width,
        height: box.height,
        pushed: flow.getBoundingClientRect().top - inside,
      };
    });

    expect(laidOut).toEqual({ width: 0, height: 0, pushed: 0 });
  });

  /**
   * An open chevron rather than a filled triangle,
   * and drawn in the colour of the wire it ends: a
   * head that disagreed with its line would say the
   * run got somewhere the line says it did not.
   */
  test('ends every wire in the colour that wire is drawn in', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    for (const [state, role] of Object.entries(WIRE_ROLES)) {
      const head = page.locator(`#wire-arrow-${state} path`);

      await expect(head).toHaveCount(1);

      const drawn = await head.evaluate((path) => {
        const style = getComputedStyle(path);

        return { fill: style.fill, stroke: style.stroke };
      });
      const expected = colourOf('light', role);

      expect(drawn.fill, state).toBe('none');
      expect(
        sameColour(drawn.stroke, expected),
        `${state}: ${drawn.stroke} ≠ ${expected}`,
      ).toBe(true);
    }

    // And the wire on the page agrees with the head
    // it points at, which is the whole reason the
    // two read one table.
    const agreed = await page
      .locator('.react-flow__edge[data-id="e1"] .wire')
      .evaluate((wire) => {
        const id = /#([\w-]+)/.exec(getComputedStyle(wire).markerEnd)?.[1];
        const head = id === undefined ? null : document.querySelector(`#${id}`);
        const path = head?.querySelector('path');

        return {
          wire: getComputedStyle(wire).stroke,
          head:
            path === null || path === undefined
              ? ''
              : getComputedStyle(path).stroke,
        };
      });

    expect(agreed.head).not.toBe('');
    expect(agreed.wire).toBe(agreed.head);
  });

  /**
   * The same weight the canvas draws a wire at, and
   * the same grid under it: the two graphs are one
   * picture of one workflow, and a person moving
   * between them should not be able to tell which
   * sheet drew what.
   */
  test('draws its wires and its grid the way the canvas does', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    await expect(
      page.locator('.react-flow__edge[data-id="e1"] .wire'),
    ).toHaveCSS('stroke-width', '1.5px');
    await expect(page.locator('.run-flow')).toHaveCSS(
      'background-size',
      `${GRID}px ${GRID}px`,
    );
  });

  /**
   * Every colour on this graph is one this product
   * chose. The library has a default for each of
   * them, picked against a white diagramming page,
   * and a part it draws in one is a part wearing
   * somebody else's theme inside the editor's.
   */
  for (const theme of THEMES_ALL) {
    test(`paints its own ports and wires in ${theme}`, async ({ page }) => {
      await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'), theme);
      await graphAtRest(page);

      const wire = page.locator('.react-flow__edge[data-id="e1"] .wire');
      const state = await wire.getAttribute('data-state');
      const role = WIRE_ROLES[state ?? ''];

      if (role === undefined) throw new Error(`no wire state: ${state}`);

      // The one wire whose state was just read, and
      // not simply the first on the page: the graph
      // draws several, in several states, and reading
      // one against another's role would hold a
      // failure to the colour a finished wire is
      // drawn in.
      const painted = await page.evaluate(() => {
        const port = document.querySelector('.react-flow__handle-bottom');
        const wire = document.querySelector(
          '.react-flow__edge[data-id="e1"] .wire',
        );

        if (port === null || wire === null) return undefined;

        return {
          port: getComputedStyle(port).backgroundColor,
          wire: getComputedStyle(wire).stroke,
        };
      });

      if (painted === undefined) throw new Error('the graph drew nothing');

      for (const [part, colour] of Object.entries(painted)) {
        expect(LIBRARY_COLOURS, `${part} in ${theme}`).not.toContain(colour);
      }

      for (const [part, expected] of [
        ['port', colourOf(theme, 'brand')],
        ['wire', colourOf(theme, role)],
      ] as const) {
        const actual = painted[part];

        expect(
          sameColour(actual, expected),
          `${part} in ${theme}: ${actual} ≠ ${expected}`,
        ).toBe(true);
      }
    });
  }
});

/** What a wire in each state is drawn in, and so
 *  what the head at the end of it is drawn in. */
const WIRE_ROLES: Record<string, Role> = {
  idle: 'hairline-strong',
  active: 'ok',
  done: 'edge-done',
  waiting: 'warn',
  failed: 'fail',
};

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

  /**
   * A row a replay carried over is the earlier run's
   * work, kept: `↺ recorded` says so, and the block
   * it belongs to still draws what it did.
   */
  test('marks a reused row recorded', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ groups: REPLAYED })));

    const carried = page.locator('[data-trace-op="0"]');
    await expect(carried).toHaveAttribute('data-reuse', 'recorded');
    await expect(carried).toContainText(seeStrings.recorded);

    await expect(page.locator('[data-trace-op="1"]')).toHaveAttribute(
      'data-reuse',
      'own',
    );
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

  /**
   * What a queued item did is a run of its own, with
   * its own rows and its own page. All the parent's
   * ledger holds of it is the id, so the id is the
   * way there.
   *
   * Beside the row rather than inside it: the row is
   * already a button that picks the operation, and a
   * button inside a button is one click meaning two
   * things.
   */
  test('offers the run a queued item started', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ groups: QUEUED_GROUPS })),
    );

    const open = page.locator('[data-run-select="wf_child_9f21"]');
    await expect(open).toHaveText('wf_child_9f21');
    await expect(open).toHaveAttribute('title', seeStrings.childRun);

    await open.click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_child_9f21' },
    ]);
    expect(await harness.postedOfType('stepSelect')).toEqual([]);
  });

  /** A row that started nothing offers nothing. */
  test('offers none where no run was started', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ groups: GROUPS })));

    await expect(page.locator('[data-run-select]')).toHaveCount(0);
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
