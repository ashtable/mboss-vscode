import { expect, test, type Locator, type Page } from '@playwright/test';

import type { RunRow } from '../../src/webview/protocol.js';

import { liveStep } from '../../src/test-support/runs.js';
import { filled } from '../../src/webview/fill.js';
import { shortRunId } from '../../src/webview/ids.js';
import { glyphOf, type GlyphState } from '../../src/webview/states.js';

import {
  BY_STATE,
  LINEAGE,
  LIST_ROWS,
  listRow,
  OFF_THE_PAGE,
  runsInit,
  showList,
  SIX_DONE,
} from './fixtures/list.js';
import { mount, THEMES_ALL, type ThemeKind } from './harness.js';
import { colourOf, sameColour, type Role } from './palette.js';
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
        rows: [listRow({ workflowId: 'wf_c9d2f3' })],
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
    await expect(page.locator('.run-list [data-run="wf_c9d2f3"]')).toHaveCount(
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

/** The voice a state is drawn in, as the palette
 *  names it. */
function toneOf(state: GlyphState): Role {
  return glyphOf(state).tone.slice(2) as Role;
}

/** What a theme paints text that says a state in:
 *  the state ink where the theme has one, else the
 *  tone. */
function stateInk(theme: ThemeKind, role: Role): string {
  return colourOf(theme, 'state-ink') || colourOf(theme, role);
}

function item(page: Page, row: RunRow): Locator {
  return page.locator(`li[data-run="${row.workflowId}"]`);
}

function headOf(page: Page, row: RunRow): Locator {
  return item(page, row).locator(':scope > button.run-head');
}

function style(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (node, property) => getComputedStyle(node).getPropertyValue(property),
    name,
  );
}

function heightOf(target: Locator): Promise<number> {
  return target.evaluate((node) => node.getBoundingClientRect().height);
}

/** Which action each Button in a row's action row
 *  is, by the hook a journey finds it by. */
function actionsOf(page: Page, row: RunRow): Promise<string[]> {
  return item(page, row)
    .locator('.run-actions > .btn')
    .evaluateAll((buttons) =>
      buttons.map(
        (button) =>
          [
            'open-run',
            'cancel-run',
            'resume-run',
            'replay-run',
            'ask-agent',
            'copy-run-id',
          ].find((hook) => button.hasAttribute(`data-${hook}`)) ?? '',
      ),
    );
}

/**
 * The distinct lines a row's actions sit on, by
 * where each Button's middle is: the glyph Button is
 * a half pixel taller than the worded ones, and the
 * row centres them on one line.
 */
function linesOf(page: Page, row: RunRow): Promise<number[]> {
  return item(page, row)
    .locator('.run-actions > .btn')
    .evaluateAll((buttons) => [
      ...new Set(
        buttons.map((button) => {
          const box = button.getBoundingClientRect();

          return Math.round(box.top + box.height / 2);
        }),
      ),
    ]);
}

