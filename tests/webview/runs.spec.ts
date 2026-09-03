import { expect, test, type Page } from '@playwright/test';

import type {
  RunRow,
  RunsInit,
  RunsStrings,
  SeeInit,
  SeeRun,
  SeeStrings,
} from '../../src/webview/protocol.js';

import { mount, type Harness } from './harness.js';

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

const runsStrings: RunsStrings = {
  heading: 'Runs',
  filters: { all: 'All', failed: 'Failed', recovered: 'Recovered' },
  recoveredTag: 'recovered ✓',
  untrusted: 'Trust this folder to read its run history.',
  noProject: 'Open an mBoss project to see how its runs went.',
  empty: 'No runs recorded yet.',
  source: 'dbos.workflow_status · localhost:5432/app',
  scope: "Local runs only. Deployed apps are DBOS Conductor's.",
};

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
  },
];

function runsInit(over: Partial<RunsInit> = {}): RunsInit {
  return {
    type: 'init',
    view: 'runs',
    strings: runsStrings,
    project: 'groom-shop',
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
    ...over,
  };
}

const seeStrings: SeeStrings = {
  heading: 'Run',
  nothingSelected: 'Pick a run to see what it did.',
  steps: 'Steps',
  timeline: 'Run timeline',
  hatched: 'hatched = process down',
  restored: 'restored',
  raw: 'dbos.operation_outputs',
  status: 'dbos.workflow_status',
  ledger: 'The recovery ledger — your workflow is just rows in Postgres.',
  columns: {
    stepId: 'step',
    fn: 'function',
    output: 'output',
    committedAt: 'committed',
  },
  replay: '⟲ Replay from this step',
};

const STEP_NAMES = ['parse_request', 'find_slot', 'book_appointment'];

function seeRun(over: Partial<SeeRun> = {}): SeeRun {
  return {
    workflowId: 'wf_c9d2f3',
    name: 'groom_booking',
    breadcrumb: 'mBoss › runs › groom_booking › wf_c9d2f3',
    headline: 'SUCCESS · 8.2 s total',
    severity: 'ok',
    span: 'started 14:02:11 · finished 14:02:19',
    recovered: {
      heading: 'Crash recovered — exactly-once held',
      body:
        'Nothing ran for 2.9 s. DBOS picked this run back up and 2 steps ' +
        'came back from dbos.operation_outputs instead of running again.',
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
    ...over,
  };
}

function seeInit(run: SeeRun = seeRun()): SeeInit {
  return { type: 'init', view: 'see', strings: seeStrings, run };
}

/** Before a run has been picked. A separate helper
 *  rather than `seeInit(undefined)`, which a
 *  default argument would quietly turn back into a
 *  run. */
function seeNothing(): SeeInit {
  return { type: 'init', view: 'see', strings: seeStrings, run: undefined };
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
    await expect(recovered).toContainText('recovered ✓');
    await expect(recovered).toContainText('14:02 · 8.2 s');

    const plain = page.locator('[data-run="wf_a1b4e7"]');
    await expect(plain).toHaveAttribute('data-recovered', 'false');
    await expect(plain).not.toContainText('recovered ✓');

    const failed = page.locator('[data-run="wf_77c101"]');
    await expect(failed).toHaveAttribute('data-severity', 'failed');
    await expect(failed).toContainText('login failed — CDC_PASS rotated');
  });

  /**
   * The accent rule is the one ornament on a row, so
   * it has to be a rule a person can see and not
   * just an attribute a test can read.
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
    expect(edge).not.toContain('rgba(0, 0, 0, 0)');
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
    await expect(banner).toContainText('exactly-once held');
    await expect(banner).toContainText('2 steps came back');
  });

  test('draws no banner over a run that never crashed', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ recovered: undefined })));

    await expect(page.locator('[data-recovered-banner]')).toHaveCount(0);
  });

  /** The page quotes its sources; it does not
   *  decorate them. */
  test('frames its sections without ornament', async ({ page }) => {
    await showRun(page, seeInit());

    await expect(page.locator('.blueprint')).toHaveCount(0);
    await expect(page.locator('.corner')).toHaveCount(0);
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
