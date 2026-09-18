import { expect, test, type Locator, type Page } from '@playwright/test';

import type {
  RunByHand,
  RunRow,
  RunsInit,
  TestRunProblem,
} from '../../src/webview/protocol.js';

import { filled } from '../../src/webview/fill.js';
import { shortRunId } from '../../src/webview/ids.js';
import { glyphOf, type GlyphState } from '../../src/webview/states.js';
import { when } from '../../src/webview/time.js';

import {
  APP_DOWN,
  BY_STATE,
  DAEMON_DOWN,
  DATABASE_REFUSED,
  FIRST_PAINT,
  frameInit,
  LINEAGE,
  LIST_ROWS,
  listRow,
  MANUAL,
  NO_DATABASE,
  NO_DOCKER,
  NO_PROJECT,
  NO_RUNS,
  NO_RUNS_CONFIGURED,
  OFF_THE_PAGE,
  runsInit,
  SCHEDULE,
  showList,
  SIX_DONE,
  THIRD_SERVICE,
  UNTRUSTED,
  WORKER_ABSENT,
} from './fixtures/list.js';
import { mount, THEMES_ALL, type ThemeKind } from './harness.js';
import { labelBeforeValue } from './labels.js';
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

/**
 * The frame round the list: who these runs belong
 * to, what can be started, and where the list came
 * from.
 *
 * The panel is one column that never scrolls: the
 * header and the controls stay put, and only the
 * rows under them move. Everything a run needs to
 * be started is on two lines above the list, and
 * the one line under it says what the list is a
 * picture of.
 */