test.describe('the filters', () => {
  for (const theme of THEMES_ALL) {
    test(`counts All, Active and Failed on tabs over one list in ${theme}`, async ({
      page,
    }) => {
      const harness = await showList(
        page,
        runsInit({ counts: { all: 9, active: 2, failed: 4 } }),
        theme,
        { width: 300 },
      );

      const tabs = page.getByRole('tab');
      await expect(page.getByRole('tablist')).toHaveCount(1);
      await expect(tabs).toHaveCount(3);
      await expect(page.locator('[data-filter="recovered"]')).toHaveCount(0);

      await expect(page.locator('[role="tab"][data-filter]')).toHaveCount(3);
      await expect(tabs.locator('.tab-count')).toHaveText(['9', '2', '4']);
      for (const [at, filter] of (
        ['all', 'active', 'failed'] as const
      ).entries()) {
        await expect(tabs.nth(at)).toHaveAttribute('data-filter', filter);
        await expect(tabs.nth(at)).toContainText(runsStrings.filters[filter]);
      }

      // Every tab drives the one list, whichever of
      // them is picked.
      const panel = page.getByRole('tabpanel');
      await expect(panel).toHaveCount(1);
      const listId = await panel.getAttribute('id');
      expect(listId).toBeTruthy();
      for (const at of [0, 1, 2]) {
        await expect(tabs.nth(at)).toHaveAttribute(
          'aria-controls',
          listId ?? '',
        );
      }
      await expect(panel.locator('ol.run-list')).toHaveCount(1);

      const all = page.locator('[data-filter="all"]');
      await expect(all).toHaveAttribute('aria-selected', 'true');
      expect(
        sameColour(
          await style(all.locator('.tab-count'), 'color'),
          stateInk(theme, 'brand'),
        ),
      ).toBe(true);

      await page.locator('[data-filter="failed"]').click();
      await page.locator('[data-filter="active"]').click();

      expect(await harness.postedOfType('runFilter')).toEqual([
        { type: 'runFilter', filter: 'failed' },
        { type: 'runFilter', filter: 'active' },
      ]);
    });

    /** Failed is DBOS's own set, which holds the runs
     *  somebody stopped; they keep their own tone. */
    test(`keeps a cancelled run idle under Failed in ${theme}`, async ({
      page,
    }) => {
      const cancelled = BY_STATE.cancelled;

      await showList(
        page,
        runsInit({
          filter: 'failed',
          rows: [cancelled],
          counts: { all: 9, active: 0, failed: 1 },
        }),
        theme,
        { width: 300 },
      );

      await expect(page.locator('li[data-outcome="idle"]')).toHaveCount(1);

      const rail = headOf(page, cancelled).locator(
        '.status-glyph[data-glyph="rail"]',
      );
      await expect(rail).toHaveCount(1);
      expect(
        sameColour(
          await style(rail, 'background-color'),
          stateInk(theme, 'ink-faint'),
        ),
      ).toBe(true);
    });
  }

  /**
   * The read stops at a page; the count behind the
   * tab does not. So a list that is shorter than
   * its tab says so, and compares with the tab it is
   * under rather than with every run there is.
   */
  test('says how many of how many it shows once the list is capped', async ({
    page,
  }) => {
    const fifty = Array.from({ length: 50 }, (_, at) =>
      listRow({
        workflowId: `${String(at).padStart(8, '0')}-0000-4000-8000-${'0'.repeat(12)}`,
      }),
    );

    const harness = await showList(
      page,
      runsInit({ rows: fifty, counts: { all: 51, active: 0, failed: 0 } }),
    );

    const panel = page.getByRole('tabpanel');
    await expect(panel.locator('li[data-run]')).toHaveCount(50);
    const last = panel.locator(':scope > :last-child');
    await expect(last).toHaveClass(/field-hint/);
    await expect(last).toHaveText(filled(runsStrings.capped, '50', '51'));

    await harness.show(
      runsInit({ rows: SIX_DONE, counts: { all: 6, active: 0, failed: 0 } }),
    );
    await expect(panel.locator('li[data-run]')).toHaveCount(6);
    await expect(panel.locator(':scope > .field-hint')).toHaveCount(0);

    await harness.show(
      runsInit({
        filter: 'failed',
        rows: [BY_STATE.failed],
        counts: { all: 60, active: 0, failed: 1 },
      }),
    );
    await expect(panel.locator('li[data-run]')).toHaveCount(1);
    await expect(panel.locator(':scope > .field-hint')).toHaveCount(0);
  });

  test('says an empty filter is empty', async ({ page }) => {
    const harness = await showList(
      page,
      runsInit({
        filter: 'failed',
        rows: [],
        counts: { all: 6, active: 0, failed: 0 },
      }),
    );

    const panel = page.getByRole('tabpanel');
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.locator('.empty-state')).toHaveCount(1);
    await expect(panel.locator('.empty-title')).toHaveText(
      runsStrings.noFailed,
    );

    await harness.show(
      runsInit({
        filter: 'active',
        rows: [],
        counts: { all: 6, active: 0, failed: 0 },
      }),
    );
    await expect(page.locator('.empty-state')).toHaveCount(1);
    await expect(panel.locator('.empty-title')).toHaveText(
      runsStrings.noActive,
    );

    // With the app down the panel already says why
    // in a card of its own, so an empty filter is a
    // line under the tabs rather than a second card.
    await harness.show(
      runsInit({
        filter: 'failed',
        rows: [],
        counts: { all: 6, active: 0, failed: 0 },
        stack: {
          available: true,
          answered: true,
          services: [
            {
              service: 'app',
              state: 'exited',
              health: 'none',
              ports: [],
              detail: '',
            },
          ],
          busy: undefined,
          detail: undefined,
        },
      }),
    );
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(panel.locator('.empty-state')).toHaveCount(0);
    await expect(panel.locator(':scope > .field-hint')).toHaveText(
      runsStrings.noFailed,
    );
  });
});

test.describe('a run, collapsed', () => {
  for (const theme of THEMES_ALL) {
    test(`draws a run as one line of rail, id, name, mark and word in ${theme}`, async ({
      page,
    }) => {
      await showList(page, runsInit(), theme, { width: 300 });

      await expect(page.locator('li[data-run]')).toHaveCount(LIST_ROWS.length);

      for (const row of LIST_ROWS) {
        const head = headOf(page, row);
        await expect(head).toHaveCount(1);
        await expect(item(page, row)).toHaveAttribute(
          'data-outcome',
          row.state,
        );

        const height = await heightOf(head);
        expect(height).toBeGreaterThanOrEqual(31.5);
        expect(height).toBeLessThanOrEqual(32.5);

        // A run DBOS picked back up keeps its own
        // tone: the line says it recovered, and a
        // failure is still a failure.
        const tone = stateInk(theme, toneOf(row.state));
        const rail = head.locator('.status-glyph[data-glyph="rail"]');
        await expect(rail).toHaveCount(1);
        expect(
          await rail.evaluate((node) => node.getBoundingClientRect().width),
        ).toBe(3);
        expect(sameColour(await style(rail, 'background-color'), tone)).toBe(
          true,
        );

        const id = head.locator('.run-id');
        expect(await style(id, 'font-weight')).toBe('500');
        expect(parseFloat(await style(id, 'font-size'))).toBeCloseTo(11.999, 1);
        expect(
          parseFloat(await style(head.locator('.run-name'), 'font-size')),
        ).toBeCloseTo(11.999, 1);

        const summary = head.locator('.run-summary');
        await expect(summary).toHaveText(row.line);
        await expect(summary).toHaveAttribute('data-provenance', 'derived');
        await expect(summary).toHaveAttribute(
          'title',
          runsStrings.derivedTitle,
        );
        expect(parseFloat(await style(summary, 'font-size'))).toBeCloseTo(
          11.05,
          1,
        );
        expect(
          sameColour(
            await style(summary, 'color'),
            row.state === 'failed'
              ? stateInk(theme, 'fail')
              : colourOf(theme, 'ink-muted'),
          ),
        ).toBe(true);

        const mark = head.locator('.status-glyph[data-glyph="mark"]');
        await expect(mark).toHaveCount(1);
        await expect(mark).toHaveAttribute('aria-hidden', 'true');
        await expect(mark).toHaveText(glyphOf(row.state).mark);
        expect(sameColour(await style(mark, 'color'), tone)).toBe(true);
        expect(parseFloat(await style(mark, 'font-size'))).toBeLessThanOrEqual(
          13,
        );
        expect(
          await mark.evaluate(
            (node, after) =>
              node.compareDocumentPosition(after as Node) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            await summary.elementHandle(),
          ),
        ).toBeTruthy();

        // No rule between runs: the picked one's only
        // edge is its ring, which goes all the way
        // round.
        expect(await style(item(page, row), 'border-bottom-style')).toBe(
          row === BY_STATE.done ? 'solid' : 'none',
        );
        expect(await style(head, 'border-bottom-style')).toBe('none');
      }

      // The three the eye goes to, named.
      expect(toneOf(BY_STATE.done.state)).toBe('ok');
      expect(toneOf(BY_STATE.gaveUp.state)).toBe('fail');
      expect(toneOf(BY_STATE.recoveredFailed.state)).toBe('fail');
      expect(toneOf(BY_STATE.waiting.state)).toBe('warn');
    });
  }

  test('keeps the id, the mark and the state word on screen at 300px', async ({
    page,
  }) => {
    const long = listRow({
      name: 'reconcile_every_ledger_entry_for_the_quarter',
      line: 'done · Sep 11 18:24 · 1 m 12 s · 27 steps · ↻ recovered',
    });

    const harness = await showList(
      page,
      runsInit({ rows: [long], selected: undefined }),
      'light',
      { width: 300 },
    );

    const head = headOf(page, long);
    await expect(head).toHaveCount(1);

    const read = await head.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const inside = (element: Element | null): boolean => {
        const rect = element?.getBoundingClientRect();

        return (
          rect !== undefined &&
          rect.width > 0 &&
          rect.left >= box.left &&
          rect.right <= box.right
        );
      };

      const name = node.querySelector('.run-name') as HTMLElement;
      const summary = node.querySelector('.run-summary') as HTMLElement;

      // How wide six characters of the name's own
      // face are.
      const probe = document.createElement('span');
      probe.textContent = '000000';
      probe.style.font = getComputedStyle(name).font;
      document.body.append(probe);
      const sixCh = probe.getBoundingClientRect().width;
      probe.remove();

      const text = summary.firstChild as Text;
      const word = document.createRange();
      word.setStart(text, 0);
      word.setEnd(text, text.data.indexOf(' '));
      const wordBox = word.getBoundingClientRect();

      const css = getComputedStyle(summary);

      return {
        id: inside(node.querySelector('.run-id')),
        mark: inside(node.querySelector('[data-glyph="mark"]')),
        word:
          wordBox.width > 0 &&
          wordBox.left >= box.left &&
          wordBox.right <= box.right,
        sixCh,
        nameMin: parseFloat(getComputedStyle(name).minWidth),
        nameWidth: name.getBoundingClientRect().width,
        nameCut: name.scrollWidth > name.clientWidth,
        summary: {
          overflow: css.overflow,
          textOverflow: css.textOverflow,
          whiteSpace: css.whiteSpace,
          cut: summary.scrollWidth > summary.clientWidth,
        },
      };
    });

    expect(read.id).toBe(true);
    expect(read.mark).toBe(true);
    expect(read.word).toBe(true);
    expect(read.nameMin).toBeGreaterThanOrEqual(read.sixCh - 0.5);
    expect(read.nameWidth).toBeGreaterThanOrEqual(read.sixCh - 0.5);
    expect(read.nameCut).toBe(true);
    expect(read.summary).toEqual({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      cut: true,
    });

    // The workflow gives its room up first: a line
    // that fits only once the name has given all it
    // can is drawn whole.
    const short = { ...long, line: 'cancelled · 18:10' };
    await harness.show(runsInit({ rows: [short], selected: undefined }));
    await expect(head.locator('.run-summary')).toHaveText(short.line);

    const cut = await head.evaluate((node) => {
      const clipped = (selector: string): boolean => {
        const element = node.querySelector(selector) as HTMLElement;

        return element.scrollWidth > element.clientWidth;
      };

      return { name: clipped('.run-name'), line: clipped('.run-summary') };
    });

    expect(cut).toEqual({ name: true, line: false });
  });

  /** Four characters collide about once in fifty
   *  runs, so the short id always carries the whole
   *  one — and the whole one is written nowhere
   *  else on the row. */
  test('shows a run’s full id only in its short id’s title', async ({
    page,
  }) => {
    const row = BY_STATE.done;

    await showList(page, runsInit());

    const short = headOf(page, row).locator('[data-short-run]');
    await expect(short).toHaveText('#7089');
    await expect(short).toHaveText(shortRunId(row.workflowId));
    await expect(short).toHaveAttribute('title', row.workflowId);
    await expect(short).toHaveAttribute('data-short-run', row.workflowId);

    const written = await item(page, row).evaluate((node, id) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const found: string[] = [];

      for (
        let text = walker.nextNode();
        text !== null;
        text = walker.nextNode()
      ) {
        if ((text.textContent ?? '').includes(id))
          found.push(text.textContent ?? '');
      }

      return found;
    }, row.workflowId);

    expect(written).toEqual([]);
  });

  for (const theme of THEMES_ALL) {
    test(`answers the pointer, and rings the selected run in ${theme}`, async ({
      page,
    }) => {
      await showList(page, runsInit(), theme, { width: 300 });

      const other = headOf(page, BY_STATE.failed);
      await other.hover();
      expect(
        sameColour(
          await style(other, 'background-color'),
          colourOf(theme, 'surface-2'),
        ),
      ).toBe(true);
      expect(await style(other, 'outline-style')).toBe('dashed');

      // The picked run already has a ground and an
      // edge, and the pointer adds neither.
      const picked = headOf(page, BY_STATE.done);
      await picked.hover();
      expect(await style(picked, 'background-color')).toBe('rgba(0, 0, 0, 0)');
      expect(await style(picked, 'outline-style')).toBe('none');

      // The ring goes round the whole run it marks,
      // the actions it opened included, and takes its
      // pixel out of the run's own room so nothing
      // under it moves.
      const selected = item(page, BY_STATE.done);
      expect(
        sameColour(
          await style(selected, 'background-color'),
          colourOf(theme, 'brand-tint'),
        ),
      ).toBe(true);
      expect(await style(selected, 'border-top-style')).toBe('solid');
      expect(await style(selected, 'border-top-width')).toBe('1px');
      expect(
        sameColour(
          await style(selected, 'border-top-color'),
          colourOf(theme, 'selection-ring'),
        ),
      ).toBe(true);

      const height = await heightOf(headOf(page, BY_STATE.done));
      expect(height).toBeGreaterThanOrEqual(31.5);
      expect(height).toBeLessThanOrEqual(32.5);

      const left = (row: RunRow): Promise<number> =>
        headOf(page, row)
          .locator('.run-id')
          .evaluate((node) => node.getBoundingClientRect().left);
      expect(await left(BY_STATE.done)).toBeCloseTo(
        await left(BY_STATE.failed),
        1,
      );

      // A run nobody picked keeps no edge at rest.
      expect(await style(item(page, BY_STATE.failed), 'border-top-style')).toBe(
        'none',
      );

      // The rail runs down everything the picked run
      // opened, not only its line.
      const inner = await selected.evaluate((node) => node.clientHeight);
      const rail = headOf(page, BY_STATE.done).locator(
        '.status-glyph[data-glyph="rail"]',
      );
      expect(inner).toBeGreaterThan(height + 20);
      expect(await heightOf(rail)).toBeCloseTo(inner, 0);
    });
  }

  /** A theme that forces its own colours drops
   *  every ground and keeps every line, so the ring
   *  and the outline are what say which run is
   *  which. */
  test('keeps the ring and the outline in forced colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await showList(page, runsInit(), 'high-contrast', { width: 300 });

    expect(await style(item(page, BY_STATE.done), 'border-top-style')).toBe(
      'solid',
    );

    const other = headOf(page, BY_STATE.failed);
    await other.hover();
    expect(await style(other, 'outline-style')).toBe('dashed');
  });

  test('selects a run from its head, and from its mark', async ({ page }) => {
    const harness = await showList(page, runsInit());
    const failed = BY_STATE.failed;

    await headOf(page, failed).click();
    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: failed.workflowId },
    ]);

    await headOf(page, failed)
      .locator('.status-glyph[data-glyph="mark"]')
      .click();
    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: failed.workflowId },
      { type: 'runSelect', workflowId: failed.workflowId },
    ]);
    expect(await harness.postedOfType('copyRunId')).toEqual([]);
    expect(await harness.postedOfType('openRun')).toEqual([]);
  });
});