test.describe('the panel frame', () => {
  for (const theme of THEMES_ALL) {
    test(`says whose runs these are, starts a run and lists the services in ${theme}`, async ({
      page,
    }) => {
      const harness = await showList(page, frameInit(), theme, { width: 300 });

      const head = page.locator('.runs-head');
      const title = head.locator('.runs-title');

      await expect(title).toHaveText(runsStrings.heading);
      expect(await style(title, 'font-weight')).toBe('600');
      expect(Number.parseFloat(await style(title, 'font-size'))).toBeCloseTo(
        13,
        1,
      );

      const workspace = head.locator('.runs-project');

      await expect(workspace).toHaveText(
        filled(runsStrings.workspace, 'groom-shop'),
      );
      expect(
        Number.parseFloat(await style(workspace, 'font-size')),
      ).toBeCloseTo(11.05, 1);
      expect(
        sameColour(
          await style(workspace, 'color'),
          colourOf(theme, 'ink-faint'),
        ),
      ).toBe(true);

      expect(await padOf(head)).toBe('10px 14px 10px 14px');
      expect(await style(head, 'border-bottom-width')).toBe('1px');
      expect(
        sameColour(
          await style(head, 'border-bottom-color'),
          colourOf(theme, 'hairline'),
        ),
      ).toBe(true);

      const runRow = page.locator('[data-zone="stack"]');

      expect(await padOf(runRow)).toBe('10px 14px 10px 14px');
      expect(
        await style(page.locator('.runs-input'), 'border-bottom-width'),
      ).toBe('1px');

      const run = page.locator('[data-run-workflow]');

      await expect(run).toHaveClass(/\bbtn\b/);
      await expect(run).toHaveAttribute('data-variant', 'primary');
      expect(
        sameColour(
          await style(run, 'background-color'),
          colourOf(theme, 'primary-ground'),
        ),
      ).toBe(true);

      await run.click();

      expect(await harness.postedOfType('runWorkflow')).toEqual([
        { type: 'runWorkflow', workflow: 'groom_booking' },
      ]);

      await expect(page.getByText('Debug run')).toHaveCount(0);

      const ports = page.locator('.runs-ports [data-service]');

      await expect(ports).toHaveCount(3);
      expect(await ports.allTextContents()).toEqual([
        'postgres :5432',
        'app :3000',
        `worker ${runsStrings.serviceState.exited}`,
      ]);
      expect(
        await ports.evaluateAll((spans) =>
          spans.map((span) => span.getAttribute('data-state')),
        ),
      ).toEqual(['running', 'running', 'exited']);
      expect(
        Number.parseFloat(await style(ports.first(), 'font-size')),
      ).toBeCloseTo(10.01, 1);
      expect(
        sameColour(
          await style(page.locator('.runs-ports'), 'color'),
          colourOf(theme, 'ink-faint'),
        ),
      ).toBe(true);

      const strip = page.locator('[role="tablist"]');

      expect(await style(strip, 'padding-left')).toBe('14px');
      expect(await style(strip, 'padding-right')).toBe('14px');

      const foot = page.locator('.runs-foot');

      expect(await padOf(foot)).toBe('8px 14px 8px 14px');
      expect(await style(foot, 'border-top-width')).toBe('1px');
      expect(
        sameColour(
          await style(foot, 'border-top-color'),
          colourOf(theme, 'hairline'),
        ),
      ).toBe(true);

      await expect(
        page.getByRole('textbox', { name: runsStrings.input }),
      ).toHaveAttribute('data-input', '');
      await labelBeforeValue(page.locator('[data-property][data-field=input]'));
    });
  }

  /**
   * One workflow is no choice, and a menu of one is
   * a control that says nothing. A schedule workflow
   * is listed so a person can see it exists, and
   * offers no way to start it.
   */
  test('offers a workflow picker only when there is a choice', async ({
    page,
  }) => {
    const harness = await showList(page, frameInit(), 'light', { width: 300 });

    await expect(page.locator('[data-workflow-picker]')).toHaveCount(0);

    await harness.show(frameInit({ testRun: byHand(MANUAL.name) }));

    const picker = page.getByRole('combobox', { name: runsStrings.workflow });

    await expect(picker).toHaveAttribute('data-workflow-picker', '');
    await picker.selectOption(SCHEDULE.name);

    expect(await harness.postedOfType('selectWorkflow')).toEqual([
      { type: 'selectWorkflow', workflow: 'nightly_sync' },
    ]);

    await harness.show(frameInit({ testRun: byHand(SCHEDULE.name) }));

    await expect(page.locator('.runs-input')).toContainText(
      runsStrings.scheduledNotRunnable,
    );
    await expect(page.locator('[data-run-workflow]')).toHaveCount(0);
    await expect(page.locator('[data-input]')).toHaveCount(0);

    await harness.show(frameInit({ testRun: byHand(undefined) }));

    await expect(page.locator('[data-run-workflow]')).toHaveCount(0);
    await expect(page.locator('.runs-input')).not.toContainText(
      runsStrings.scheduledNotRunnable,
    );
    await expect(page.locator('[data-input]')).toHaveCount(1);
    await expect(page.locator('.runs-ports [data-service]')).toHaveCount(3);
  });

  /**
   * What is listening is the first thing to check
   * when a start goes nowhere, so the line gives way
   * to the controls beside it but never disappears
   * behind a long workflow title.
   */
  test('keeps the ports line readable beside a long workflow title', async ({
    page,
  }) => {
    await showList(
      page,
      frameInit({
        testRun: {
          workflows: [
            { ...MANUAL, title: 'Reconcile the ledgers every evening' },
            SCHEDULE,
          ],
          selected: MANUAL.name,
          input: '',
          hint: undefined,
          problem: undefined,
        },
      }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('[data-workflow-picker]')).toHaveCount(1);

    const ports = page.locator('.runs-ports');

    await expect(ports.locator('[data-service]')).toHaveCount(3);
    await expect(ports).toBeVisible();
    expect(
      await ports.evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThan(40);
  });

  /**
   * A project whose every saved workflow runs on a
   * schedule is the shape that sentence exists for.
   * The host picks nothing in it, so the panel has
   * to read the list rather than the pick, or it
   * offers a box that can start nothing.
   */
  test('says a schedule workflow runs itself, whichever one is saved', async ({
    page,
  }) => {
    await showList(
      page,
      frameInit({
        testRun: {
          workflows: [SCHEDULE],
          selected: undefined,
          input: '',
          hint: undefined,
          problem: undefined,
        },
      }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('.runs-input')).toContainText(
      runsStrings.scheduledNotRunnable,
    );
    await expect(page.locator('[data-input]')).toHaveCount(0);
    await expect(page.locator('[data-run-workflow]')).toHaveCount(0);
  });

  /**
   * A run this window started is the top row of the
   * list, marked and opened out, rather than a card
   * of its own above it.
   */
  test('draws no session card and opens with the newest run selected', async ({
    page,
  }) => {
    await showList(page, frameInit(), 'light', { width: 300 });

    for (const zone of ['session', 'running-now', 'test-run']) {
      await expect(page.locator(`[data-zone="${zone}"]`)).toHaveCount(0);
    }

    await expect(page.locator('[data-stack-toggle]')).toHaveCount(0);
    await expect(
      page.locator(
        '.run-list > li:first-child >' +
          ' button[aria-current="true"][aria-expanded="true"]',
      ),
    ).toHaveCount(1);
  });

  /**
   * A developer reads a ledger against a clock, and
   * a clock that needs a suffix to be read is one
   * more thing between them and the run that went
   * wrong.
   */
  test('writes every time in 24 hours', async ({ page }) => {
    const now = Date.UTC(2026, 8, 11, 20, 0);
    const today = when(Date.UTC(2026, 8, 11, 18, 24), now, 'en-US');
    const older = when(Date.UTC(2026, 8, 9, 18, 17), now, 'en-US');
    const rows = [
      listRow({ line: `done · ${today} · 1.6 s` }),
      listRow({
        workflowId: '4b56e4f6-4254-4423-bc97-b7a2d7838de9',
        line: `done · ${older} · 1.5 s`,
      }),
    ];

    await showList(
      page,
      frameInit({
        rows,
        counts: { all: 2, active: 0, failed: 0 },
        selected: rows[0]?.workflowId,
      }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('li[data-run]')).toHaveCount(2);

    const drawn = await page.locator('.runs-body').innerText();

    expect(drawn).toContain(today);
    expect(drawn).toContain(older);
    expect(drawn).not.toMatch(/\b(?:AM|PM)\b/);
  });

  /**
   * One line, and the address it was read from in
   * its title rather than on a line of its own.
   * Conductor is a licence this product does not
   * need, so a window that has none is never told
   * about one.
   */
  test('says in one line where the list comes from', async ({ page }) => {
    const harness = await showList(page, frameInit(), 'light', { width: 300 });

    const foot = page.locator('.runs-foot');
    const hint = foot.locator('.field-hint');

    await expect(foot.locator(':scope > *')).toHaveCount(1);
    await expect(hint).toHaveText(runsStrings.projection);
    await expect(hint).toHaveAttribute(
      'title',
      'dbos.workflow_status · localhost:5432/app',
    );
    await expect(foot).not.toContainText('Conductor');
    await expect(page.locator('[data-production]')).toHaveCount(0);

    await harness.show(frameInit({ production: { configured: true } }));

    const open = page.locator('[data-production="configured"]');

    await expect(open).toHaveCount(1);
    await expect(open).toHaveClass(/\bbtn\b/);
    // The same words on the state with no list are
    // drawn as a second action, so these are too.
    await expect(open).toHaveAttribute('data-variant', 'secondary');
    await expect(open).toHaveText(runsStrings.openProduction);
    await open.click();

    expect(await harness.postedOfType('openProduction')).toEqual([
      { type: 'openProduction' },
    ]);
  });

  /**
   * The page itself never scrolls: the rows do. So
   * the way to start a run is still there after
   * somebody has read to the end of the history.
   */
  test('keeps the header, Run and the tabs in view while the list scrolls', async ({
    page,
  }) => {
    const rows = Array.from({ length: 50 }, (_, at) =>
      listRow({
        workflowId: `b6e3d1a0-19dd-4d4a-a03a-09e77cff${String(at).padStart(4, '0')}`,
        line: 'done · 18:24 · 1.6 s · 3 steps',
      }),
    );

    await showList(
      page,
      frameInit({
        rows,
        counts: { all: 50, active: 0, failed: 0 },
        selected: rows[0]?.workflowId,
      }),
      'light',
      { width: 400 },
    );
    await page.setViewportSize({ width: 400, height: 320 });

    await expect(page.locator('li[data-run]')).toHaveCount(50);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight === window.innerHeight,
      ),
    ).toBe(true);

    const body = page.locator('.runs-body');

    expect(
      await body.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);

    const pinned = ['.runs-head', '[data-zone="stack"]', '[role="tablist"]'];
    const before = await topsOf(page, pinned);

    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });

    expect(await topsOf(page, pinned)).toEqual(before);

    const foot = await page.evaluate(() => {
      const port = document.querySelector('.runs-body')!;
      const line = document.querySelector('.runs-foot')!;

      return {
        below:
          line.getBoundingClientRect().top - port.getBoundingClientRect().top,
        past:
          line.getBoundingClientRect().bottom -
          port.getBoundingClientRect().bottom,
      };
    });

    // A pixel of slack under the second: the
    // browser counts a scroll port's height in whole
    // pixels, so scrolling to the end lands within
    // one of it.
    expect(foot.below).toBeGreaterThan(0);
    expect(foot.past).toBeLessThan(1);
  });

  /**
   * And what is pinned is capped at half the pane,
   * so a long refusal above the list cannot leave a
   * short pane with no runs in it at all.
   */
  test('keeps what is pinned to half the pane', async ({ page }) => {
    await showList(
      page,
      frameInit({
        testRun: byHand(MANUAL.name, {
          detail:
            'The app refused that start: no route answered POST /runs, ' +
            'and the container was built before this workflow was saved, ' +
            'so rebuilding it is what makes the route exist.',
          rebuildToRun: true,
          workflowId: 'wf_refused',
        }),
      }),
      'light',
      { width: 400 },
    );
    await page.setViewportSize({ width: 400, height: 320 });

    const pinned = page.locator('.runs-controls');

    expect(await heightOf(pinned)).toBeLessThanOrEqual(160);
    expect(
      await pinned.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    await expect(page.locator('li[data-run]')).toHaveCount(9);
  });

  /**
   * A start that was refused is filed under an id
   * like any other, so the agent can be handed the
   * whole of it. A refusal checked before anything
   * was filed has no run to ask about.
   */
  test('offers Ask agent beside a refused start filed under an id', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      frameInit({
        testRun: byHand(MANUAL.name, {
          detail: 'The app refused that start.',
          rebuildToRun: false,
          workflowId: 'wf_refused',
        }),
      }),
      'light',
      { width: 300 },
    );

    const problem = page.locator('[data-problem]');

    await expect(problem).toContainText('refused that start');
    await expect(problem.locator('.btn[data-ask-agent]')).toHaveAttribute(
      'data-variant',
      'quiet',
    );
    await problem.locator('[data-ask-agent]').click();

    expect(await harness.postedOfType('askAgent')).toEqual([
      { type: 'askAgent', workflowId: 'wf_refused' },
    ]);

    await harness.show(
      frameInit({
        testRun: byHand(MANUAL.name, {
          detail: 'That input is not JSON, so nothing was sent.',
          rebuildToRun: false,
          workflowId: undefined,
        }),
      }),
    );

    await expect(page.locator('[data-problem]')).toContainText('not JSON');
    await expect(page.locator('[data-problem] [data-ask-agent]')).toHaveCount(
      0,
    );
  });

  test('says the app is stale and offers the same Rebuild', async ({
    page,
  }) => {
    const harness = await showList(
      page,
      frameInit({
        testRun: {
          ...byHand(MANUAL.name, {
            detail: 'The running app was built before this workflow.',
            rebuildToRun: true,
            workflowId: 'wf_refused',
          }),
          hint: 'claimId is the idempotency key · a new value is a new run',
        },
      }),
      'light',
      { width: 300 },
    );

    // Both lines are about the box and neither is
    // in it, so a screen reader meets them with the
    // box rather than only by reading on past it.
    const box = page.getByRole('textbox', { name: runsStrings.input });

    await expect(box).toHaveAccessibleDescription(/idempotency/);
    await expect(box).toHaveAccessibleDescription(/built before this workflow/);
    await labelBeforeValue(page.locator('[data-property][data-field=input]'));

    const problem = page.locator('[data-problem]');
    const rebuild = problem.locator('[data-rebuild]');

    await expect(problem).toContainText('built before this workflow');
    await expect(rebuild).toHaveClass(/\bbtn\b/);
    await expect(rebuild).toHaveAttribute('data-variant', 'quiet');
    expect(
      sameColour(await style(rebuild, 'color'), stateInk('light', 'brand')),
    ).toBe(true);

    await rebuild.click();

    expect(await harness.postedOfType('stackRebuild')).toEqual([
      { type: 'stackRebuild' },
    ]);
  });

  test('offers no Rebuild for a problem Rebuild does not fix', async ({
    page,
  }) => {
    await showList(
      page,
      frameInit({
        testRun: byHand(MANUAL.name, {
          detail: 'That input is not JSON, so nothing was sent.',
          rebuildToRun: false,
          workflowId: undefined,
        }),
      }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('[data-problem]')).toContainText('not JSON');
    await expect(page.locator('[data-problem] [data-rebuild]')).toHaveCount(0);
  });

  /**
   * The extension holds the input, so every change
   * to the box is said as it is made, and a start
   * names only the workflow: what it runs with is
   * whatever the extension was last told.
   */
  test('says each change to the input, and starts without it', async ({
    page,
  }) => {
    const harness = await showList(page, frameInit(), 'light', { width: 300 });

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
      frameInit({ testRun: { ...byHand(MANUAL.name), input: '{"n":1}' } }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('[data-input]')).toHaveCount(1);
    await expect(page.locator('[data-input]')).toHaveValue('{"n":1}');
  });

  /** No workflow is set while none can be run, and
   *  what is typed is still the extension's. */
  test('says a change to the input with no workflow set', async ({ page }) => {
    const harness = await showList(page, frameInit(), 'light', { width: 300 });

    await harness.show(frameInit({ testRun: byHand(undefined) }));
    await page.locator('[data-input]').fill('{}');

    expect(await harness.postedOfType('runInput')).toEqual([
      { type: 'runInput', text: '{}' },
    ]);
  });

  test('shows the idempotency hint for the workflow now picked', async ({
    page,
  }) => {
    await showList(
      page,
      frameInit({
        testRun: {
          ...byHand(MANUAL.name),
          hint: 'claimId is the idempotency key · a new value is a new run',
        },
      }),
      'light',
      { width: 300 },
    );

    await expect(page.locator('.runs-input')).toContainText(
      'claimId is the idempotency key',
    );
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

/** The four sides of a box's padding, in the order
 *  a stylesheet writes them. */
function padOf(target: Locator): Promise<string> {
  return target.evaluate((node) => {
    const css = getComputedStyle(node);

    return [
      css.paddingTop,
      css.paddingRight,
      css.paddingBottom,
      css.paddingLeft,
    ].join(' ');
  });
}

/** Where each part of the frame starts, so a scroll
 *  can be shown to have moved none of them. */
function topsOf(page: Page, selectors: string[]): Promise<number[]> {
  return page.evaluate(
    (all) =>
      all.map(
        (one) => document.querySelector(one)!.getBoundingClientRect().top,
      ),
    selectors,
  );
}

/** Both saved workflows, one of them picked, and
 *  whatever was wrong with the last start. */
function byHand(
  selected: string | undefined,
  problem?: TestRunProblem,
): RunByHand {
  return {
    workflows: [MANUAL, SCHEDULE],
    selected,
    input: '',
    hint: undefined,
    problem,
  };
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

  /**
   * Following a replay from the keyboard marks a
   * different row, and the Button that was pressed
   * goes with the row that was open. So the focus
   * goes to the head of the run being marked, which
   * is what the panel is now about — once, and only
   * for the repaint that answers.
   */
  test('puts the focus on the run a replay line points at', async ({
    page,
  }) => {
    const { parent, firstFork, secondFork, orphan } = LINEAGE;
    const rows = [parent, firstFork, secondFork, orphan];
    const harness = await showList(
      page,
      runsInit({ rows, selected: parent.workflowId }),
    );

    const way = item(page, parent).locator(
      `[data-lineage-run="${firstFork.workflowId}"]`,
    );

    await expect(way).toHaveCount(1);
    await way.focus();
    await page.keyboard.press('Enter');

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: firstFork.workflowId },
    ]);

    await harness.show(runsInit({ rows, selected: firstFork.workflowId }));
    await expect(headOf(page, firstFork)).toBeFocused();

    // Spent on that one repaint: a later one nobody
    // asked for leaves the focus where the person
    // has since put it.
    await headOf(page, parent).focus();
    await harness.show(runsInit({ rows, selected: secondFork.workflowId }));
    await expect(headOf(page, parent)).toBeFocused();
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

/**
 * Every state the panel can be in short of a list,
 * and what it says in each.
 *
 * One card at a time and one way out at most: the
 * fact first, then the single thing that would
 * change it. Which states these are is the table's
 * answer, and the cases here are about what gets
 * drawn for one — that a stopped database is never
 * told as a stopped app, and that a state with
 * nothing to offer offers nothing.
 */
test.describe('what the panel says when there is no list', () => {
  for (const theme of THEMES_ALL) {
    test(`draws the header alone before the first read in ${theme}`, async ({
      page,
    }) => {
      await showList(page, FIRST_PAINT, theme, { width: 300 });

      const runs = page.locator('.runs');
      await expect(runs.locator('.runs-head')).toContainText(
        runsStrings.heading,
      );
      await expect(runs.locator(':scope > *')).toHaveCount(1);

      for (const absent of [
        '.empty-state',
        '[data-run-workflow]',
        '[role="tablist"]',
        '.runs-foot',
      ]) {
        await expect(page.locator(absent)).toHaveCount(0);
      }
    });
  }

  /**
   * A daemon that is installed and not running
   * lists no containers, which is exactly the
   * silence of a project nobody has started. So the
   * panel says which of the two it is, and asking
   * again is the whole of what to do about it.
   */
  test('says Docker is not answering, with Refresh and nothing else', async ({
    page,
  }) => {
    const harness = await showList(page, DAEMON_DOWN, 'light', { width: 300 });

    const card = page.locator('.empty-state');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-kind', 'error');
    await expect(card.locator('.empty-title')).toHaveText(
      runsStrings.dockerSilentTitle,
    );
    await expect(card.locator('.empty-detail')).toHaveText(
      runsStrings.dockerSilentDetail,
    );

    const again = card.locator('.btn');
    await expect(again).toHaveCount(1);
    await expect(again).toHaveText(runsStrings.refresh);

    for (const absent of ['.services', '[data-stack-up]', '.runs-foot']) {
      await expect(page.locator(absent)).toHaveCount(0);
    }

    await again.click();
    expect(await harness.postedOfType('runRefresh')).toEqual([
      { type: 'runRefresh' },
    ]);
  });

  /**
   * A database that would not answer is most often
   * the project's own, stopped — so the panel names
   * the database, lists what compose declares and
   * offers to start the lot.
   */
  test('names the refusing database, its services and Start app', async ({
    page,
  }) => {
    const harness = await showList(page, DATABASE_REFUSED, 'light', {
      width: 300,
    });

    await expect(page.locator('.services > li[data-service]')).toHaveCount(2);

    const card = page.locator('.empty-state');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.empty-title')).toHaveText(
      runsStrings.databaseRefusedTitle,
    );
    await expect(card.locator('.empty-detail')).toContainText('ECONNREFUSED');

    const tops = await topsOf(page, ['.services', '.empty-state']);
    expect(tops[0]!).toBeLessThan(tops[1]!);

    const start = page.locator('[data-stack-up]');
    await expect(start).toHaveCount(1);
    await expect(start).toHaveText(runsStrings.startApp);

    for (const absent of [
      '[data-run-workflow]',
      '[data-input]',
      '[role="tablist"]',
      '.runs-foot',
    ]) {
      await expect(page.locator(absent)).toHaveCount(0);
    }

    await start.click();
    expect(await harness.postedOfType('stackUp')).toEqual([
      { type: 'stackUp' },
    ]);

    await harness.show({
      ...DATABASE_REFUSED,
      stack: { ...DATABASE_REFUSED.stack, busy: 'up' },
    });

    await expect(start).toHaveAttribute('aria-busy', 'true');
    await expect(start).toHaveText(runsStrings.starting);
  });

  /**
   * Only the container the workflows run in decides
   * whether the panel is in the app-down state. A
   * third service somebody stopped is a fact on the
   * ports line and nothing more.
   */
  test('draws a stopped third service in the ports line, not as a state', async ({
    page,
  }) => {
    await showList(page, THIRD_SERVICE, 'light', { width: 300 });

    const worker = page.locator('[data-service="worker"]');
    await expect(worker).toHaveCount(1);
    await expect(worker).toHaveAttribute('data-state', 'exited');
    await expect(worker).toHaveText(
      filled(
        runsStrings.servicePorts,
        'worker',
        runsStrings.serviceState.exited,
      ),
    );

    await expect(page.locator('.empty-state')).toHaveCount(0);
    await expect(page.locator('.services')).toHaveCount(0);
  });

  /**
   * An empty ledger with the app already up: what
   * is left to do is set a workflow going, and the
   * panel offers the one that is picked.
   */
  test('says nothing has run yet, and offers to run the selected workflow', async ({
    page,
  }) => {
    const harness = await showList(page, NO_RUNS, 'light', { width: 300 });

    const card = page.locator('.empty-state');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-kind', 'empty');
    await expect(card.locator('.empty-title')).toHaveText(
      runsStrings.emptyTitle,
    );
    await expect(card.locator('.empty-detail')).toHaveText(
      runsStrings.emptyDetail,
    );
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);

    // Neither the button this panel was drawn with
    // and never built, nor the line under the card
    // about somewhere else.
    const said = await page.locator('.runs').innerText();
    expect(said).not.toContain('Debug run');
    expect(said).not.toContain('deployment context only');

    const run = card.locator('.btn');
    await expect(run).toHaveCount(1);
    await expect(run).toHaveText(filled(runsStrings.runNamed, MANUAL.name));
    await expect(run).toHaveAttribute('data-variant', 'quiet');
    await expect(run).toHaveAttribute('data-ink', 'brand');

    await run.click();
    expect(await harness.postedOfType('runWorkflow')).toEqual([
      { type: 'runWorkflow', workflow: MANUAL.name },
    ]);

    // A workflow that runs on its own is not one
    // anybody starts from here.
    await harness.show({
      ...NO_RUNS,
      testRun: { ...NO_RUNS.testRun, selected: SCHEDULE.name },
    });

    await expect(page.locator('.empty-state')).toHaveCount(1);
    await expect(page.locator('.empty-state .btn')).toHaveCount(0);
  });

  for (const theme of THEMES_ALL) {
    test(`draws every EmptyState the same way in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'runs', theme, { width: 300 });
      let marks = 0;

      for (const [init, kind] of CARDS) {
        await harness.show(init);

        const card = page.locator('.empty-state');
        await expect(card).toHaveCount(1);
        await expect(card).toHaveAttribute('data-kind', kind);
        expect(await padOf(card)).toBe('28px 16px 28px 16px');

        const detail = card.locator('.empty-detail');
        await expect(detail).toHaveCount(1);
        expect(parseFloat(await style(detail, 'font-size'))).toBeCloseTo(
          11.999,
          1,
        );
        expect(
          sameColour(
            await style(detail, 'color'),
            colourOf(theme, 'ink-faint'),
          ),
        ).toBe(true);

        const mark = card.locator('.empty-mark');
        await expect(mark).toHaveCount(kind === 'error' ? 1 : 0);

        if (kind === 'error') {
          marks += 1;
          expect(
            sameColour(await style(mark, 'color'), stateInk(theme, 'fail')),
          ).toBe(true);
        }

        expect(await card.locator('.btn').count()).toBeLessThanOrEqual(1);
      }

      expect(marks).toBe(CARDS.filter(([, kind]) => kind === 'error').length);
    });
  }

  /**
   * The app being down does not make the runs
   * already recorded unreadable, so the list stays
   * under the card that says why nothing new can be
   * started.
   */
  test('keeps Start app as the app-down state’s one way out', async ({
    page,
  }) => {
    await showList(page, APP_DOWN, 'light', { width: 300 });

    const card = page.locator('.empty-state');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.empty-title')).toHaveText(
      runsStrings.appDownTitle,
    );
    await expect(card.locator('.empty-detail')).toHaveText(
      runsStrings.appDownDetail,
    );

    const ways = card.locator('.btn[data-variant]');
    await expect(ways).toHaveCount(1);
    await expect(ways).toHaveAttribute('data-stack-up', '');

    await expect(page.locator('li[data-run]')).toHaveCount(SIX_DONE.length);
    await expect(page.locator('.runs-foot')).toHaveCount(1);

    // Nothing can be started with the app down, so
    // nothing offers to.
    for (const absent of ['[data-run-workflow]', '[data-input]']) {
      await expect(page.locator(absent)).toHaveCount(0);
    }

    const order = [
      '.services',
      '.empty-state',
      '[role="tablist"]',
      'ol.run-list',
      '.runs-foot',
    ];

    for (const one of order) {
      await expect(page.locator(one)).toHaveCount(1);
    }

    const tops = await topsOf(page, order);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  /**
   * And a filter with nothing in it under that card
   * is a line, not a second card: two cards on one
   * panel read as two things being wrong.
   */
  test('says an empty filter under the app-down state as a hint', async ({
    page,
  }) => {
    await showList(
      page,
      { ...APP_DOWN, filter: 'failed', rows: [], selected: undefined },
      'light',
      { width: 300 },
    );

    const card = page.locator('.empty-state');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.empty-title')).toHaveText(
      runsStrings.appDownTitle,
    );

    const hint = page.locator('.tabpanel > .field-hint');
    await expect(hint).toHaveCount(1);
    await expect(hint).toHaveText(runsStrings.noFailed);
  });

  /**
   * Four states nobody can act on from this panel:
   * the folder, the project, the file naming a
   * database and Docker itself are all somewhere
   * else. Each says what is true and stops there.
   */
  test('says why there is nothing to read, with no way out to offer', async ({
    page,
  }) => {
    const harness = await showList(page, NO_PROJECT, 'light', { width: 300 });

    const blocked: [RunsInit, string, 'empty' | 'error'][] = [
      [NO_PROJECT, runsStrings.noProjectTitle, 'empty'],
      [NO_DATABASE, runsStrings.noDatabaseTitle, 'error'],
      [NO_DOCKER, runsStrings.noDockerTitle, 'error'],
    ];

    for (const [init, title, kind] of blocked) {
      await harness.show(init);

      const card = page.locator('.empty-state');
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute('data-kind', kind);
      await expect(card.locator('.empty-title')).toHaveText(title);
      await expect(card.locator('.empty-mark')).toHaveCount(
        kind === 'error' ? 1 : 0,
      );
      await expect(card.locator('.btn')).toHaveCount(0);
    }

    await harness.show(UNTRUSTED);
    await expect(page.locator('.empty-title')).toHaveText(
      runsStrings.untrustedTitle,
    );
    await expect(page.locator('.empty-detail')).toHaveText(
      runsStrings.untrusted,
    );
    await expect(page.locator('.empty-state .btn')).toHaveCount(0);

    await harness.show(NO_DATABASE);
    await expect(page.locator('.empty-detail')).toHaveText(NO_DATABASE.detail!);

    await harness.show(DATABASE_REFUSED);
    await expect(page.locator('.empty-detail')).toContainText('ECONNREFUSED');
  });

  /**
   * What compose says of each declared service, and
   * nothing anybody can press: Start app runs the
   * whole stack, so a control per row would be four
   * ways to do one thing.
   */
  test('draws each service as a dot, its name and what it is doing', async ({
    page,
  }) => {
    const harness = await showList(page, APP_DOWN, 'light', { width: 300 });

    const rows = page.locator('.services > li[data-service]');
    await expect(rows).toHaveCount(APP_DOWN.stack.services.length);
    expect(await padOf(page.locator('.services'))).toBe('10px 14px 10px 14px');

    for (const service of APP_DOWN.stack.services) {
      const row = page.locator(`li[data-service="${service.service}"]`);

      await expect(row).toHaveAttribute('data-state', service.state);
      expect(await padOf(row)).toBe('5px 0px 5px 0px');
      await expect(row.locator('.service-name')).toHaveText(service.service);
      await expect(row.locator('.service-detail')).toHaveText(service.detail);
      await expect(row.locator('.btn')).toHaveCount(0);

      const dot = row.locator('.status-glyph[data-glyph="dot"]');
      await expect(dot).toHaveCount(1);
      await expect(dot).toHaveAttribute(
        'aria-label',
        filled(
          runsStrings.serviceLabel,
          service.service,
          runsStrings.serviceState[service.state],
        ),
      );
      expect(
        await dot.evaluate((node) => {
          const box = node.getBoundingClientRect();

          return [box.width, box.height];
        }),
      ).toEqual([8, 8]);
    }

    const up = page.locator('li[data-service="postgres"] .status-glyph');
    expect(await style(up, 'animation-name')).toBe('sig-breathe');
    expect(sameColour(await style(up, 'color'), stateInk('light', 'ok'))).toBe(
      true,
    );

    const down = page.locator('li[data-service="app"] .status-glyph');
    await expect(down).toHaveAttribute('data-state', 'idle');
    await expect(down).toHaveAttribute('data-hollow', '');
    expect(await style(down, 'animation-name')).toBe('none');

    // A service the file declares that no container
    // was ever made for says so in the slot the
    // others put a detail in.
    await harness.show({
      ...APP_DOWN,
      stack: {
        ...APP_DOWN.stack,
        services: [...APP_DOWN.stack.services, WORKER_ABSENT],
      },
    });

    await expect(
      page.locator('li[data-service="worker"] .service-detail'),
    ).toHaveText(runsStrings.serviceState.absent);

    // A compose file that declares nothing has no
    // facts to list, and a block with no rows in it
    // is a rule across the panel saying nothing.
    await harness.show({
      ...APP_DOWN,
      stack: { ...APP_DOWN.stack, services: [] },
    });

    await expect(page.locator('.services')).toHaveCount(0);
    await expect(page.locator('.empty-state')).toHaveCount(1);
  });

  /**
   * In a pane too short for the whole state, the
   * one way out is still the first thing on it.
   */
  test('keeps Start app in view in a short pane, and scrolls the rest', async ({
    page,
  }) => {
    await showList(page, APP_DOWN, 'light', { width: 300 });
    await page.setViewportSize({ width: 300, height: 320 });

    const start = page.locator('[data-stack-up]');
    const box = (await start.boundingBox())!;

    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(320);

    await expect(page.locator('.runs-body .services')).toHaveCount(1);
    await expect(page.locator('.runs-body [role="tablist"]')).toHaveCount(1);

    const body = page.locator('.runs-body');
    expect(
      await body.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);

    const before = await topsOf(page, ['.runs-head']);

    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });

    expect(await topsOf(page, ['.runs-head'])).toEqual(before);

    const foot = await page.evaluate(() => {
      const port = document.querySelector('.runs-body')!;
      const line = document.querySelector('.runs-foot')!;

      return {
        below:
          line.getBoundingClientRect().top - port.getBoundingClientRect().top,
        past:
          line.getBoundingClientRect().bottom -
          port.getBoundingClientRect().bottom,
      };
    });

    expect(foot.below).toBeGreaterThan(0);
    expect(foot.past).toBeLessThan(1);
  });
});

/** Every state that says something where the list
 *  would be, and whose doing each of them is. */
const CARDS: [RunsInit, 'empty' | 'error'][] = [
  [UNTRUSTED, 'empty'],
  [NO_PROJECT, 'empty'],
  [NO_DATABASE, 'error'],
  [NO_DOCKER, 'error'],
  [DAEMON_DOWN, 'error'],
  [DATABASE_REFUSED, 'error'],
  [APP_DOWN, 'error'],
  [NO_RUNS, 'empty'],
];

/**
 * Where the runs that are not these live.
 *
 * Named once, in the one state with nothing local
 * to look at instead, and stated rather than sold:
 * what Conductor is for, and that nothing here
 * depends on it.
 */
test.describe('production', () => {
  test('tells a window with no runs and no Conductor what Conductor is for', async ({
    page,
  }) => {
    const harness = await showList(page, NO_RUNS, 'light', { width: 300 });

    const section = page.locator('[data-production="unconfigured"]');
    await expect(section).toHaveCount(1);
    expect(await padOf(section)).toBe('14px 14px 14px 14px');
    expect(await style(section, 'row-gap')).toBe('8px');

    await expect(section.locator('.section-label')).toHaveText(
      runsStrings.production,
    );

    const heading = section.locator('.production-title');
    await expect(heading).toHaveText(runsStrings.conductorUnconfigured);
    await expect(heading).toHaveAttribute(
      'title',
      runsStrings.conductorSetting,
    );
    expect(runsStrings.conductorSetting).toContain(
      'mboss.conductor.consoleUrl',
    );

    await expect(section.locator('.production-detail')).toHaveText(
      runsStrings.conductorDetail,
    );

    const learn = section.locator('.btn');
    await expect(learn).toHaveCount(1);
    await expect(learn).toHaveText(runsStrings.learnConductor);

    const tops = await topsOf(page, ['.runs-foot', '[data-production]']);
    expect(tops[0]!).toBeLessThan(tops[1]!);

    await learn.click();
    expect(await harness.postedOfType('learnConductor')).toEqual([
      { type: 'learnConductor' },
    ]);

    // Every other state has something local to look
    // at or to fix first.
    for (const [init] of CARDS.filter(([init]) => init !== NO_RUNS)) {
      await harness.show(init);
      await expect(page.locator('[data-production]')).toHaveCount(0);
    }

    await harness.show(THIRD_SERVICE);
    await expect(page.locator('[data-production]')).toHaveCount(0);
  });

  test('offers the console where one is configured', async ({ page }) => {
    const harness = await showList(page, NO_RUNS_CONFIGURED, 'light', {
      width: 300,
    });

    const section = page.locator('[data-production="configured"]');
    await expect(section).toHaveCount(1);
    await expect(section.locator('.section-label')).toHaveText(
      runsStrings.production,
    );
    await expect(section.locator('.production-title')).toHaveText(
      runsStrings.conductorConfigured,
    );
    await expect(section).not.toContainText(runsStrings.learnConductor);

    const open = section.locator('.btn[data-variant="secondary"]');
    await expect(open).toHaveCount(1);
    await expect(open).toHaveText(runsStrings.openProduction);

    await open.click();
    expect(await harness.postedOfType('openProduction')).toEqual([
      { type: 'openProduction' },
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
    test(`draws the list on the side bar own ground in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'runs', theme);
      await harness.show(frameInit());

      await expect(item(page, BY_STATE.done)).toBeVisible();

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      expect(sameColour(ground, colourOf(theme, 'side-bar'))).toBe(true);

      // The frame paints none of its own: the
      // sections are full-bleed on the one ground.
      for (const part of ['.runs-head', '[data-zone="stack"]', '.runs-foot']) {
        expect(await style(page.locator(part), 'background-color')).toBe(
          'rgba(0, 0, 0, 0)',
        );
      }
    });
  }
});