test.describe('the selected run', () => {
  test('expands the selected run alone, and says so', async ({ page }) => {
    await showList(page, runsInit());

    await expect(
      page.locator(
        'li:first-child > button.run-head[aria-current="true"][aria-expanded="true"]',
      ),
    ).toHaveCount(1);

    const heads = page.locator('button.run-head');
    await expect(heads).toHaveCount(LIST_ROWS.length);
    await expect(
      page.locator('button.run-head[aria-expanded="false"]'),
    ).toHaveCount(LIST_ROWS.length - 1);
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('[aria-expanded="true"]')).toHaveCount(1);
    await expect(page.locator('.run-body')).toHaveCount(1);
    await expect(page.locator('li:first-child > .run-body')).toHaveCount(1);

    // Nothing a person presses sits inside another
    // thing they press.
    await expect(page.locator('button button')).toHaveCount(0);
  });

  test('offers the actions its state allows, in order', async ({ page }) => {
    const settled = ['open-run', 'replay-run', 'ask-agent', 'copy-run-id'];
    const stopped = [
      'open-run',
      'resume-run',
      'replay-run',
      'ask-agent',
      'copy-run-id',
    ];
    const going = ['open-run', 'cancel-run', 'copy-run-id'];

    const offered: [RunRow, string[]][] = [
      [BY_STATE.done, settled],
      [BY_STATE.failed, settled],
      [BY_STATE.recoveredFailed, settled],
      [BY_STATE.gaveUp, stopped],
      [BY_STATE.cancelled, stopped],
      [BY_STATE.running, going],
      [BY_STATE.recovering, going],
      [BY_STATE.waiting, going],
      [BY_STATE.queued, going],
    ];

    expect(offered).toHaveLength(Object.keys(BY_STATE).length);

    const harness = await showList(page, runsInit());

    for (const [row, hooks] of offered) {
      await harness.show(runsInit({ selected: row.workflowId }));
      await expect(item(page, row).locator('.run-actions > .btn')).toHaveCount(
        hooks.length,
      );
      expect(await actionsOf(page, row)).toEqual(hooks);

      const actions = item(page, row).locator('.run-actions');
      const look = (hook: string, variant: string, ink?: string) =>
        Promise.all([
          expect(actions.locator(`[data-${hook}]`)).toHaveAttribute(
            'data-variant',
            variant,
          ),
          ink === undefined
            ? expect(actions.locator(`[data-${hook}]`)).not.toHaveAttribute(
                'data-ink',
              )
            : expect(actions.locator(`[data-${hook}]`)).toHaveAttribute(
                'data-ink',
                ink,
              ),
        ]);

      await look('open-run', 'secondary', 'brand');
      if (hooks.includes('replay-run')) {
        await look('replay-run', 'secondary', 'brand');
      }
      if (hooks.includes('resume-run')) await look('resume-run', 'primary');
      if (hooks.includes('cancel-run')) await look('cancel-run', 'stop');
      if (hooks.includes('ask-agent')) await look('ask-agent', 'quiet');

      const copy = actions.locator('[data-copy-run-id]');
      await look('copy-run-id', 'quiet');
      await expect(copy).toHaveAttribute('data-copy-run-id', row.workflowId);
      await expect(copy).toHaveAttribute('data-icon', 'copy');
      await expect(copy).toHaveAttribute('title', runsStrings.copyRunId);
      await expect(copy).toHaveAccessibleName(runsStrings.copyRunId);
      expect(runsStrings.copyRunId).toBe('Copy id');
    }
  });

  test('asks for what each action says', async ({ page }) => {
    const done = BY_STATE.done;
    const failed = BY_STATE.failed;
    const harness = await showList(page, runsInit());

    const actions = (row: RunRow): Locator =>
      item(page, row).locator('.run-actions');

    await actions(done).locator('[data-open-run]').click();
    expect(await harness.postedOfType('openRun')).toEqual([
      { type: 'openRun', workflowId: done.workflowId },
    ]);

    // No row that threw: the whole run again.
    const fromStart = actions(done).locator('[data-replay-run]');
    await expect(fromStart).toHaveText(runsStrings.replayFromStart);
    await fromStart.click();

    await actions(done).locator('[data-ask-agent]').click();
    expect(await harness.postedOfType('askAgent')).toEqual([
      { type: 'askAgent', workflowId: done.workflowId },
    ]);

    // From the keyboard, as a glyph with no words on
    // it has to be reachable.
    const copy = actions(done).locator('[data-copy-run-id]');
    await copy.focus();
    await copy.press('Enter');
    expect(await harness.postedOfType('copyRunId')).toEqual([
      { type: 'copyRunId', workflowId: done.workflowId },
    ]);

    // A row that threw: from the first one that did.
    await harness.show(runsInit({ selected: failed.workflowId }));
    const fromHere = actions(failed).locator('[data-replay-run]');
    await expect(fromHere).toHaveText(runsStrings.replayFromHere);
    await fromHere.click();

    expect(await harness.postedOfType('replayRun')).toEqual([
      { type: 'replayRun', workflowId: done.workflowId, from: 'start' },
      { type: 'replayRun', workflowId: failed.workflowId, functionId: 1 },
    ]);

    await harness.show(runsInit({ selected: BY_STATE.running.workflowId }));
    await actions(BY_STATE.running).locator('[data-cancel-run]').click();
    expect(await harness.postedOfType('cancelRun')).toEqual([
      { type: 'cancelRun', workflowId: BY_STATE.running.workflowId },
    ]);

    await harness.show(runsInit({ selected: BY_STATE.gaveUp.workflowId }));
    await actions(BY_STATE.gaveUp).locator('[data-resume-run]').click();
    expect(await harness.postedOfType('resumeRun')).toEqual([
      { type: 'resumeRun', workflowId: BY_STATE.gaveUp.workflowId },
    ]);
  });

  /**
   * The ids are read off the ledger and the step a
   * replay began at is worked out, so the step is the
   * part marked as derived. An id on this page is a
   * way to that row; one that is not stays a name,
   * because picking a run the list does not hold
   * would mark a different one.
   */
  test('says where a replay came from and what came out of it', async ({
    page,
  }) => {
    const { parent, firstFork, secondFork, orphan } = LINEAGE;
    const rows = [parent, firstFork, secondFork, orphan];
    const harness = await showList(page, runsInit({ rows }));

    const forks = item(page, parent).locator('[data-run-fork]');
    await expect(forks).toHaveCount(2);
    await expect(forks.first()).toHaveText(
      '└ replay from step 2 → #4b56 · done',
    );
    await expect(forks.first()).toHaveText(
      filled(
        runsStrings.replayTo,
        filled(runsStrings.fromStep, '2'),
        '#4b56',
        'done',
      ),
    );
    await expect(item(page, parent).locator('[data-replay-of]')).toHaveCount(0);

    const way = forks
      .first()
      .locator(`[data-lineage-run="${firstFork.workflowId}"]`);
    await expect(way).toHaveCount(1);
    await expect(way).toHaveClass(/\bbtn\b/);
    await expect(way).toHaveAttribute('data-variant', 'quiet');
    await expect(
      way.locator(`[data-short-run="${firstFork.workflowId}"]`),
    ).toHaveText('#4b56');

    const steps = item(page, parent).locator(
      '[data-provenance="derived"]:not(.run-summary)',
    );
    await expect(steps).toHaveCount(2);
    await expect(steps).toHaveText([
      filled(runsStrings.fromStep, '2'),
      filled(runsStrings.fromStep, '3'),
    ]);
    for (const at of [0, 1]) {
      await expect(steps.nth(at)).toHaveAttribute('title', runsStrings.derived);
    }

    await way.click();
    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: firstFork.workflowId },
    ]);
    expect(await harness.postedOfType('openRun')).toEqual([]);

    await harness.show(runsInit({ rows, selected: secondFork.workflowId }));
    const replayOf = item(page, secondFork).locator('[data-replay-of]');
    await expect(replayOf).toHaveText('replay of #4126 from step 3');
    await expect(
      replayOf.locator(`[data-lineage-run="${parent.workflowId}"]`),
    ).toHaveCount(1);

    await harness.show(runsInit({ rows, selected: orphan.workflowId }));
    const offPage = item(page, orphan).locator('[data-replay-of]');
    await expect(offPage).toHaveText(
      `replay of ${shortRunId(OFF_THE_PAGE)} from step 1`,
    );
    await expect(
      offPage.locator(`[data-short-run="${OFF_THE_PAGE}"]`),
    ).toHaveAttribute('title', OFF_THE_PAGE);
    await expect(offPage.locator('[data-lineage-run]')).toHaveCount(0);
    await expect(offPage.locator('button')).toHaveCount(0);

    // A run nothing was replayed from on this page
    // says nothing about replays.
    await harness.show(
      runsInit({
        rows: [BY_STATE.failed, ...rows],
        selected: BY_STATE.failed.workflowId,
      }),
    );
    await expect(item(page, BY_STATE.failed).locator('.run-body')).toHaveCount(
      1,
    );
    await expect(page.locator('[data-run-fork]')).toHaveCount(0);
    await expect(page.locator('[data-replay-of]')).toHaveCount(0);
  });

  test('says what a failed run threw, and how often it was picked back up', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      runsInit({ selected: BY_STATE.failed.workflowId }),
    );

    await expect(
      item(page, BY_STATE.failed).locator(
        '.run-body .field-hint[data-tone="fail"] [data-verbatim]',
      ),
    ).toHaveText(BY_STATE.failed.error ?? '');

    await harness.show(runsInit({ selected: BY_STATE.gaveUp.workflowId }));
    const note = item(page, BY_STATE.gaveUp).locator(
      '.run-body .field-hint[data-recovered-note]',
    );
    await expect(note).toHaveText(BY_STATE.gaveUp.recoveredNote ?? '');
    await expect(note).toHaveText(/ · derived$/);
    await expect(
      item(page, BY_STATE.gaveUp).locator('.run-body [data-verbatim]'),
    ).toHaveCount(0);
  });
});

test.describe('six runs on one screen', () => {
  /**
   * What is measured is the list, whatever frame the
   * panel draws round it: the panel is as wide as
   * the list once the frame gives the list the whole
   * width, and until then the frame's own side
   * padding is taken off before the list gets any.
   */
  test('fits six runs and the selected one’s actions in a 400px list', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({ rows: SIX_DONE, counts: { all: 6, active: 0, failed: 0 } }),
      'light',
      { width: 400 },
    );

    const frame = await page.locator('.runs').evaluate((node) => {
      const css = getComputedStyle(node);

      return parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
    });
    await page.setViewportSize({ width: 400 + frame, height: 1800 });

    const list = page.locator('ol.run-list');
    expect(
      await list.evaluate((node) => node.getBoundingClientRect().width),
    ).toBe(400);

    const first = SIX_DONE[0] as RunRow;
    await expect(item(page, first).locator('.run-actions > .btn')).toHaveCount(
      4,
    );
    expect(await linesOf(page, first)).toHaveLength(1);
    await expect(
      page.getByRole('button', { name: runsStrings.copyRunId }),
    ).toHaveCount(1);

    for (const row of SIX_DONE) {
      const height = await heightOf(headOf(page, row));
      expect(height).toBeGreaterThanOrEqual(31.5);
      expect(height).toBeLessThanOrEqual(32.5);
    }

    expect(await heightOf(list)).toBeLessThanOrEqual(260);
  });

  test('wraps the actions at 300px without scrolling sideways', async ({
    page,
  }) => {
    await showList(
      page,
      runsInit({ rows: SIX_DONE, counts: { all: 6, active: 0, failed: 0 } }),
      'light',
      { width: 300 },
    );

    const first = SIX_DONE[0] as RunRow;
    await expect(item(page, first).locator('.run-actions > .btn')).toHaveCount(
      4,
    );
    expect(await linesOf(page, first)).toHaveLength(2);

    const actions = item(page, first).locator('.run-actions');
    expect(
      await actions.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});

test.describe('the run list', () => {
  test('says the list is a projection of the local ledger', async ({
    page,
  }) => {
    await showList(page, runsInit());

    await expect(page.locator('.runs-foot')).toContainText(
      'local only · projected from the local DBOS ledger: ' +
        'dbos.workflow_status + dbos.operation_outputs',
    );
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
        counts: { all: 0, active: 0, failed: 0 },
      }),
    );

    await expect(page.locator('.state')).toHaveText(runsStrings.untrusted);
    await expect(page.locator('li[data-run]')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
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

      await expect(item(page, BY_STATE.done)).toBeVisible();
      expect(ground).not.toBe('rgba(0, 0, 0, 0)');
    });
  }
});
