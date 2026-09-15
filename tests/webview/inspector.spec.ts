import { expect, test, type Locator, type Page } from '@playwright/test';

import { signatureOf } from '../../src/canvas/libFunction.js';
import {
  handlerFit,
  withDecisionCases,
  type WorkflowIR,
} from '../../src/core/rules.js';
import { INLINE_LIMIT, inlineJson } from '../../src/runs/rows.js';
import {
  TIMER_THEN_ANSWER,
  liveStep,
  timerThenAnswerRun,
} from '../../src/test-support/runs.js';
import { filled } from '../../src/webview/fill.js';
import { shortRunId } from '../../src/webview/ids.js';
import type {
  BlockSubject,
  InspectorInit,
  RunLevel,
  ShownRun,
} from '../../src/webview/protocol.js';

import {
  DEDUPLICATES,
  DONE,
  EXHAUSTED,
  INDEXING,
  IN_FLIGHT,
  MARK,
  RECORDED_AT,
  NO_PARTITION_KEY,
  PARTITIONED,
  THREW,
  THREW_IN_LIB,
  apiCallSubject,
  type TriggerConfig,
  blockInit,
  blockSubject,
  everyKind,
  inspectorInit,
  ir,
  labelTrack,
  manifest,
  mountInspector,
  openInspector,
  queueEvidence,
  queueSubject,
  queuedRun,
  recording,
  runOf,
  triggerSubject,
  word,
} from './fixtures/canvas.js';
import {
  FORK_ID,
  GRAPH,
  PARENT_ID,
  QUEUED,
  QUEUED_GRAPH,
  QUEUE_READ,
  RUN_ID,
  RUN_LINEAGE,
  runLevel,
  seeRun,
} from './fixtures/runs.js';
import { THEMES_ALL } from './harness.js';
import { labelBeforeValue } from './labels.js';
import { colourOf, contrast, sameColour } from './palette.js';
import { canvasWords, inspectorWords as inspectorStrings } from './words.js';

/**
 * The Inspector, on screen.
 *
 * A pane in the side bar that draws whatever the
 * canvas or run tab last in front is about. What
 * that is, and when it changes, is worked out
 * where the host is; these specs send the answer
 * and check what a person sees, and what the pane
 * says back for the host to act on.
 */

/**
 * How the pane names the block a message is about,
 * read off the subject it was drawn from: the
 * surface it was picked on, the document it is in
 * and its id.
 */
function about(init: InspectorInit) {
  const { subject } = init;

  if (subject.at !== 'block') throw new Error(`about ${subject.at}`);

  const { source, path, nodeId } = subject.block;

  return { source, path, nodeId };
}

/** The pane with nothing to inspect, with the
 *  canvas file when a canvas is in front. */
function nothing(file: string | undefined) {
  return inspectorInit({ at: 'none', file });
}

/** How many lines the text in an element is set on,
 *  read off the boxes its text draws. */
function linesIn(element: Locator): Promise<number> {
  return element.evaluate((held) => {
    const text = document.createRange();
    text.selectNodeContents(held);

    return new Set([...text.getClientRects()].map((box) => Math.round(box.top)))
      .size;
  });
}

test.describe('an Inspector with nothing to show', () => {
  test('says what to pick, and where', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    const empty = page.locator('.empty-state');
    await expect(empty).toHaveCount(1);

    await expect(page.locator('[data-inspector-header]')).toContainText(
      inspectorStrings.heading,
    );
    await expect(empty.locator('.empty-title')).toHaveText(
      inspectorStrings.nothingSelected,
    );
    await expect(empty.locator('.empty-detail')).toHaveText(
      inspectorStrings.nothingSelectedDetail,
    );
    await expect(empty.locator('.btn')).toHaveCount(0);
  });

  /**
   * What a canvas sends once the canvas itself is
   * clicked: nothing is selected on it, so there is
   * no block to draw and no field to fill in.
   */
  test('says what to pick once nothing is selected', async ({ page }) => {
    await openInspector(page, nothing('groom_booking.workflow.json'));

    const empty = page.locator('.empty-state');
    await expect(empty).toHaveCount(1);

    await expect(empty.locator('.empty-title')).toHaveText(
      inspectorStrings.nothingSelected,
    );
    await expect(page.locator('[data-field]')).toHaveCount(0);
  });

  /**
   * The file is what the pane is about when no
   * block is, so it takes the far end of the row
   * the title starts, at the same inset — and no
   * rule under the row: nothing below it is a
   * section the header has to be told apart from.
   */
  test('names the canvas file at the far end of its header', async ({
    page,
  }) => {
    await openInspector(page, nothing('airtable_etl.workflow.json'));

    const header = page.locator('[data-inspector-header]');
    const file = header.locator('[data-inspector-file]');

    await expect(file).toHaveText('airtable_etl.workflow.json');
    await expect(file).toHaveAttribute('data-mono', '');

    const row = (await header.boundingBox())!;
    const name = (await file.boundingBox())!;

    // Within half a pixel either way.
    expect(name.x + name.width).toBeCloseTo(row.x + row.width - 14, 0);

    await expect(header).toHaveCSS('border-bottom-width', '0px');
  });

  test('names no file when no canvas is in front', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    await expect(page.locator('[data-inspector-header]')).toHaveCount(1);
    await expect(page.locator('[data-inspector-file]')).toHaveCount(0);
  });

  /**
   * A pane is usually shorter than what it will
   * hold, so the page itself never scrolls: the
   * header stays where it is, and whatever scrolls
   * does so inside.
   */
  test('fills its pane and never scrolls the page', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    const root = page.locator('[data-inspector]');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveCSS('overflow', 'hidden');

    const sized = await root.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      pane: window.innerHeight,
    }));

    expect(sized.height).toBe(sized.pane);
  });

  for (const theme of THEMES_ALL) {
    test(`draws on the side bar’s ground in ${theme}`, async ({ page }) => {
      await openInspector(page, nothing(undefined), theme);
      await expect(page.locator('[data-inspector]')).toHaveCount(1);

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const expected = colourOf(theme, 'side-bar');

      expect(expected).not.toBe('');
      expect(sameColour(ground, expected), `${ground} ≠ ${expected}`).toBe(
        true,
      );
    });
  }
});

/**
 * A whole run: what the pane is about when a run
 * is in front and nothing of it is picked. The
 * header says which run and where it got to; the
 * card under it says what the run was started with,
 * the row DBOS keeps about it, what a recovery
 * cost, where it was replayed from and to, and the
 * ways on from the whole run.
 */
test.describe('a run with nothing picked', () => {
  /** The pane about a run like that one. */
  function aboutRun(over: Partial<RunLevel> = {}) {
    return inspectorInit({ at: 'run', run: runLevel(over) });
  }

  /** The card under the header. */
  function card(page: Page) {
    return page.locator('[data-evidence="run"]');
  }

  /** What the card says about a run DBOS picked
   *  back up, as the host words it: every sentence
   *  worked out. */
  const RECOVERED = [
    'Recovered — completed durable operations were not re-executed · derived',
    'DBOS picked this run back up. Both figures are derived from the ' +
      'widest gap between recorded operations — the durable operations ' +
      'that finished before that gap were reused from ' +
      'dbos.operation_outputs rather than run again. · derived',
    'nothing ran for about 2.9 s · derived',
    '2 durable operations reused · derived',
  ];

  const CANCEL = {
    cancel: true,
    resume: false,
    cancelledAt: undefined,
    gaveUp: false,
  };

  test('draws a card about the whole run when nothing is picked', async ({
    page,
  }) => {
    await openInspector(page, aboutRun());

    await expect(card(page)).toHaveCount(1);
    await expect(page.locator('.empty-state')).toHaveCount(0);
    await expect(page.locator('[data-evidence="block"]')).toHaveCount(0);
    await expect(page.locator('[data-inspector-tab]')).toHaveCount(0);
  });

  for (const [said, state, line] of [
    ['done', 'done', 'done · 1.6 s'],
    ['waiting', 'waiting', 'waiting'],
    ['gave up', 'failed', 'gave up · 2 h 5 m'],
  ] as const) {
    test(`names the run in its header and says it ${said}`, async ({
      page,
    }) => {
      await openInspector(page, aboutRun({ state, line }));

      const header = page.locator('[data-inspector-header]');
      await expect(header.locator('.inspector-title')).toHaveText(
        'airtable_etl',
      );
      await expect(header.locator('.inspector-kind')).toHaveText(
        `${inspectorStrings.runKind} #7089`,
      );

      const short = header.locator('[data-short-run]');
      await expect(short).toHaveText('#7089');
      await expect(short).toHaveAttribute('data-short-run', RUN_ID);
      await expect(short).toHaveAttribute('title', RUN_ID);

      const status = header.locator('.status-line');
      await expect(status).toHaveAttribute('data-run-state', state);

      const said = status.locator(':scope > span:not(.status-glyph)');
      await expect(said).toHaveText(line);

      // In the tone the mark is in: the word is the
      // state as much as the mark is.
      const [mark, word] = await Promise.all([
        status
          .locator('.status-glyph')
          .evaluate((glyph) => getComputedStyle(glyph).color),
        said.evaluate((text) => getComputedStyle(text).color),
      ]);
      expect(word).toBe(mark);
    });
  }

  /**
   * Where the row has room, the run's line sits at
   * its far end, on the title's line, at the same
   * inset the title starts at.
   */
  test('sets the run’s line at the far end of the header', async ({ page }) => {
    await openInspector(page, aboutRun());

    const header = page.locator('[data-inspector-header]');
    const row = (await header.boundingBox())!;
    const title = (await header.locator('.inspector-title').boundingBox())!;
    const line = (await header.locator('.status-line').boundingBox())!;

    expect(line.x + line.width).toBeCloseTo(row.x + row.width - 14, 0);
    expect(line.y).toBeLessThan(title.y + title.height);
  });

  /** A long workflow name breaks inside the pane
   *  rather than pushing the header sideways. */
  test('breaks a long workflow name rather than the pane', async ({ page }) => {
    const harness = await mountInspector(page);
    await page.setViewportSize({ width: 240, height: 700 });
    await harness.show(
      aboutRun({ workflow: 'nightly_customer_reconciliation_and_export' }),
    );

    const title = page.locator('[data-inspector-header] .inspector-title');
    expect(await linesIn(title)).toBeGreaterThanOrEqual(2);

    const drawn = await title.evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      pane: window.innerWidth,
    }));
    expect(drawn.right).toBeLessThanOrEqual(drawn.pane - 14 + 0.5);
  });

  /**
   * The one argument the run was started with, once,
   * under the label that says it is what DBOS
   * recorded rather than what the Runs panel now
   * holds.
   */
  test('draws what the run was started with, once', async ({ page }) => {
    await openInspector(page, aboutRun());

    const input = card(page).locator('[data-workflow-input]');
    await expect(input.locator('.section-label')).toHaveText(
      inspectorStrings.workflowInput,
    );

    await expect(page.locator('[data-recorded]')).toHaveCount(1);
    await expect(input.locator('[data-recorded] [data-verbatim]')).toHaveText(
      '{ "requestId": "airtable-etl-006" }',
    );
    await expect(page.getByText('airtable-etl-006')).toHaveCount(1);
  });

  test('says when no input was recorded', async ({ page }) => {
    await openInspector(page, aboutRun({ input: undefined }));

    const input = card(page).locator('[data-workflow-input]');
    await expect(input).toHaveCount(1);

    await expect(input.locator('.field-hint')).toHaveText(
      inspectorStrings.noInput,
    );
    await expect(page.locator('[data-recorded]')).toHaveCount(0);
  });

  test('shows the run’s own row in dbos.workflow_status', async ({ page }) => {
    await openInspector(page, aboutRun());

    await expect(card(page).locator('.section-label')).toHaveText([
      inspectorStrings.workflowInput,
      inspectorStrings.ledgerHeading,
    ]);

    const rows = card(page).locator('[data-ledger] [data-property]');
    await expect(rows).toHaveCount(5);
    await expect(rows.locator(':scope > .property-label')).toHaveText([
      'workflow_uuid',
      'status',
      'recovery_attempts',
      'executor_id',
      'application_version',
    ]);

    await expect(page.locator('[data-rail="workflow_uuid"] .value')).toHaveText(
      RUN_ID,
    );
    await expect(
      page.locator('[data-rail="recovery_attempts"] .value'),
    ).toHaveText('1');
    await expect(page.locator('[data-rail="executor_id"] .value')).toHaveText(
      'local',
    );
    await expect(card(page).locator('[data-ledger-note]')).toHaveText(
      inspectorStrings.ledger,
    );

    // A column name is the whole of what a label
    // says, so the ledger's labels get the room to
    // say it on one line.
    for (const row of await rows.all()) {
      await expect(row).toHaveCSS('grid-template-columns', /^110px /);
      expect(await linesIn(row.locator(':scope > .property-label'))).toBe(1);
    }
  });

  /**
   * The column DBOS writes is shown as it is written
   * in one place, the row it is a column of; every
   * other word on the pane is the one a person reads
   * a run's state in.
   */
  test('keeps the raw status in the ledger and nowhere else', async ({
    page,
  }) => {
    await openInspector(page, aboutRun());

    await expect(page.locator('[data-rail="status"] .value')).toHaveText(
      'SUCCESS',
    );

    // No word boundary: a row's label and value
    // run together in the text of the page.
    const raw = await page.evaluate(
      () => document.body.textContent?.match(/SUCCESS/g)?.length ?? 0,
    );
    expect(raw).toBe(1);
  });

  for (const theme of THEMES_ALL) {
    test(`puts every ledger label before its value in ${theme}`, async ({
      page,
    }) => {
      await openInspector(page, aboutRun(), theme);

      const rows = card(page).locator('[data-ledger] [data-property]');
      await expect(rows).toHaveCount(5);

      // The id is longer than its column, so this is
      // also the row whose value has to wrap under its
      // own first line rather than under the label.
      const uuid = page.locator('[data-rail="workflow_uuid"] .value');
      expect(await linesIn(uuid)).toBeGreaterThanOrEqual(2);

      for (let at = 0; at < 5; at += 1) {
        await labelBeforeValue(rows.nth(at));
      }
    });
  }

  test('says what a recovery cost, every sentence worked out', async ({
    page,
  }) => {
    await openInspector(page, aboutRun({ recovery: RECOVERED }));

    const recovery = card(page).locator('[data-recovery]');
    await expect(recovery.locator('.section-label')).toHaveText(
      inspectorStrings.recovery,
    );
    await expect(recovery.locator('.field-hint')).toHaveText(RECOVERED);
  });

  test('says less about a recovery whose gap could not be placed', async ({
    page,
  }) => {
    await openInspector(page, aboutRun({ recovery: RECOVERED.slice(0, 2) }));

    await expect(card(page).locator('[data-recovery] .field-hint')).toHaveCount(
      2,
    );
  });

  test('says nothing about recovery for a run that never crashed', async ({
    page,
  }) => {
    await openInspector(page, aboutRun());
    await expect(card(page)).toHaveCount(1);

    await expect(page.locator('[data-recovery]')).toHaveCount(0);
  });

  /**
   * A replay forks a new run and leaves this one
   * where it was, so the card names both ends of
   * each fork. The run the card is about is not a
   * line of its own: its id is in the header. The
   * step a fork started from is worked out rather
   * than read, and says so; the ids and the word are
   * read, and each id is the way to that run.
   */
  test('draws where each replay forked, and opens the run an id names', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      aboutRun({ lineage: RUN_LINEAGE }),
    );

    const lineage = card(page).locator('[data-lineage]');
    await expect(lineage.locator('.section-label')).toHaveText(
      inspectorStrings.lineage,
    );
    await expect(lineage.locator('[data-lineage-line]')).toHaveText([
      `replay of ${shortRunId(PARENT_ID)} from step 3`,
      `└ replay from step 2 → ${shortRunId(FORK_ID)} · done`,
    ]);

    for (const id of [PARENT_ID, FORK_ID]) {
      const run = lineage.locator(`[data-lineage-run="${id}"]`);
      await expect(run).toHaveCount(1);
      await expect(run).toHaveJSProperty('tagName', 'BUTTON');
      await expect(run).toHaveAttribute('data-variant', 'quiet');

      const short = run.locator('[data-short-run]');
      await expect(short).toHaveText(shortRunId(id));
      await expect(short).toHaveAttribute('data-short-run', id);
      await expect(short).toHaveAttribute('title', id);
    }

    await expect(lineage.locator(`[data-short-run="${RUN_ID}"]`)).toHaveCount(
      0,
    );

    const worked = lineage.locator('[data-provenance="derived"]');
    await expect(worked).toHaveText(['from step 3', 'from step 2']);
    for (const one of await worked.all()) {
      await expect(one).toHaveAttribute('title', inspectorStrings.derived);
    }

    await lineage.locator(`[data-lineage-run="${PARENT_ID}"]`).click();

    expect(await harness.postedOfType('openRun')).toEqual([
      { type: 'openRun', workflowId: PARENT_ID },
    ]);
    expect(await harness.postedOfType('runSelect')).toEqual([]);
  });

  test('draws no lineage for a run with no replay either side', async ({
    page,
  }) => {
    await openInspector(page, aboutRun());
    await expect(card(page)).toHaveCount(1);

    await expect(page.locator('[data-lineage]')).toHaveCount(0);
  });

  /**
   * Following an id changes what the pane is about,
   * and the Button that was pressed may not be there
   * once it has: focus goes to the header, which
   * names whichever run the pane is about next.
   */
  test('moves focus to the header after an id is followed', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      aboutRun({ lineage: RUN_LINEAGE }),
    );

    await card(page).locator(`[data-lineage-run="${PARENT_ID}"]`).click();

    const title = page.locator('[data-inspector-header] .inspector-title');
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('tabindex', '-1');

    await harness.show(
      aboutRun({
        workflowId: PARENT_ID,
        short: shortRunId(PARENT_ID),
        state: 'failed',
        line: 'failed · 0.8 s',
        lineage: [
          {
            direction: 'to',
            workflowId: RUN_ID,
            short: shortRunId(RUN_ID),
            startStep: 3,
            word: 'done',
          },
        ],
      }),
    );

    await expect(
      page.locator('[data-inspector-header] [data-short-run]'),
    ).toHaveText(shortRunId(PARENT_ID));
    await expect(title).toBeFocused();
  });

  test('says what a replay did and what it is waiting for', async ({
    page,
  }) => {
    await openInspector(
      page,
      aboutRun({
        note:
          'Replaying as #3f2b under version v0.5.0, not the v0.4.1 this ' +
          'run used. It starts when your app is running that version.',
      }),
    );

    const note = card(page).locator('[data-replay-note]');
    await expect(note).toHaveClass(/\bfield-hint\b/);
    await expect(note).toContainText('#3f2b');
    await expect(note).toContainText('v0.5.0');
  });

  /** Cancel is meaningless once a run has stopped
   *  and Resume while one is still going, so the
   *  card never offers both. */
  test('offers Cancel or Resume, never both', async ({ page }) => {
    const harness = await openInspector(
      page,
      aboutRun({ state: 'running', line: 'running', controls: CANCEL }),
    );

    const cancel = page.locator('[data-cancel]');
    await expect(cancel).toHaveText('Cancel run');
    await expect(cancel).toHaveAttribute('data-variant', 'stop');
    await expect(page.locator('[data-resume]')).toHaveCount(0);

    await cancel.click();

    expect(await harness.postedOfType('cancelRun')).toEqual([
      { type: 'cancelRun', workflowId: RUN_ID },
    ]);

    await harness.show(
      aboutRun({
        state: 'idle',
        line: 'cancelled · 3.2 s',
        controls: {
          cancel: false,
          resume: true,
          cancelledAt: '10:58:22.000 · by you',
          gaveUp: false,
        },
      }),
    );

    await expect(page.locator('[data-cancel]')).toHaveCount(0);
    await expect(page.locator('[data-resume]')).toHaveText('Resume');

    const cancelled = page.locator('[data-cancelled]');
    await expect(cancelled.locator('.property-label')).toHaveText(
      inspectorStrings.cancelledAt,
    );
    await expect(cancelled.locator('.value')).toHaveText(
      '10:58:22.000 · by you',
    );

    await page.locator('[data-resume]').click();

    expect(await harness.postedOfType('resumeRun')).toEqual([
      { type: 'resumeRun', workflowId: RUN_ID },
    ]);
  });

  /**
   * One control that changes what it says, rather
   * than one control taken away and another put in
   * its place: somebody who pressed Cancel run from
   * the keyboard is still on the control once the
   * run has stopped, and it now says Resume.
   */
  test('keeps focus on the control when a cancel lands', async ({ page }) => {
    const harness = await openInspector(
      page,
      aboutRun({ state: 'running', line: 'running', controls: CANCEL }),
    );

    await page.locator('[data-cancel]').focus();
    await page.evaluate(() => {
      (window as { held?: Element | null }).held = document.activeElement;
    });

    await harness.show(
      aboutRun({
        state: 'idle',
        line: 'cancelled · 3.2 s',
        controls: {
          cancel: false,
          resume: true,
          cancelledAt: '10:58:22.000',
          gaveUp: false,
        },
      }),
    );

    await expect(page.locator('[data-resume]')).toHaveCount(1);

    const kept = await page.evaluate(() => {
      const held = (window as { held?: Element | null }).held;

      return (
        held !== undefined &&
        held === document.activeElement &&
        held?.matches('[data-resume]')
      );
    });
    expect(kept).toBe(true);
  });

  /**
   * Picking a stopped run back up is the thing to do
   * with it, and Replay from start is not: a replay
   * forks a second run, and this one is still there
   * to be finished.
   */
  test('makes Resume the primary action', async ({ page }) => {
    await openInspector(
      page,
      aboutRun({
        state: 'idle',
        line: 'cancelled · 3.2 s',
        controls: {
          cancel: false,
          resume: true,
          cancelledAt: '10:58:22.000',
          gaveUp: false,
        },
      }),
    );

    await expect(page.locator('[data-resume]')).toHaveAttribute(
      'data-variant',
      'primary',
    );
    await expect(
      page.locator('[data-evidence-action="replayFrom"]'),
    ).toHaveAttribute('data-variant', 'secondary');
    await expect(page.locator('[data-resume-hint]')).toHaveText(
      'Resume continues from the recorded history · completed durable ' +
        'operations are not re-executed',
    );
  });

  test('draws no controls with nothing to say and nothing to do', async ({
    page,
  }) => {
    await openInspector(page, aboutRun());
    await expect(card(page)).toHaveCount(1);

    for (const hook of ['cancel', 'resume', 'cancelled', 'resume-hint']) {
      await expect(page.locator(`[data-${hook}]`)).toHaveCount(0);
    }
  });

  /**
   * Said only where it is true. DBOS puts the count
   * back to nothing when it picks a dead-lettered
   * run up again, and a person resuming one is
   * entitled to know the give-up clock restarts.
   */
  test('says recovery_attempts restarts from 0 on a run that gave up', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      aboutRun({
        state: 'failed',
        line: 'gave up · 2 h 5 m',
        controls: {
          cancel: false,
          resume: true,
          cancelledAt: undefined,
          gaveUp: true,
        },
      }),
    );

    await expect(page.locator('[data-attempts-reset]')).toHaveText(
      'recovery_attempts starts again from 0',
    );

    await harness.show(
      aboutRun({
        state: 'idle',
        line: 'cancelled · 3.2 s',
        controls: {
          cancel: false,
          resume: true,
          cancelledAt: '10:58:22.000',
          gaveUp: false,
        },
      }),
    );

    await expect(page.locator('[data-resume]')).toHaveCount(1);
    await expect(page.locator('[data-attempts-reset]')).toHaveCount(0);
  });

  /**
   * A fork at step 0 copies nothing, so it is the
   * run started again with what it was started with:
   * the one way on the card asks for, drawn in the
   * outline.
   */
  test('offers Replay from start as the main way on', async ({ page }) => {
    const harness = await openInspector(page, aboutRun());

    const replay = card(page).locator('[data-evidence-action="replayFrom"]');
    await expect(replay).toHaveCount(1);
    await expect(replay).toHaveText(inspectorStrings.replayStart);
    await expect(replay).toHaveClass(/\bbtn\b/);
    await expect(replay).toHaveAttribute('data-variant', 'secondary');
    await expect(replay).toHaveAttribute('data-ink', 'brand');

    const ink = await replay.evaluate(
      (button) => getComputedStyle(button).color,
    );
    const brand = colourOf('light', 'brand');
    expect(sameColour(ink, brand), `${ink} ≠ ${brand}`).toBe(true);

    await replay.click();

    expect(await harness.postedOfType('replayFrom')).toEqual([
      { type: 'replayFrom', workflowId: RUN_ID, from: 'start' },
    ]);
  });

  test('refuses Replay from start and says why', async ({ page }) => {
    const refused =
      'This project has no package-lock.json, so which DBOS it runs is ' +
      'unknown.';
    const harness = await openInspector(
      page,
      aboutRun({ replayStart: false, replayRefused: refused }),
    );

    const replay = card(page).locator('[data-evidence-action="replayFrom"]');
    await expect(replay).toHaveAttribute('aria-disabled', 'true');
    await expect(replay).toHaveAccessibleDescription(refused);
    await expect(card(page).getByText(refused)).toBeVisible();

    // Forced: Playwright waits for a refused control
    // to answer, and the point is that it does not.
    await replay.click({ force: true });

    expect(await harness.postedOfType('replayFrom')).toEqual([]);
  });

  test('asks the agent about the whole run', async ({ page }) => {
    const harness = await openInspector(page, aboutRun());

    const ask = card(page).locator('[data-evidence-action="askAgent"]');
    await expect(ask).toHaveText(inspectorStrings.askAgent);
    await expect(ask).toHaveAttribute('data-variant', 'quiet');

    await ask.click();

    expect(await harness.postedOfType('askAgent')).toEqual([
      { type: 'askAgent', workflowId: RUN_ID },
    ]);
  });

  /**
   * A canvas follows a run tick by tick and has read
   * nothing else about it, so its card is the run's
   * own row and input and the controls, and none of
   * what only the run tab reads: no recovery, no
   * lineage, no replay note. And no Open run: the
   * canvas's own chip is the way to the run tab.
   */
  test('says what a canvas knows about a run it is following', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      aboutRun({
        source: 'canvas',
        line: 'done · 1.6 s · ↻ recovered',
        input: { kind: 'inline', text: '{ "orderId": "ord_123" }' },
        ledger: [
          { label: 'workflow_uuid', value: RUN_ID },
          { label: 'status', value: 'SUCCESS' },
          { label: 'recovery_attempts', value: '2' },
          { label: 'executor_id', value: 'local' },
          { label: 'application_version', value: '1' },
        ],
      }),
    );

    await expect(page.locator('[data-recorded]')).toHaveCount(1);
    await expect(
      card(page).locator('[data-workflow-input] [data-verbatim]'),
    ).toHaveText('{ "orderId": "ord_123" }');

    await expect(
      card(page).locator('[data-ledger] [data-property]'),
    ).toHaveCount(5);
    await expect(
      page.locator('[data-rail="recovery_attempts"] .value'),
    ).toHaveText('2');
    await expect(
      page.locator('[data-rail="application_version"] .value'),
    ).toHaveText('1');

    for (const absent of [
      '[data-recovery]',
      '[data-lineage]',
      '[data-replay-note]',
      '[data-evidence-action="openRun"]',
    ]) {
      await expect(page.locator(absent)).toHaveCount(0);
    }

    await harness.show(
      aboutRun({
        source: 'canvas',
        state: 'running',
        line: 'running',
        controls: CANCEL,
      }),
    );

    await expect(page.locator('[data-cancel]')).toBeVisible();
  });

  /**
   * A pane is usually shorter than the card, so the
   * card scrolls under the header: somebody scrolled
   * to the ways on still sees which run they are
   * about.
   */
  test('scrolls the card and never the header', async ({ page }) => {
    const harness = await mountInspector(page);
    await page.setViewportSize({ width: 300, height: 360 });
    await harness.show(
      aboutRun({
        recovery: RECOVERED,
        lineage: [
          ...RUN_LINEAGE,
          {
            direction: 'to',
            workflowId: '5c0d8e2a-91b3-4f6c-a2d4-7e1b0c9f3a58',
            short: '#5c0d',
            startStep: 4,
            word: 'failed',
          },
        ],
      }),
    );

    const body = card(page);
    await expect(body.locator('[data-lineage-line]')).toHaveCount(3);

    const header = page.locator('[data-inspector-header]');
    const before = (await header.boundingBox())!.y;

    const sized = await body.evaluate((element) => ({
      page: document.documentElement.scrollHeight,
      pane: window.innerHeight,
      overflows: element.scrollHeight > element.clientHeight,
    }));
    expect(sized.page).toBe(sized.pane);
    expect(sized.overflows).toBe(true);

    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    expect((await header.boundingBox())!.y).toBe(before);
    await expect(
      body.locator('[data-evidence-action="askAgent"]'),
    ).toBeInViewport();
  });

  /**
   * The size of a recorded value decides how it is
   * drawn: whole where it fits the host's inline
   * limit, and past that a preview on one line, its
   * size and a way to open all of it.
   */
  test('draws a short input inline, a long one as something to open', async ({
    page,
  }) => {
    const short = `{ "note": "${'x'.repeat(INLINE_LIMIT - 14)}" }`;
    const long = `{ "note": "${'x'.repeat(INLINE_LIMIT - 13)}" }`;
    expect(short).toHaveLength(INLINE_LIMIT);
    expect(long).toHaveLength(INLINE_LIMIT + 1);

    const harness = await openInspector(
      page,
      aboutRun({ input: { kind: 'inline', text: short } }),
    );

    const recorded = card(page).locator('[data-recorded]');
    await expect(recorded.locator('.state-word')).toHaveText(
      inspectorStrings.inline,
    );
    await expect(recorded.locator('[data-verbatim]')).toHaveText(short);
    await expect(recorded.locator('.btn')).toHaveCount(0);

    await harness.show(
      aboutRun({ input: { kind: 'artifact', preview: long, size: '121 B' } }),
    );

    await expect(recorded.locator('.state-word')).toHaveText(
      inspectorStrings.artifact,
    );
    await expect(recorded).toContainText('121 B');

    const preview = recorded.locator('[data-verbatim]');
    await expect(preview).toHaveText(long);

    expect(await linesIn(preview)).toBe(1);

    const drawn = await preview.evaluate((element) => ({
      cut: element.scrollWidth > element.clientWidth,
      overflow: getComputedStyle(element).textOverflow,
    }));
    expect(drawn).toEqual({ cut: true, overflow: 'ellipsis' });

    const open = recorded.locator('[data-evidence-action="openInput"]');
    await expect(open).toHaveText(inspectorStrings.openInput);
    await expect(open).toHaveAttribute('data-variant', 'quiet');
    await expect(open).toHaveAttribute('data-ink', 'brand');

    await open.click();

    expect(await harness.postedOfType('openInput')).toEqual([
      { type: 'openInput', workflowId: RUN_ID },
    ]);
  });

  /**
   * A value that does not fit the pane wraps inside
   * its chip, under its own first character, and
   * breaks an id that has nowhere to break rather
   * than pushing the pane sideways.
   */
  for (const width of [300, 240]) {
    test(`wraps a value inside its chip at ${width}px`, async ({ page }) => {
      const value =
        '{ "requestId": "7089cd29881b4319a16d1af70cc1e9a7", ' +
        '"source": "airtable-etl-006" }';
      expect(value.length).toBeLessThanOrEqual(INLINE_LIMIT);

      const harness = await mountInspector(page);
      await page.setViewportSize({ width, height: 700 });
      await harness.show(aboutRun({ input: { kind: 'inline', text: value } }));

      const chip = card(page).locator('[data-recorded] [data-verbatim]');
      await expect(chip).toHaveText(value);

      const lines = await linesIn(chip);
      const drawn = await chip.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
        right: element.getBoundingClientRect().right,
        pane: window.innerWidth,
        page: document.documentElement.scrollWidth,
      }));

      expect(lines).toBeGreaterThanOrEqual(2);
      expect(drawn.scroll).toBe(drawn.client);
      expect(drawn.right).toBeLessThanOrEqual(drawn.pane - 14);
      expect(drawn.page).toBe(drawn.pane);
    });
  }

  /**
   * The run's line wraps under the title as one
   * thing where the header has no room for it: a
   * state word that wrapped away from its duration
   * reads as two states.
   */
  test('keeps the run’s line in one piece where the header wraps', async ({
    page,
  }) => {
    const harness = await mountInspector(page);
    await page.setViewportSize({ width: 240, height: 700 });
    await harness.show(aboutRun({ line: 'done · 9.1 s · ↻ recovered' }));

    const header = page.locator('[data-inspector-header]');
    const title = (await header.locator('.inspector-title').boundingBox())!;
    const status = header.locator('.status-line');
    const line = (await status.boundingBox())!;

    // The header did wrap, or this proves nothing;
    // and the line starts under the title.
    expect(line.y).toBeGreaterThan(title.y + title.height - 1);
    expect(line.x).toBeCloseTo(title.x, 0);
    expect(line.x + line.width).toBeLessThanOrEqual(240 - 14 + 0.5);

    const said = status.locator(':scope > span:not(.status-glyph)');
    expect(await linesIn(said)).toBe(1);

    const mark = (await status.locator('.status-glyph').boundingBox())!;
    const word = (await said.boundingBox())!;
    const middle = mark.y + mark.height / 2;
    expect(middle).toBeGreaterThan(word.y);
    expect(middle).toBeLessThan(word.y + word.height);
  });
});

/**
 * The one place a block's config is set, and what
 * a run recorded about it: whichever block was last
 * selected on the canvas in front, in a pane of its
 * own beside every canvas rather than a column
 * inside each one.
 */
/**
 * The top of the pane over a block: its name, what
 * kind of block it is, and the two faces.
 *
 * The name is the block's own title, and the one
 * place it is renamed, so it is a field rather than
 * a heading — drawn bare until somebody is in it, as
 * every field in the pane is.
 */
test.describe('the head of a block in the Inspector', () => {
  for (const theme of THEMES_ALL) {
    test(`names the block above its faces in ${theme}`, async ({ page }) => {
      await openInspector(page, blockInit(blockSubject('find_slot')), theme);

      const header = page.locator('[data-inspector-header]');
      await expect(header).toHaveCount(1);
      await expect(page.locator('[role="tablist"]')).toHaveCount(1);

      expect(
        await header.evaluate(
          (head) =>
            head.compareDocumentPosition(
              document.querySelector('[role="tablist"]')!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).not.toBe(0);

      const heading = header.locator('[data-inspector-heading]');
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveValue('Find open slot');
      await expect(heading).toHaveAccessibleName(inspectorStrings.blockTitle);
      expect(
        await page
          .locator('[data-field="title"] input')
          .evaluate((input) => input.matches('[data-inspector-heading]')),
      ).toBe(true);

      const type = await heading.evaluate((input) => ({
        size: getComputedStyle(input).fontSize,
        weight: getComputedStyle(input).fontWeight,
      }));
      expect(type).toEqual({ size: '13px', weight: '600' });

      const kind = header.locator('[data-inspector-kind]');
      await expect(kind).toHaveText(canvasWords.kinds.step);
      await expect(kind).toHaveAttribute('data-mono', '');

      const ink = await kind.evaluate((word) => getComputedStyle(word).color);
      const faint = colourOf(theme, 'ink-faint');
      expect(sameColour(ink, faint), `${ink} ≠ ${faint}`).toBe(true);

      await expect(page.getByText(/node inspector/i)).toHaveCount(0);
    });

    test(`draws two faces as a strip a keyboard can walk in ${theme}`, async ({
      page,
    }) => {
      await openInspector(page, blockInit(blockSubject('find_slot')), theme);

      const configure = page.locator('[data-inspector-tab="configure"]');
      const evidence = page.locator('[data-inspector-tab="evidence"]');
      await expect(configure).toHaveCount(1);
      await expect(evidence).toHaveCount(1);

      const read = (tab: Locator) =>
        tab.evaluate((one) => {
          const style = getComputedStyle(one);

          return {
            size: Number.parseFloat(style.fontSize),
            weight: style.fontWeight,
            transform: style.textTransform,
            rule: style.borderBottomColor,
          };
        });

      const picked = await read(configure);
      const other = await read(evidence);
      const brand = colourOf(theme, 'brand');

      await expect(configure).toHaveAttribute('aria-selected', 'true');
      expect(picked.size).toBeCloseTo(11.999, 1);
      expect(other.size).toBeCloseTo(11.999, 1);
      expect(picked.weight).toBe('600');
      expect(other.weight).toBe('500');
      expect([picked.transform, other.transform]).toEqual(['none', 'none']);
      expect(sameColour(picked.rule, brand), `${picked.rule}`).toBe(true);

      await configure.focus();
      await page.keyboard.press('ArrowRight');

      await expect(evidence).toBeFocused();
      await expect(evidence).toHaveAttribute('aria-disabled', 'true');

      const reason = page.locator('[data-no-run]');
      await expect(reason).toHaveText(inspectorStrings.noRun);
      await expect(evidence).toHaveAttribute(
        'aria-describedby',
        (await reason.getAttribute('id'))!,
      );

      await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
      for (const tab of [configure, evidence]) {
        const panel = await tab.getAttribute('aria-controls');

        expect(panel).not.toBeNull();
        await expect(page.locator(`[id="${panel}"]`)).toHaveAttribute(
          'role',
          'tabpanel',
        );
      }
    });
  }

  test('sets its head, strip and body out on the pane’s steps', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    const header = page.locator('[data-inspector-header]');
    const strip = page.locator('[data-inspector-strip]');
    const body = page.locator('[role="tabpanel"]');

    await expect(header).toHaveCSS('padding', '12px 14px 0px');
    await expect(strip).toHaveCSS('padding', '6px 14px 0px');
    await expect(body).toHaveCSS('padding', '12px 14px');
    await expect(body).toHaveCSS('row-gap', '8px');
  });
});

/**
 * The colour a field's placeholder is painted in.
 *
 * The browser draws a placeholder in an element of
 * its own inside the field, which the page cannot
 * reach: asked for the placeholder's style, it
 * answers with the field's. The DevTools protocol
 * can reach it, so that is what is asked, of the
 * one element drawn inside this field.
 */
async function placeholderColour(page: Page, field: Locator): Promise<string> {
  const id = await field.getAttribute('id');
  expect(id).not.toBeNull();

  const devtools = await page.context().newCDPSession(page);
  await devtools.send('DOM.enable');
  await devtools.send('CSS.enable');

  const { root } = await devtools.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });

  type Node = typeof root;
  const within = (node: Node): Node[] => [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
  ];
  const find = (node: Node, found: (one: Node) => boolean): Node[] => [
    ...(found(node) ? [node] : []),
    ...within(node).flatMap((one) => find(one, found)),
  ];

  const [host] = find(
    root,
    (node) =>
      node.nodeName === 'INPUT' &&
      (node.attributes ?? []).some(
        (value, at, all) =>
          at % 2 === 1 && all[at - 1] === 'id' && value === id,
      ),
  );
  expect(host).toBeDefined();

  const drawn = find(host!, (node) =>
    (node.attributes ?? []).includes('-webkit-input-placeholder'),
  );
  expect(drawn).toHaveLength(1);

  const { computedStyle } = await devtools.send('CSS.getComputedStyleForNode', {
    nodeId: drawn[0]!.nodeId,
  });

  return computedStyle.find((one) => one.name === 'color')?.value ?? '';
}

test.describe('a block in the Inspector', () => {
  /**
   * A pane is usually shorter than a block's form,
   * so the form scrolls under the header and the
   * faces rather than being cut off at the bottom of
   * the pane.
   */
  test('scrolls a long form under its header', async ({ page }) => {
    const harness = await mountInspector(page);
    await page.setViewportSize({ width: 300, height: 320 });
    await harness.show(blockInit(queueSubject(INDEXING)));

    const column = page.locator('[role="tabpanel"]');
    await expect(column).toHaveCount(1);

    const strip = (await page.locator('[data-inspector-strip]').boundingBox())!;
    const sized = await column.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      overflows: element.scrollHeight > element.clientHeight,
      pane: window.innerHeight,
    }));

    expect(sized.overflows).toBe(true);
    expect(sized.top).toBeGreaterThanOrEqual(strip.y + strip.height);
    expect(sized.bottom).toBeLessThanOrEqual(sized.pane);

    const last = page.locator('[data-field="enqueuePolicy"] .section-label');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(page.locator('[data-inspector-heading]')).toBeInViewport();
    await expect(
      page.locator('[data-inspector-tab="configure"]'),
    ).toBeInViewport();
  });

  test('offers a field per thing the kind carries', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('reply_decision')));

    await expect(page.locator('[data-field="elsePort"] input')).toHaveValue(
      'stop',
    );
    await expect(page.locator('[data-field="cases"] .row')).toHaveCount(2);
  });

  /** And it says which block it is about, so the
   *  host sends it to the document it was made
   *  against and to no other. */
  test('sends an edit once the field is finished with', async ({ page }) => {
    const shown = blockInit(blockSubject('find_slot'));
    const harness = await openInspector(page, shown);

    const title = page.locator('[data-field="title"] input');

    await title.fill('Find an open slot');
    expect(await harness.postedOfType('edit')).toEqual([]);

    await title.press('Enter');

    const sent = await harness.postedOfType('edit');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      baseRevision: ir.revision,
      node: { id: 'find_slot', title: 'Find an open slot' },
      about: about(shown),
    });
  });

  /**
   * One pane draws the blocks of every open file,
   * and two files made from one pattern share their
   * ids and can sit at one revision. What somebody
   * set in one file's form belongs to that file: it
   * never shows in the other's, and is never sent as
   * an edit to it.
   */
  test('starts a form afresh for the same block in another file', async ({
    page,
  }) => {
    const inFile = (name: string, title: string, revision: number) =>
      blockInit(
        blockSubject('find_slot', { title }, 'configure', {
          ...ir,
          name,
          revision,
        }),
      );

    const harness = await openInspector(page, inFile('a', 'Alpha', 2));
    const title = page.locator('[data-field="title"] input');

    await title.fill('Alpha 2');
    await title.press('Enter');
    await expect.poll(() => harness.postedOfType('edit')).toHaveLength(1);

    await harness.show(inFile('a', 'Alpha 2', 3));
    await expect(title).toHaveValue('Alpha 2');

    await harness.show(inFile('b', 'Beta', 2));
    await expect(title).toHaveValue('Beta');

    const tries = page.locator('[data-field="retryMaxAttempts"] input');
    await tries.fill('5');
    await tries.press('Enter');

    await expect.poll(() => harness.postedOfType('edit')).toHaveLength(2);
    const [, sent] = await harness.postedOfType('edit');
    expect(sent).toMatchObject({
      baseRevision: 2,
      node: { id: 'find_slot', title: 'Beta', retry: { maxAttempts: 5 } },
    });
  });

  test('puts back what the document says when the edit is abandoned', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    const title = page.locator('[data-field="title"] input');

    await title.fill('Something else entirely');
    await title.press('Escape');

    await expect(title).toHaveValue('Find open slot');
    await expect(title).toBeFocused();
    expect(await harness.postedOfType('edit')).toEqual([]);
  });

  /**
   * How hard a block tries, shown as the numbers it
   * will actually run under. A block that carries
   * no policy of its own reads the defaults rather
   * than three empty boxes, so nobody has to know
   * what an empty box would mean.
   */
  test('offers the three retry fields on a step', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    await expect(
      page.locator('[data-field="retryMaxAttempts"] input'),
    ).toHaveValue('3');
    await expect(
      page.locator('[data-field="retryIntervalSeconds"] input'),
    ).toHaveValue('1');
    await expect(
      page.locator('[data-field="retryBackoffRate"] input'),
    ).toHaveValue('2');
  });

  /**
   * A queue block's form, which is the only one in
   * the column grouped under headers.
   *
   * It is grouped because it carries two policies
   * that are not one another's scope — what the
   * queue is registered with, and what each item's
   * enqueue is given — and reading them as one list
   * is how somebody sets a per-partition limit
   * believing they set the queue's.
   */
  test.describe('a queue block’s two policies', () => {
    /** The labels over the groups, as a person reads
     *  them down the face: the one that folds is the
     *  header of a control, and says its name after
     *  the marker it turns. */
    function groupLabels(page: Page): Locator {
      return page.locator(
        '[role="tabpanel"] [data-control="section"] > ' +
          ':is(.section-label, .section-head)',
      );
    }

    /** A queue registered with a limit on how fast
     *  it starts items, beside the unhurried one. */
    const LIMITED = {
      ...INDEXING,
      queue: {
        ...INDEXING.queue,
        workerConcurrency: 2,
        rateLimit: { limitPerPeriod: 100, periodSec: 60 },
      },
    };

    /** The row a field is set in: its own, or the one
     *  it shares with the other half of a pair. */
    function rowOf(page: Page, id: string): Locator {
      return page.locator(
        `[data-property][data-field="${id}"], ` +
          `[data-property]:has(> .value > [data-field="${id}"])`,
      );
    }

    /** The same queue at the next revision, as the
     *  host sends it once an edit has landed. */
    function revised(config: object) {
      const next = queueSubject(config);
      const revision = next.ir.revision + 1;

      return blockInit({ ...next, ir: { ...next.ir, revision }, revision });
    }

    test('come as groups, the last of them folded away', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      // Named, and not folded: a policy is read
      // whole. Only the knobs nobody turns often fold
      // away, behind the one header that is a button.
      await expect(groupLabels(page)).toHaveText([
        word(inspectorStrings.fieldsByKind.queue ?? {}, 'function'),
        word(inspectorStrings.fields, 'queuePolicy'),
        word(inspectorStrings.fields, 'enqueuePolicy'),
        word(inspectorStrings.fields, 'retryPolicy') +
          ` · ${inspectorStrings.configured}`,
        `${MARK}${word(inspectorStrings.fields, 'advanced')}`,
      ]);

      const folding = page.locator('.section-head');
      await expect(folding).toHaveCount(1);
      expect(
        await folding.evaluate((head) =>
          head.parentElement?.matches('[data-field="advanced"]'),
        ),
      ).toBe(true);

      await expect(page.locator('[data-field="queueName"] input')).toHaveValue(
        'document-index',
      );
      await expect(page.locator('[data-field="itemsPath"] input')).toHaveValue(
        'pages',
      );

      await expect(
        page.locator('[data-field="advanced"] .section-head'),
      ).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-field="onConflict"]')).toHaveCount(0);
    });

    /**
     * In the order the settings take hold: the
     * function each item runs, what the queue is
     * registered with, what each item is enqueued
     * with, and how hard that item's run tries once
     * it is running. The knobs nobody turns often
     * come last, and the ways out of the form after
     * everything it sets.
     */
    test('put handler, both policies, retry and advanced in order', async ({
      page,
    }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      const face = page.locator('[role="tabpanel"]');
      await expect(face.locator('[data-field="advanced"]')).toHaveCount(1);

      expect(
        await face
          .locator('[data-field]')
          .evaluateAll((fields) =>
            fields.map((field) => field.getAttribute('data-field')),
          ),
      ).toEqual([
        'function',
        'handler',
        // The scan has no such export, so the types
        // the block declares are drawn.
        'in',
        'out',
        'queuePolicy',
        'queueName',
        'globalConcurrency',
        'workerConcurrency',
        'rateLimitPer',
        'rateLimitSec',
        'partitioning',
        'enqueuePolicy',
        'itemsPath',
        'itemType',
        'priority',
        'delaySeconds',
        'deduplicationPath',
        'retryPolicy',
        'retryMaxAttempts',
        'retryIntervalSeconds',
        'retryBackoffRate',
        'advanced',
      ]);

      await expect(groupLabels(page).first()).toHaveText(
        word(inspectorStrings.fieldsByKind.queue ?? {}, 'function'),
      );
      await expect(
        page.locator('[data-field="handler"] [data-picker-lib]'),
      ).toHaveCount(1);

      const actions = face.locator('[data-configure-actions]');
      await expect(actions.locator('> *')).toHaveCount(2);
      await expect(actions.locator('> :nth-child(1)')).toHaveAttribute(
        'data-open-function',
        '',
      );
      await expect(actions.locator('> :nth-child(2)')).toHaveAttribute(
        'data-ask-block',
        '',
      );
    });

    /**
     * Said once each group's rows are all drawn,
     * right after the last of them: which process a
     * limit holds back, and what DBOS refuses of an
     * item on a partitioned queue. Neither is a fact
     * about one row, and neither is a caption for
     * the label.
     */
    test('say after each group what its rows do not', async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit(queueSubject(INDEXING)),
      );
      const hint = (id: string) => page.locator(`[data-group-hint="${id}"]`);
      const follows = (id: string) =>
        hint(id).evaluate((said) =>
          said.previousElementSibling?.querySelector('[data-field]') === null
            ? said.previousElementSibling?.getAttribute('data-field')
            : said.previousElementSibling
                ?.querySelector('[data-field]')
                ?.getAttribute('data-field'),
        );

      await expect(hint('queuePolicy')).toHaveText(
        'global = across processes · worker = per process',
      );
      await expect(hint('queuePolicy')).toHaveText(
        word(inspectorStrings.hints, 'queuePolicy'),
      );
      await expect(hint('enqueuePolicy')).toHaveText(
        word(inspectorStrings.hints, 'enqueuePolicy'),
      );

      expect(await follows('queuePolicy')).toBe('partitioning');
      expect(await follows('enqueuePolicy')).toBe('deduplicationPath');
      await expect(
        page.locator('[data-control="section"] .field-hint'),
      ).toHaveCount(0);

      // Partitioned, each group has one more row,
      // and the sentence follows that one instead.
      await harness.show(blockInit(queueSubject(PARTITIONED)));

      await expect(page.locator('[data-field="partitionPath"]')).toHaveCount(1);
      expect(await follows('queuePolicy')).toBe('partitionConcurrency');
      expect(await follows('enqueuePolicy')).toBe('partitionPath');
    });

    /**
     * DBOS will not deduplicate items on a
     * partitioned queue. The box holding the path
     * stays a box: emptying it is one of the two ways
     * out, and a box switched off would take that way
     * out of reach of the person it is for. What is
     * wrong is said instead, with both ways out.
     */
    test('say what is wrong with deduplication, and leave it editable', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        blockInit(queueSubject(PARTITIONED, [DEDUPLICATES])),
      );
      const path = page.locator('[data-field="deduplicationPath"] input');

      await expect(
        page.locator('[data-field="partitioning"] select'),
      ).toHaveValue('on');
      await expect(path).toBeEnabled();
      await expect(path).toBeEditable();
      await expect(path).toHaveValue('documentId');
      await expect(
        page.locator('[data-field="deduplicationPath"] .field-note'),
      ).toHaveText(DEDUPLICATES.message);

      await expect(
        page.locator('[data-group-hint="enqueuePolicy"]'),
      ).toHaveText(
        'partitioned queues cannot deduplicate — with partitioning on, ' +
          'a deduplication path is an error on the block · ' +
          'empty this box or turn partitioning off',
      );

      await path.fill('');
      await path.press('Enter');

      // Emptied, the path comes off the block and the
      // queue stays partitioned: the other way out is
      // left to whoever wants it.
      const sent = await harness.postedOfType('edit');
      expect(sent).toHaveLength(1);

      const { config } = sent[0]!.node as {
        config: { queue: object; enqueue: object };
      };
      expect(config.enqueue).not.toHaveProperty('deduplicationPath');
      expect(config.queue).toMatchObject({ partitionConcurrency: 2 });
    });

    /**
     * A limit is a count and the period it is
     * counted over, read as one figure — "100 / 60
     * s" — so it is one row. Each box is named for
     * the half it holds, since the row's label names
     * both, and the unit is said with the period it
     * counts rather than with the count.
     */
    test('draw a rate limit as one row of two boxes', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(LIMITED)));

      const row = rowOf(page, 'rateLimitPer');
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('role', 'group');
      await expect(row).toHaveAccessibleName(
        word(inspectorStrings.fields, 'rateLimit'),
      );
      await expect(row).toHaveAttribute('data-labels', 'wide');
      await expect(row.locator(':scope > .property-label')).toHaveText(
        'rate limit',
      );

      const count = page.getByRole('textbox', {
        name: 'rate limit, count',
        exact: true,
      });
      const period = page.getByRole('textbox', {
        name: 'rate limit, period',
        exact: true,
      });

      await expect(
        row.locator('[data-field="rateLimitPer"] input'),
      ).toHaveCount(1);
      await expect(
        row.locator('[data-field="rateLimitSec"] input'),
      ).toHaveCount(1);
      await expect(count).toHaveValue('100');
      await expect(period).toHaveValue('60');
      await expect(count).toHaveAttribute('data-mono', '');

      await expect(row.locator('.property-joint')).toHaveText('/');
      await expect(row.locator('.property-unit')).toHaveText('s');
      await expect(period).toHaveAccessibleDescription('s');
      await expect(count).not.toHaveAttribute('aria-describedby', /./);

      const [one, joint, other, unit] = await Promise.all(
        [
          count,
          row.locator('.property-joint'),
          period,
          row.locator('.property-unit'),
        ].map(async (part) => (await part.boundingBox())!),
      );

      // Read across as it is written, each part close
      // behind the one before it, on one line.
      const gaps = [
        joint!.x - (one!.x + one!.width),
        other!.x - (joint!.x + joint!.width),
        unit!.x - (other!.x + other!.width),
      ];

      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(8);
      }
      expect(Math.abs(one!.y - other!.y)).toBeLessThanOrEqual(1);
      expect(unit!.y).toBeLessThan(other!.y + other!.height);

      await labelBeforeValue(row);
    });

    /**
     * A queue with no rate limit says so in the box a
     * limit starts from, and draws nothing after it:
     * a mark and a unit around two empty boxes read as
     * a limit with its figures missing. Typing a count
     * brings the rest of the row back.
     */
    test('say a queue has no rate limit in the box one starts from', async ({
      page,
    }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      const row = rowOf(page, 'rateLimitPer');
      const count = row.locator('[data-field="rateLimitPer"] input');
      const rest = [
        row.locator('.property-joint'),
        row.locator('[data-field="rateLimitSec"] input'),
        row.locator('.property-unit'),
      ];

      await expect(count).toHaveValue('');
      await expect(count).toHaveAttribute(
        'placeholder',
        word(inspectorStrings.placeholders, 'rateLimitPer'),
      );
      await expect(count).toBeVisible();
      for (const part of rest) {
        await expect(part).toHaveCount(1);
        await expect(part).toBeHidden();
      }

      await count.fill('100');

      for (const part of rest) {
        await expect(part).toBeVisible();
      }
    });

    test('accept a rate limit on a queue that has none', async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit(queueSubject(INDEXING)),
      );
      const per = page.locator('[data-field="rateLimitPer"] input');
      const seconds = page.locator('[data-field="rateLimitSec"] input');

      await per.fill('100');
      await per.press('Enter');
      await seconds.fill('20');
      await seconds.press('Enter');

      const edits = await harness.postedOfType('edit');
      expect(edits.at(-1)?.node).toMatchObject({
        config: {
          queue: {
            rateLimit: { limitPerPeriod: 100, periodSec: 20 },
          },
        },
      });
    });

    /**
     * A count given on its own is a whole limit, over
     * the period a limit starts with, and the box
     * beside it says that period straight away. So
     * passing through that box on the way out of the
     * row leaves the limit as it was given, rather
     * than reading the box's old emptiness as a
     * limit taken off.
     */
    test('fill in a limit’s other half, and keep it when passed over', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        blockInit(queueSubject(INDEXING)),
      );
      const count = page.locator('[data-field="rateLimitPer"] input');
      const period = page.locator('[data-field="rateLimitSec"] input');

      await expect(period).toHaveValue('');

      await count.fill('100');
      await count.press('Tab');

      await expect(period).toBeFocused();
      await expect(period).toHaveValue('60');

      await period.press('Tab');

      const edits = await harness.postedOfType('edit');
      expect(edits).toHaveLength(1);
      expect(edits[0]?.node).toMatchObject({
        config: {
          queue: { rateLimit: { limitPerPeriod: 100, periodSec: 60 } },
        },
      });
    });

    test('keep an open group across queue edits from the host', async ({
      page,
    }) => {
      const partitioned = {
        ...INDEXING,
        queue: { ...INDEXING.queue, partitionConcurrency: 2 },
      };
      const harness = await openInspector(
        page,
        blockInit(queueSubject(partitioned)),
      );
      const advanced = page.locator('[data-field="advanced"] .section-head');
      await advanced.click();

      const per = page.locator('[data-field="partitionRateLimitPer"] input');
      await per.fill('30');
      await per.press('Enter');
      const firstEdit = (await harness.postedOfType('edit')).at(-1);
      if (firstEdit === undefined) throw new Error('no edit');
      expect(firstEdit.node).toMatchObject({
        config: {
          queue: {
            partitionRateLimit: { limitPerPeriod: 30, periodSec: 60 },
          },
        },
      });

      await harness.show(
        revised({
          ...partitioned,
          queue: {
            ...partitioned.queue,
            partitionRateLimit: { limitPerPeriod: 30, periodSec: 60 },
          },
        }),
      );

      await expect(advanced).toHaveAttribute('aria-expanded', 'true');
      await expect(
        page.locator('[data-field="minPollingIntervalMs"]'),
      ).toBeVisible();

      const seconds = page.locator(
        '[data-field="partitionRateLimitSec"] input',
      );
      await seconds.fill('2');
      await seconds.press('Enter');
      const secondEdit = (await harness.postedOfType('edit')).at(-1);
      expect(secondEdit?.node).toMatchObject({
        config: {
          queue: {
            partitionRateLimit: { limitPerPeriod: 30, periodSec: 2 },
          },
        },
      });
    });

    /**
     * The fold, opened and closed.
     *
     * A header owns the run of fields after it as
     * far as the next header — not the whole rest of
     * the form — and stays on screen either way,
     * because it is the way back into what it hides.
     *
     * Read with the motion off: the marker's turn is
     * transitioned, and a transform read while that
     * is still running is the folded matrix in both
     * states.
     */
    test('fold and unfold a group at its header', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      const head = page.locator('[data-field="advanced"] .section-head');
      const mark = page.locator('[data-field="advanced"] .section-mark');

      // The header is the one control on the form
      // that folds, and it is the same control every
      // other quiet one on it is.
      await expect(head).toHaveAttribute('data-variant', 'quiet');
      await expect(
        page.locator('[data-field="advanced"] .btn.section-head'),
      ).toHaveCount(1);

      await expect(mark).toHaveCSS('transform', 'matrix(0, -1, 1, 0, 0, 0)');

      await head.click();

      await expect(head).toHaveAttribute('aria-expanded', 'true');
      await expect(mark).toHaveCSS('transform', 'none');
      await expect(
        page.locator('[data-field="onConflict"] select'),
      ).toHaveCount(1);

      await head.click();

      await expect(head).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-field="onConflict"]')).toHaveCount(0);
      await expect(page.locator('[data-field="queueName"] input')).toHaveValue(
        'document-index',
      );
    });

    /**
     * Folded, the group is its header and nothing
     * else: not its rows, and not the sentence about
     * them, which is read after them once they are
     * there to be read.
     */
    test('keep the advanced knobs out of the page until asked', async ({
      page,
    }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      const knobs = [
        'partitionWorkerConcurrency',
        'partitionRateLimitPer',
        'partitionRateLimitSec',
        'minPollingIntervalMs',
        'onConflict',
      ];
      const hint = page.locator('[data-group-hint="advanced"]');

      await expect(page.locator('[data-field="advanced"]')).toHaveCount(1);
      for (const knob of knobs) {
        await expect(page.locator(`[data-field="${knob}"]`)).toHaveCount(0);
      }
      await expect(hint).toHaveCount(0);

      await page.locator('[data-field="advanced"] .section-head').click();

      for (const knob of knobs) {
        await expect(page.locator(`[data-field="${knob}"]`)).toHaveCount(1);
      }
      await expect(hint).toHaveText(word(inspectorStrings.hints, 'advanced'));
      expect(
        await hint.evaluate(
          (said) =>
            said.previousElementSibling?.getAttribute('data-field') ?? null,
        ),
      ).toBe('onConflict');
    });

    for (const theme of THEMES_ALL) {
      /**
       * The fold takes the edge every quiet control
       * takes, which is what a theme drawing edges
       * around controls draws it by: a header nobody
       * can see the bounds of is a header nobody
       * knows is a control.
       */
      test(`draws the fold with the edge every control has in ${theme}`, async ({
        page,
      }) => {
        await openInspector(page, blockInit(queueSubject(INDEXING)), theme);

        const drawn = await page
          .locator('[data-field="advanced"] .section-head')
          .evaluate((head) => getComputedStyle(head).borderTopColor);
        const edge = colourOf(theme, 'control-edge');

        expect(sameColour(drawn, edge), `${drawn} ≠ ${edge}`).toBe(true);
      });

      /**
       * An empty priority and an empty delay are
       * settings nobody gave, and the words for that
       * stand in the empty box in the editor's
       * placeholder colour — never in a value's, where
       * "none" would read as a value somebody typed.
       */
      test(`show unset and none as placeholders in ${theme}`, async ({
        page,
      }) => {
        const harness = await openInspector(
          page,
          blockInit(queueSubject(INDEXING)),
          theme,
        );

        const expected = colourOf(theme, 'input-placeholder');
        const boxes = {
          priority: [word(inspectorStrings.placeholders, 'priority'), 'unset'],
          delaySeconds: [
            word(inspectorStrings.placeholders, 'delaySeconds'),
            'none',
          ],
        };

        for (const [id, [said, literal]] of Object.entries(boxes)) {
          const box = page.locator(`[data-field="${id}"] input`);

          await expect(box).toHaveValue('');
          await expect(box).toHaveAttribute('placeholder', said!);
          expect(said).toBe(literal);

          const colour = await placeholderColour(page, box);
          expect(sameColour(colour, expected), `${colour} ≠ ${expected}`).toBe(
            true,
          );
        }

        // A unit counts a number, so it waits for one:
        // beside the word it would read "none s".
        const unit = page.locator('[data-field="delaySeconds"] .property-unit');

        await expect(unit).toHaveText('s');
        await expect(unit).toBeHidden();

        await harness.show(
          revised({
            ...INDEXING,
            enqueue: { ...INDEXING.enqueue, delaySeconds: 10 },
          }),
        );

        await expect(
          page.locator('[data-field="delaySeconds"] input'),
        ).toHaveValue('10');
        await expect(unit).toBeVisible();
      });
    }

    test('set partitioning in the machine face', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      const menu = page.locator('[data-field="partitioning"] select');
      await expect(menu).toHaveCount(1);
      await expect(menu).toHaveAttribute('data-mono', '');
      expect(
        await menu.evaluate((select) => getComputedStyle(select).fontFamily),
      ).toContain('Spline Sans Mono');
      await expect(menu.locator('option')).toHaveText([
        word(inspectorStrings.options, 'partitioning.off'),
        word(inspectorStrings.options, 'partitioning.on'),
      ]);
    });

    /**
     * A pane is short, and a queue's form with its
     * advanced knobs open is the longest one there
     * is. The form scrolls inside the face, so the
     * block's name and its two faces stay where they
     * are however far down somebody has gone — and
     * stay gone that far when what they committed
     * comes back as the next revision.
     */
    test('scroll the form, never the page or its head', async ({ page }) => {
      const harness = await mountInspector(page);
      await page.setViewportSize({ width: 300, height: 360 });

      const partitioned = {
        ...LIMITED,
        queue: { ...LIMITED.queue, partitionConcurrency: 2 },
      };
      await harness.show(blockInit(queueSubject(partitioned)));
      await page.locator('[data-field="advanced"] .section-head').click();
      await expect(page.locator('[data-field="onConflict"]')).toHaveCount(1);

      const face = page.locator('[role="tabpanel"]');
      const tops = () =>
        page.evaluate(() => ({
          header: document
            .querySelector('[data-inspector-header]')!
            .getBoundingClientRect().top,
          tabs: document
            .querySelector('[role="tablist"]')!
            .getBoundingClientRect().top,
        }));

      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight === window.innerHeight,
        ),
      ).toBe(true);
      expect(
        await face.evaluate(
          (scroll) => scroll.scrollHeight > scroll.clientHeight,
        ),
      ).toBe(true);

      const before = await tops();
      await face.evaluate((scroll) => {
        scroll.scrollTop = scroll.scrollHeight;
      });
      const scrolled = await face.evaluate((scroll) => scroll.scrollTop);

      expect(scrolled).toBeGreaterThan(0);
      expect(await tops()).toEqual(before);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      const polling = page.locator('[data-field="minPollingIntervalMs"] input');
      await polling.fill('500');
      await polling.press('Enter');
      expect(await harness.postedOfType('edit')).toHaveLength(1);

      await harness.show(
        revised({
          ...partitioned,
          queue: { ...partitioned.queue, minPollingIntervalMs: 500 },
        }),
      );
      await expect(polling).toHaveValue('500');

      expect(await face.evaluate((scroll) => scroll.scrollTop)).toBe(scrolled);
      expect(await tops()).toEqual(before);
    });

    /**
     * The advanced knobs are short nouns, with the
     * unit a number is counted in drawn beside the
     * number, so each fits the queue's label column
     * on one line and its row is as tall as any row
     * with one box in it.
     */
    test('fit the advanced labels on one line', async ({ page }) => {
      const partitioned = {
        ...LIMITED,
        queue: {
          ...LIMITED.queue,
          partitionConcurrency: 2,
          partitionWorkerConcurrency: 1,
          partitionRateLimit: { limitPerPeriod: 30, periodSec: 1 },
          minPollingIntervalMs: 250,
        },
      };
      await openInspector(page, blockInit(queueSubject(partitioned)));
      await page.locator('[data-field="advanced"] .section-head').click();

      const oneBox = rowOf(page, 'queueName');
      await expect(oneBox).toHaveCount(1);
      const height = (await oneBox.boundingBox())!.height;

      const rows = {
        partitionWorkerConcurrency: 'partition workers',
        partitionRateLimitPer: 'partition rate limit',
        minPollingIntervalMs: 'min polling',
      };

      for (const [id, label] of Object.entries(rows)) {
        const row = rowOf(page, id);
        await expect(row).toHaveCount(1);

        const name = row.locator(':scope > .property-label');
        await expect(name).toHaveText(label);
        expect(await linesIn(name), label).toBe(1);
        expect((await row.boundingBox())!.height, label).toBeCloseTo(height, 0);
      }

      await expect(
        rowOf(page, 'partitionRateLimitPer').getByRole('textbox', {
          name: 'partition rate limit, count',
          exact: true,
        }),
      ).toHaveValue('30');
      await expect(
        rowOf(page, 'partitionRateLimitPer').getByRole('textbox', {
          name: 'partition rate limit, period',
          exact: true,
        }),
      ).toHaveValue('1');
      await expect(
        page.locator('[data-field="minPollingIntervalMs"] .property-unit'),
      ).toHaveText('ms');
    });

    /**
     * Core reports both of these against the block,
     * under one rule, at one severity. Only one of
     * them has a box on this form holding half its
     * remedy, and that is the one drawn on the box.
     * The other stays the block's.
     */
    test('draw the finding the deduplication path is a way out of', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit(queueSubject(PARTITIONED, [NO_PARTITION_KEY, DEDUPLICATES])),
      );

      await expect(
        page.locator('[data-field="deduplicationPath"] .field-note'),
      ).toHaveText(DEDUPLICATES.message);

      await expect(page.getByText(NO_PARTITION_KEY.message)).toHaveCount(0);
    });

    /**
     * And the labels get the room their scopes need.
     * `worker concurrency` in the column every other
     * form is set in wraps under itself beside a
     * one-line box.
     */
    test('are labelled in a column wide enough to read', async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit(queueSubject(INDEXING)),
      );
      await expect(page.locator('[data-property]').first()).toBeVisible();

      expect(await labelTrack(page)).toBe(120);

      await harness.show(blockInit(blockSubject('find_slot')));
      await expect(page.locator('[data-field="title"] input')).toHaveValue(
        'Find open slot',
      );

      expect(await labelTrack(page)).toBe(76);
    });

    /**
     * The queue kind ships, so its head is the head
     * every block has — its name, its kind and where
     * a run got to — with no tag saying it is still
     * to come.
     */
    test('carry no tag saying the kind is still to come', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));
      await page.locator('[data-field="advanced"] .section-head').click();

      await expect(page.locator('[data-inspector-kind]')).toHaveText(
        canvasWords.kinds.queue,
      );
      await expect(page.getByText(/^\s*next\s*$/i)).toHaveCount(0);
    });
  });

  /**
   * The column asks two questions about one block —
   * what it should do, and what a run recorded about
   * it doing that — and never both at once. Two
   * faces rather than one long form.
   */
  test('offers two faces', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    await expect(page.locator('button[data-inspector-tab]')).toHaveText([
      inspectorStrings.tabs.configure,
      inspectorStrings.tabs.evidence,
    ]);
    await expect(
      page.locator('button[data-inspector-tab="configure"]'),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-inspector-mode]')).toHaveCount(0);
  });

  /**
   * With no run there is nothing recorded to read,
   * and the face says what would give it something.
   * It refuses rather than switching off, so a
   * keyboard still lands on it and hears why.
   */
  test('disables Run Evidence with no run and says why', async ({ page }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const evidence = page.locator('button[data-inspector-tab="evidence"]');
    const reason = page.locator('[data-no-run]');

    await expect(evidence).toHaveAttribute('aria-disabled', 'true');
    await expect(reason).toHaveText(inspectorStrings.noRun);
    // Refused, not switched off: a keyboard still
    // reaches it.
    expect(
      await evidence.evaluate((tab) => (tab as HTMLButtonElement).disabled),
    ).toBe(false);

    await harness.show(
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await expect(page.locator('[data-inspector-tab]')).toHaveCount(2);
    await expect(evidence).not.toHaveAttribute('aria-disabled', 'true');
    await expect(reason).toHaveCount(0);
  });

  /**
   * On the run tab the block is one a run recorded,
   * and the document may have lost it since. What
   * the run recorded is still there to read, and
   * there is nothing left to configure.
   */
  test('offers Configure on the run tab while the block is there', async ({
    page,
  }) => {
    const onRunTab = (nodeId: string): BlockSubject => ({
      ...blockSubject('find_slot', {}, 'evidence'),
      source: 'run',
      nodeId,
      run: runOf(IN_FLIGHT),
    });
    const configure = page.locator('button[data-inspector-tab="configure"]');
    const reason = page.locator('[data-not-in-workflow]');
    const heading = page.locator('[data-inspector-header] .inspector-title');

    const harness = await openInspector(page, blockInit(onRunTab('find_slot')));

    await expect(configure).toHaveCount(1);
    await expect(configure).not.toHaveAttribute('aria-disabled', 'true');
    await expect(reason).toHaveCount(0);
    await expect(heading).toHaveCount(0);
    await expect(
      page.locator('[data-inspector-header] [data-inspector-heading]'),
    ).toHaveCount(1);

    await harness.show(blockInit(onRunTab('deleted_block')));

    // A block the document has lost has no name left
    // to set, so the head says the id its rows know
    // it by rather than the pane's own name.
    await expect(heading).toHaveText('deleted_block');
    await expect(heading).toHaveAttribute('data-mono', '');
    await expect(configure).toHaveAttribute('aria-disabled', 'true');
    await expect(reason).toHaveText(inspectorStrings.notInWorkflow);
    await expect(configure).toHaveAttribute(
      'aria-describedby',
      (await reason.getAttribute('id'))!,
    );
  });

  /** Two faces, not one long form: a field somebody
   *  may change never sits beside a fact they may
   *  not. The block's name is the one field over
   *  both, in the head rather than in either face. */
  test('shows a block’s fields on Configure only', async ({ page }) => {
    const harness = await mountInspector(page);
    const face = page.locator('[role="tabpanel"]');

    await harness.show(
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await expect(face.locator('[data-field]').first()).toBeVisible();

    await harness.show(
      blockInit({
        ...blockSubject('find_slot', {}, 'evidence'),
        run: runOf(IN_FLIGHT),
      }),
    );

    await expect(
      page.locator('[data-inspector-header] [data-field="title"]'),
    ).toHaveCount(1);
    await expect(face).toHaveCount(1);
    await expect(face.locator('[data-field]')).toHaveCount(0);
  });

  /**
   * And the face is the host's to hold. A panel is
   * torn down whenever it is hidden, so a tab a
   * person chose survives only where the selection
   * does.
   */
  test('posts the face a person picked, and the block it is for', async ({
    page,
  }) => {
    const harness = await mountInspector(page);
    const shown = blockInit({
      ...blockSubject('find_slot', {}, 'evidence'),
      run: runOf(IN_FLIGHT),
    });

    await harness.show(shown);

    await page.locator('button[data-inspector-tab="configure"]').click();

    expect(await harness.postedOfType('inspectorMode')).toEqual([
      { type: 'inspectorMode', mode: 'configure', about: about(shown) },
    ]);
  });

  /**
   * The other face: what a run recorded about the
   * block on screen.
   *
   * Everything on it was read off the ledger and can
   * be edited by nobody. The head says where the
   * block got to and which row says so; the face
   * reads down from the function that ran, through
   * when it ran and what it returned, to the ways on
   * from it. DBOS records no per-step input and no
   * count of the tries a step made, so the face
   * invents neither, and what is a fact about the
   * whole run is left to the card about the run.
   */
  test.describe('what a run recorded about a block', () => {
    /** The face under the strip. */
    function face(page: Page) {
      return page.locator('[data-evidence="block"]');
    }

    /** The state in the head of the pane. */
    function status(page: Page) {
      return page.locator('[data-inspector-header] .status-line');
    }

    /** What the state line says after its glyph. */
    async function said(page: Page): Promise<string> {
      const words = await status(page)
        .locator(':scope > span:not(.status-glyph)')
        .allTextContents();

      return words.join('');
    }

    /** A block of the canonical document on Run
     *  evidence, against a run. */
    function onEvidence(
      nodeId: string,
      run: ShownRun,
      over: Partial<BlockSubject> = {},
      document: WorkflowIR = ir,
    ): InspectorInit {
      return blockInit({
        ...blockSubject(nodeId, {}, 'evidence', document),
        run,
        ...over,
      });
    }

    /** The ways on, in the order they are drawn. */
    function actions(page: Page) {
      return face(page).locator('[data-evidence-action]');
    }

    /** What the face says a recorded result is for,
     *  word for word. */
    const RECORDED_FOOTER =
      'recorded result · reused on recovery and by a replay from a later step';

    /** The completed step, having returned that. */
    function returned(output: string) {
      return liveStep({
        name: DONE.name,
        nodeId: DONE.nodeId,
        functionId: DONE.functionId,
        startedAt: DONE.startedAt,
        completedAt: DONE.completedAt,
        output,
      });
    }

    /** A step that returned a value this long, as the
     *  panel prints it. */
    function returning(length: number) {
      return returned(JSON.stringify('x'.repeat(length - 2)));
    }

    /** A block that fanned out over three items and
     *  failed on the second. */
    const FANNED_OUT = [
      liveStep({ ...DONE, name: 'find_slot[0]', functionId: 3 }),
      liveStep({ ...THREW, name: 'find_slot[1]', functionId: 4 }),
      liveStep({ ...DONE, name: 'find_slot[2]', functionId: 5 }),
    ];

    test('heads a step with where it got to and its row', async ({ page }) => {
      const harness = await mountInspector(page);
      await harness.show(onEvidence('find_slot', recording([DONE])));

      await expect(status(page)).toHaveCount(1);
      await expect(status(page)).toHaveAttribute('data-run-state', 'done');
      await expect(status(page).locator('.status-glyph')).toHaveText('✓');
      expect(await said(page)).toBe('done · #3');
      await expect(status(page).locator('[data-function-id]')).toHaveText('#3');
      await expect(status(page)).not.toHaveAttribute('data-provenance');

      // In the machine face, as the kind word beside
      // it is: a state is what a ledger recorded.
      const [line, kind] = await Promise.all([
        status(page).evaluate((drawn) => getComputedStyle(drawn).fontFamily),
        page
          .locator('[data-inspector-kind]')
          .evaluate((drawn) => getComputedStyle(drawn).fontFamily),
      ]);
      expect(line).toBe(kind);

      // A row picked on the run tab heads the block
      // with that row, not the block's last one.
      const twice = recording([
        DONE,
        liveStep({ ...DONE, functionId: 5, name: 'find_slot' }),
      ]);

      await harness.show(
        onEvidence('find_slot', twice, { source: 'run', functionId: 3 }),
      );
      expect(await said(page)).toBe('done · #3');

      await harness.show(onEvidence('find_slot', twice, { source: 'run' }));
      expect(await said(page)).toBe('done · #5');
    });

    for (const theme of THEMES_ALL) {
      test(`says a step’s state in its tone in ${theme}`, async ({ page }) => {
        const harness = await mountInspector(page, theme);

        for (const [step, role] of [
          [DONE, 'ok'],
          [THREW, 'fail'],
        ] as const) {
          await harness.show(onEvidence('find_slot', recording([step])));
          await expect(status(page)).toHaveCount(1);

          const drawn = await status(page).evaluate(
            (line) => getComputedStyle(line).color,
          );
          const tone = colourOf(theme, 'state-ink') || colourOf(theme, role);

          expect(sameColour(drawn, tone), `${drawn} ≠ ${tone}`).toBe(true);
        }
      });
    }

    /**
     * On the run tab a pick in the trace can land on
     * a row the SDK wrote under the block. That row
     * is the one somebody asked about, so the head
     * and the times are that row's — and with no row
     * picked, the block's own row heads it again.
     */
    test('heads a block with the SDK row picked under it', async ({ page }) => {
      const register = liveStep({
        name: 'await_reply.register',
        nodeId: 'await_reply',
        functionId: 6,
        startedAt: RECORDED_AT,
        completedAt: RECORDED_AT + 5,
      });
      const received = liveStep({
        name: 'DBOS.recv',
        nodeId: 'await_reply',
        functionId: 7,
        startedAt: RECORDED_AT + 10_000,
        completedAt: RECORDED_AT + 20_000,
        sdk: true,
      });
      const run = recording([register, received]);
      const started = face(page).locator(
        '[data-evidence-field="started"] .value',
      );

      const harness = await openInspector(
        page,
        onEvidence('await_reply', run, { source: 'run', functionId: 7 }),
      );

      expect(await said(page)).toBe('done · #7');
      await expect(started).toHaveText('10:31:24.218');
      await expect(
        face(page).locator('[data-evidence-field="completed"] .value'),
      ).toHaveText('10:31:34.218');

      await harness.show(onEvidence('await_reply', run, { source: 'run' }));

      expect(await said(page)).toBe('done · #6');
      await expect(started).toHaveText('10:31:14.218');
    });

    /**
     * A wait on the clock writes its wake-up time
     * before it sleeps, so that row's completion is
     * when it wakes rather than when anything
     * finished. It says so, and says it woke once the
     * run has passed it — never "done" beside a time
     * still to come.
     */
    test('says a wait on the clock wakes, then that it woke', async ({
      page,
    }) => {
      const waiting = (answered: boolean) =>
        blockInit({
          ...blockSubject('let_it_wait', {}, 'evidence', TIMER_THEN_ANSWER),
          run: timerThenAnswerRun({ attributed: true, answered }),
          manifest: undefined,
          diagnostics: [],
        });
      const header = page.locator('[data-inspector-header]');

      const harness = await openInspector(page, waiting(false));

      await expect(header.locator('[data-run-state="waiting"]')).toHaveCount(1);
      await expect(
        face(page).locator('[data-evidence-field="wakes"] .property-label'),
      ).toHaveText(inspectorStrings.wakes);
      await expect(
        face(page).locator('[data-evidence-field="wakes"] .value'),
      ).toHaveText('00:01:01.000');
      await expect(
        face(page).locator('[data-evidence-field="woke"]'),
      ).toHaveCount(0);
      for (const gone of ['completed', 'duration']) {
        await expect(
          face(page).locator(`[data-evidence-field="${gone}"]`),
        ).toHaveCount(0);
      }

      await harness.show(waiting(true));

      await expect(header.locator('[data-run-state="done"]')).toHaveCount(1);
      await expect(
        face(page).locator('[data-evidence-field="woke"] .property-label'),
      ).toHaveText(inspectorStrings.woke);
      await expect(
        face(page).locator('[data-evidence-field="wakes"]'),
      ).toHaveCount(0);
    });

    /**
     * One reading, top to bottom: the function that
     * ran, when it ran, how hard it was allowed to
     * try, what it returned, the ways on, and last
     * what that returned value is for.
     */
    test('reads down from the function to what its result is for', async ({
      page,
    }) => {
      await openInspector(page, onEvidence('find_slot', recording([DONE])));

      await expect(face(page)).toHaveCount(1);

      const order = await face(page).evaluate((drawn) =>
        [...drawn.children].map(
          (child) =>
            (child as HTMLElement).dataset.evidenceField ??
            ((child as HTMLElement).dataset.evidenceActions === undefined
              ? child.className
              : 'actions'),
        ),
      );
      expect(order).toEqual([
        'handler',
        'started',
        'completed',
        'duration',
        'retry',
        'output',
        'actions',
        'recordedFooter',
      ]);

      // The function as the picker draws the one a
      // block runs, but not a thing to press.
      const fn = face(page).locator('[data-evidence-field="handler"]');
      await expect(fn).toHaveClass(/\blib-fn\b/);
      await expect(fn).toHaveAttribute('data-state', 'assigned');
      expect(await fn.evaluate((row) => row.tagName)).toBe('DIV');
      await expect(fn.locator('.lib-name')).toHaveText('findSlot');
      await expect(fn.locator('.signature')).toHaveText(
        signatureOf(
          manifest.functions.find((one) => one.export === 'findSlot')!,
        ),
      );

      // Every time on a 24-hour clock, to the
      // millisecond, whatever this page's locale is.
      for (const [field, time] of [
        ['started', '10:31:14.218'],
        ['completed', '10:31:14.266'],
      ] as const) {
        const value = face(page).locator(
          `[data-evidence-field="${field}"] .value`,
        );
        await expect(value).toHaveText(time);
        await expect(value.locator('[data-time="fine"]')).toHaveText(time);
      }
      await expect(
        face(page).locator('[data-evidence-field="duration"] .value'),
      ).toHaveText('48 ms');

      // The document's policy, marked as the
      // document's rather than as anything the run
      // recorded.
      const retry = face(page).locator('[data-evidence-field="retry"]');
      await expect(retry.locator('.section-label')).toHaveText(
        `${inspectorStrings.retryPolicy} · ${inspectorStrings.configured}`,
      );
      await expect(
        retry.locator('.section-label [data-provenance="configured"]'),
      ).toHaveText(`· ${inspectorStrings.configured}`);
      await expect(retry.locator('[data-evidence-policy]')).toHaveText(
        'max 3 · interval 1 s · backoff 2×',
      );

      // The value the step returned, not the wrapper
      // whatever serializer the project registered
      // stored it in.
      const output = face(page).locator('[data-evidence-field="output"]');
      await expect(output.locator('.section-label')).toHaveText(
        inspectorStrings.outputLabel,
      );
      await expect(
        output.locator('[data-recorded] [data-verbatim]'),
      ).toHaveText(DONE.shown!);
    });

    /**
     * A failure is set apart on the failure's tint:
     * the class DBOS stored first, then its sentence,
     * and under it what to do about it. The code is
     * the main way on from a failure, so Open
     * function is the one primary Button.
     */
    for (const theme of THEMES_ALL) {
      test(`sets a failure apart and says the way out in ${theme}`, async ({
        page,
      }) => {
        await openInspector(
          page,
          onEvidence('find_slot', recording([THREW_IN_LIB])),
          theme,
        );

        const callout = face(page).locator('[data-evidence-field="error"]');
        await expect(callout).toHaveCount(1);
        await expect(callout).toHaveClass(/\bcallout\b/);
        await expect(callout).toHaveAttribute('data-tone', 'fail');

        const drawn = await callout.evaluate((box) => ({
          ground: getComputedStyle(box).backgroundColor,
          radius: getComputedStyle(box).borderTopLeftRadius,
          name: getComputedStyle(box.querySelector('.callout-title')!)
            .fontWeight,
          first:
            box.firstElementChild?.classList.contains('callout-title') ?? false,
        }));
        const tint = colourOf(theme, 'fail-tint');

        expect(
          sameColour(drawn.ground, tint),
          `${drawn.ground} ≠ ${tint}`,
        ).toBe(true);
        expect(drawn.radius).toBe('6px');
        expect(drawn.name).toBe('600');
        expect(drawn.first).toBe(true);

        await expect(callout.locator('.callout-title')).toHaveText(
          'StripeTimeoutError',
        );
        await expect(
          callout.locator('.callout-body [data-verbatim]'),
        ).toHaveText('Request timed out after 30 s');

        const wayOut = face(page).locator('[data-way-out]');
        await expect(wayOut).toHaveText(inspectorStrings.wayOut);
        expect(
          await callout.evaluate((box) =>
            box.nextElementSibling?.hasAttribute('data-way-out'),
          ),
        ).toBe(true);

        await expect(
          face(page).locator('[data-evidence-action="openFunction"]'),
        ).toHaveAttribute('data-variant', 'primary');
        await expect(
          face(page).locator('[data-evidence-action="replayFrom"]'),
        ).toHaveAttribute('data-variant', 'quiet');
      });
    }

    /**
     * The class DBOS threw first, then its sentence,
     * then the way out. A step that ran out of tries
     * says how many DBOS made — the tries it stored,
     * not the most it was allowed — in place of the
     * plain way out, and never lists them.
     */
    test('shows a failed step’s error, its class first', async ({ page }) => {
      const harness = await mountInspector(page);
      await harness.show(onEvidence('find_slot', recording([THREW])));

      const callout = face(page).locator('[data-evidence-field="error"]');
      const wayOut = face(page).locator('[data-way-out]');

      await expect(callout.locator('.callout-title')).toHaveText(
        'StripeTimeoutError',
      );
      await expect(callout.locator('.callout-body')).toHaveText(
        'Request timed out after 30 s',
      );
      await expect(wayOut).toHaveText(inspectorStrings.wayOut);

      await harness.show(onEvidence('find_slot', recording([EXHAUSTED])));

      await expect(wayOut).toHaveCount(1);
      await expect(wayOut).toHaveText(
        'DBOS tried 3 times · fix the function, then replay from here',
      );
      expect(
        await callout.evaluate((box) => {
          const after = box.nextElementSibling;

          return {
            hint: after?.classList.contains('field-hint'),
            next: after?.nextElementSibling?.classList.contains('field-hint'),
          };
        }),
      ).toEqual({ hint: true, next: false });
    });

    /**
     * And the way to the line it threw on is offered
     * only where the stack named a file in the
     * project's own `lib/`. Most stacks name the SDK
     * and the generated workflow and nothing else,
     * and a button that opened one of those would be
     * worse than no button. Where there is one, the
     * sentence under the ways on says the line is
     * the image's, not the folder's.
     */
    test('shows Open Error Location only when the step has a frame', async ({
      page,
    }) => {
      const harness = await mountInspector(page);
      await harness.show(onEvidence('find_slot', recording([THREW])));

      const door = page.locator('[data-evidence-action="openErrorLocation"]');
      const where = face(page).locator('[data-evidence-field="errorLocation"]');

      await expect(
        face(page).locator('[data-evidence-field="error"]'),
      ).toBeVisible();
      await expect(door).toHaveCount(0);
      await expect(where).toHaveCount(0);

      await harness.show(onEvidence('find_slot', recording([THREW_IN_LIB])));

      await expect(door).toHaveText(inspectorStrings.openErrorLocation);
      await expect(where.locator('.field-hint')).toHaveText(
        inspectorStrings.errorLocationFrom,
      );
      expect(
        await where.evaluate(
          (hint) =>
            (hint.previousElementSibling as HTMLElement | null)?.dataset
              .evidenceActions,
        ),
      ).toBe('');
    });

    /**
     * The block and the row together. A block that
     * ran more than once failed on one of those
     * tries, and each wrote a stack of its own.
     */
    test('asks for the line by block and row', async ({ page }) => {
      const shown = onEvidence('find_slot', recording([THREW_IN_LIB]));
      const harness = await openInspector(page, shown);

      await page.locator('[data-evidence-action="openErrorLocation"]').click();

      expect(await harness.postedOfType('openErrorLocation')).toEqual([
        {
          type: 'openErrorLocation',
          nodeId: 'find_slot',
          functionId: 3,
          about: about(shown),
        },
      ]);
    });

    /**
     * The ways on from a failed step, in the order
     * somebody reaches for them: the code, a second
     * run from here, the line it broke on, and the
     * agent.
     *
     * Every one of them carries the block, and the
     * two that start something carry the run as
     * well — a panel may be drawing a run the
     * extension has since moved past, and which run
     * is being asked about is not a question a face
     * gets to answer from memory.
     */
    test('offers the four ways on from a failed step', async ({ page }) => {
      const shown = onEvidence('find_slot', recording([THREW_IN_LIB]));
      const harness = await openInspector(page, shown);

      await expect(actions(page)).toHaveCount(4);
      expect(
        await actions(page).evaluateAll((drawn) =>
          drawn.map((one) => (one as HTMLElement).dataset.evidenceAction),
        ),
      ).toEqual([
        'openFunction',
        'replayFrom',
        'openErrorLocation',
        'askAgent',
      ]);
      await expect(actions(page)).toHaveText([
        inspectorStrings.openHandler,
        inspectorStrings.replayFrom,
        inspectorStrings.openErrorLocation,
        inspectorStrings.askAgent,
      ]);

      await page.locator('[data-evidence-action="openFunction"]').click();
      await page.locator('[data-evidence-action="replayFrom"]').click();
      await page.locator('[data-evidence-action="askAgent"]').click();

      expect(await harness.postedOfType('openFunction')).toEqual([
        { type: 'openFunction', nodeId: 'find_slot', about: about(shown) },
      ]);
      expect(await harness.postedOfType('replayFrom')).toEqual([
        { type: 'replayFrom', workflowId: 'wf_1', nodeId: 'find_slot' },
      ]);
      expect(await harness.postedOfType('askAgent')).toEqual([
        { type: 'askAgent', workflowId: 'wf_1', nodeId: 'find_slot' },
      ]);
    });

    /** The other three stay: only the line is
     *  conditional, and a step that broke somewhere
     *  nobody here wrote is still a step to replay
     *  or ask about. */
    test('keeps the other three ways on where there is no line', async ({
      page,
    }) => {
      await openInspector(page, onEvidence('find_slot', recording([THREW])));

      await expect(actions(page)).toHaveCount(3);
      expect(
        await actions(page).evaluateAll((drawn) =>
          drawn.map((one) => (one as HTMLElement).dataset.evidenceAction),
        ),
      ).toEqual(['openFunction', 'replayFrom', 'askAgent']);
    });

    /**
     * What the run was started with, its status
     * column, who ran it and which build are facts
     * about the whole run, and are drawn on the card
     * about the run. A step's face that repeated
     * them would be one more place a raw status
     * word or a full id turns up.
     */
    test('never shows the run’s own facts on a step', async ({ page }) => {
      const harness = await mountInspector(page);
      const uuid = '7089cd29-881b-4319-a16d-1af70cc1e9a7';
      const pane = page.locator('[data-inspector]');

      for (const step of [DONE, THREW, EXHAUSTED]) {
        await harness.show(
          onEvidence(
            'find_slot',
            recording([step], {
              workflowId: uuid,
              status: 'SUCCESS',
              executorId: 'executor-7f3a',
              applicationVersion: 'build-2291',
              input: '{ "requestId": "req_551" }',
            }),
          ),
        );

        await expect(face(page)).toHaveCount(1);

        const text = (await pane.textContent()) ?? '';

        expect(text).not.toContain('SUCCESS');
        expect(text).not.toContain(uuid);
        expect(text).not.toContain('executor');
        expect(text).not.toContain('build-2291');
        expect(text).not.toContain('application_version');
        expect(text).not.toContain('req_551');
        expect(text).not.toMatch(/attempt/i);
        await expect(page.locator('[data-workflow-input]')).toHaveCount(0);
      }
    });

    /**
     * A step offers its code, a replay from here and
     * the agent, and no way to the run — the run is
     * already open, and a door to where somebody is
     * standing is not an offer. On a step that
     * worked the code is a second choice, drawn in
     * outline; on one that failed it is the first.
     */
    test('offers what a step offers, and no Open run', async ({ page }) => {
      const harness = await openInspector(
        page,
        onEvidence('find_slot', recording([DONE])),
      );

      await expect(actions(page)).toHaveCount(3);
      await expect(actions(page)).toHaveText([
        inspectorStrings.openHandler,
        inspectorStrings.replayFrom,
        inspectorStrings.askAgent,
      ]);

      const open = face(page).locator('[data-evidence-action="openFunction"]');
      await expect(open).toHaveAttribute('data-variant', 'secondary');
      await expect(open).toHaveAttribute('data-ink', 'brand');
      for (const quiet of ['replayFrom', 'askAgent']) {
        await expect(
          face(page).locator(`[data-evidence-action="${quiet}"]`),
        ).toHaveAttribute('data-variant', 'quiet');
      }
      await expect(
        page.locator('[data-evidence-action="openRun"]'),
      ).toHaveCount(0);

      await harness.show(onEvidence('find_slot', recording([THREW])));

      await expect(actions(page)).toHaveCount(3);
      await expect(open).toHaveAttribute('data-variant', 'primary');
      await expect(
        page.locator('[data-evidence-action="openRun"]'),
      ).toHaveCount(0);
    });

    /**
     * Under everything, what the recorded result is
     * for: a recovery reads it back rather than
     * running the step again, and so does a replay
     * that starts after it. A replay from this step
     * runs it again, which is why the sentence says
     * "a later step".
     */
    test('ends with what the recorded result is for', async ({ page }) => {
      const harness = await openInspector(
        page,
        onEvidence('find_slot', recording([DONE])),
      );

      const footer = face(page).locator(
        '[data-evidence-field="recordedFooter"]',
      );
      await expect(footer).toHaveCount(1);
      await expect(footer).toHaveText(RECORDED_FOOTER);
      expect(await footer.evaluate((hint) => hint.nextElementSibling)).toBe(
        null,
      );
      await expect(footer).toHaveAttribute('data-mono', '');

      await harness.show(onEvidence('find_slot', recording([THREW])));
      await expect(face(page)).toHaveCount(1);
      await expect(footer).toHaveCount(0);
    });

    for (const [width, length, lines] of [
      [300, 20, 1],
      [300, 118, 2],
      [240, 118, 2],
    ] as const) {
      test(`fits ${length} characters in its chip at ${width}px`, async ({
        page,
      }) => {
        const harness = await mountInspector(page);
        await page.setViewportSize({ width, height: 700 });
        await harness.show(
          onEvidence('find_slot', recording([returning(length)])),
        );

        const chip = face(page).locator('[data-recorded] .inline-chip');
        await expect(chip).toHaveCount(1);

        if (lines === 1) {
          expect(await linesIn(chip)).toBe(1);
        } else {
          expect(await linesIn(chip)).toBeGreaterThanOrEqual(lines);
        }

        const drawn = await chip.evaluate((held) => ({
          radius: getComputedStyle(held).borderTopLeftRadius,
          space: getComputedStyle(held).whiteSpace,
          right: held.getBoundingClientRect().right,
          pane: window.innerWidth,
          scrolls:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        }));
        expect(drawn.radius).toBe('4px');
        expect(drawn.space).toBe('pre-wrap');
        expect(drawn.right).toBeLessThanOrEqual(drawn.pane - 14 + 0.5);
        expect(drawn.scrolls).toBe(false);
      });
    }

    /** Neither the kind nor the state breaks inside
     *  itself where the head runs out of room. */
    test('keeps the kind word and the state on one line each', async ({
      page,
    }) => {
      await openInspector(page, onEvidence('find_slot', recording([DONE])));

      await expect(status(page)).toHaveCount(1);
      for (const one of [page.locator('[data-inspector-kind]'), status(page)]) {
        expect(
          await one.evaluate((drawn) => getComputedStyle(drawn).whiteSpace),
        ).toBe('nowrap');
      }
    });

    /**
     * A result short enough to read is drawn whole,
     * and a longer one is named with its size and a
     * way to open all of it, JSON or not. Past the
     * limit a docked pane would be a page of one
     * value.
     */
    test('draws a short result inline, and a long one to open', async ({
      page,
    }) => {
      const harness = await mountInspector(page);
      const output = face(page).locator('[data-evidence-field="output"]');

      await harness.show(
        onEvidence('find_slot', recording([returning(INLINE_LIMIT)])),
      );

      await expect(output.locator('.state-word')).toHaveText(
        inspectorStrings.inline,
      );
      await expect(output.locator('.inline-chip')).toHaveCount(1);
      await expect(output.locator('.artifact-ref')).toHaveCount(0);

      const long = onEvidence(
        'find_slot',
        recording([returning(INLINE_LIMIT + 1)]),
      );
      await harness.show(long);

      await expect(output.locator('.state-word')).toHaveText(
        inspectorStrings.artifact,
      );
      await expect(output.locator('.inline-chip')).toHaveCount(0);
      await expect(output.locator('.artifact-size')).toHaveText('121 B');

      const preview = output.locator('.artifact-preview[data-verbatim]');
      await expect(preview).toHaveCount(1);
      expect(await linesIn(preview)).toBe(1);
      expect(
        await preview.evaluate((cut) => getComputedStyle(cut).textOverflow),
      ).toBe('ellipsis');

      const open = output.locator('[data-evidence-action="openOutput"]');
      await expect(open).toHaveText(inspectorStrings.openOutput);
      await expect(open).toHaveAttribute('data-variant', 'quiet');
      await expect(open).toHaveAttribute('data-ink', 'brand');

      await open.click();
      expect(await harness.postedOfType('openOutput')).toEqual([
        {
          type: 'openOutput',
          workflowId: 'wf_1',
          functionId: 3,
          about: about(long),
        },
      ]);

      await harness.show(
        onEvidence(
          'find_slot',
          recording([returned('y'.repeat(INLINE_LIMIT + 1))]),
        ),
      );

      await expect(output.locator('.artifact-ref')).toHaveCount(1);
      await expect(output.locator('.state-word')).toHaveText(
        inspectorStrings.artifact,
      );
    });

    for (const theme of THEMES_ALL) {
      test(`puts every label before its value in ${theme}`, async ({
        page,
      }) => {
        const harness = await openInspector(
          page,
          onEvidence('find_slot', recording([DONE])),
          theme,
        );

        const timed = face(page).locator('[data-property]');
        await expect(timed).toHaveCount(3);
        for (const row of await timed.all()) await labelBeforeValue(row);

        await harness.show(onEvidence('find_slot', recording(FANNED_OUT)));

        const parts = face(page).locator('[data-evidence-part]');
        await expect(parts).toHaveCount(3);
        for (const row of await parts.all()) await labelBeforeValue(row);
      });
    }

    /**
     * A block clicked on the graph is the block, not
     * one of its rows: it is headed by the row that
     * failed, the rows under it are listed, and a
     * replay from it names the block and leaves which
     * of its rows to start from to the host.
     */
    test('replays a fanned-out block, not a row, from a graph click', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        onEvidence('find_slot', recording(FANNED_OUT), { source: 'run' }),
      );

      expect(await said(page)).toBe('failed · #4');
      await expect(
        face(page).locator('[data-evidence-field="rows"] [data-evidence-part]'),
      ).toHaveCount(3);
      await expect(
        face(page).locator('[data-evidence-field="error"]'),
      ).toHaveCount(1);

      await page.locator('[data-evidence-action="replayFrom"]').click();

      expect(await harness.postedOfType('replayFrom')).toEqual([
        { type: 'replayFrom', workflowId: 'wf_1', nodeId: 'find_slot' },
      ]);
    });

    /**
     * A trigger writes no row: it compiles into how
     * the workflow is started. So its face says so,
     * and offers the whole run in its place. Its
     * state is worked out from the run existing, and
     * the head says that where a pointer or a screen
     * reader finds it. Once the pane is about the
     * run, focus is on the run's name.
     */
    test('says a trigger writes no row, and shows the run', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        onEvidence('booking_requested', runOf(IN_FLIGHT)),
      );

      await expect(status(page)).toHaveCount(1);
      expect(await said(page)).toBe(inspectorStrings.runStates.done);
      await expect(status(page)).toHaveAttribute('data-run-state', 'done');
      await expect(status(page)).toHaveAttribute('data-provenance', 'derived');
      await expect(status(page)).toHaveAccessibleDescription(
        inspectorStrings.triggerDerived,
      );

      const trigger = page.locator('[data-evidence="trigger"]');
      await expect(trigger.locator('.field-hint')).toHaveText(
        inspectorStrings.triggerNoRow,
      );
      await expect(page.locator('[data-evidence-action]')).toHaveCount(0);

      const show = trigger.locator('[data-inspect-run]');
      await expect(show).toHaveText(inspectorStrings.showRun);
      await expect(show).toHaveAttribute('data-variant', 'quiet');
      await expect(show).toHaveAttribute('data-ink', 'brand');

      await show.click();

      expect(await harness.postedOfType('inspectRun')).toEqual([
        { type: 'inspectRun' },
      ]);

      await harness.show(inspectorInit({ at: 'run', run: runLevel() }));

      await expect(
        page.locator('[data-inspector-header] .inspector-title'),
      ).toBeFocused();
    });

    /**
     * A block the run has not written a row for yet
     * is where the graph says it is, and nothing
     * more: no times, and nothing to replay from or
     * ask about.
     */
    test('says nothing it does not have for a block with no row yet', async ({
      page,
    }) => {
      await openInspector(page, onEvidence('twilio_chat', runOf(IN_FLIGHT)));

      await expect(face(page)).toHaveCount(1);
      await expect(
        page.locator('[data-inspector-header] [data-run-state="running"]'),
      ).toHaveCount(1);
      await expect(
        face(page).locator('[data-evidence-field="nothing"]'),
      ).toHaveText(inspectorStrings.nothingRecorded);
      for (const gone of ['started', 'completed', 'duration']) {
        await expect(
          face(page).locator(`[data-evidence-field="${gone}"]`),
        ).toHaveCount(0);
      }
      await expect(page.locator('[data-evidence-action]')).toHaveCount(0);
    });

    /**
     * What the face worked out rather than read says
     * so: the state of a block the run has written
     * nothing for, a row read back after a crash, a
     * row carried over from the run this one was
     * replayed from, and how often a loop went round.
     */
    test('says which states it worked out', async ({ page }) => {
      const harness = await openInspector(
        page,
        onEvidence('twilio_chat', runOf(IN_FLIGHT)),
      );

      await expect(status(page)).toHaveAttribute('data-provenance', 'derived');
      await expect(status(page)).toHaveAccessibleDescription(
        inspectorStrings.runningDerived,
      );

      /** A fact on the face, and the mark after it. */
      const fact = (field: string) =>
        face(page).locator(`[data-evidence-field="${field}"]`);
      const derived = `· ${inspectorStrings.derived}`;

      await harness.show(
        onEvidence(
          'find_slot',
          recording([liveStep({ ...DONE, restored: true, reused: true })]),
        ),
      );

      await expect(status(page)).not.toHaveAttribute('data-provenance');
      await expect(fact('restored')).toHaveText(
        `${inspectorStrings.restored} ${derived}`,
      );
      await expect(fact('reused')).toHaveText(
        `${inspectorStrings.reused} ${derived}`,
      );

      await harness.show(
        blockInit({
          ...blockSubject(
            'loop',
            { config: { minRounds: 1, maxRounds: 5, body: ['step'] } },
            'evidence',
            everyKind,
          ),
          run: recording([
            liveStep({ name: 'step.r1', nodeId: 'step', functionId: 0 }),
            liveStep({ name: 'step.r2', nodeId: 'step', functionId: 1 }),
          ]),
        }),
      );

      await expect(fact('rounds')).toHaveText(
        `${filled(inspectorStrings.roundsObserved, '2')} ${derived}`,
      );
      await expect(
        fact('rounds').locator('[data-provenance="derived"]'),
      ).toHaveText(derived);
    });

    /**
     * A worked-out fact wears a quiet lowercase word
     * after it, in the faint voice, rather than a
     * bordered chip in capitals: capitals are how
     * this system says what state something is in.
     */
    for (const theme of THEMES_ALL) {
      test(`marks a worked-out fact with a quiet word in ${theme}`, async ({
        page,
      }) => {
        await openInspector(
          page,
          onEvidence(
            'find_slot',
            recording([liveStep({ ...DONE, restored: true })]),
          ),
          theme,
        );

        const mark = face(page).locator(
          '[data-evidence-field="restored"] [data-provenance="derived"]',
        );
        await expect(mark).toHaveCount(1);

        const drawn = await mark.evaluate((word) => ({
          transform: getComputedStyle(word).textTransform,
          border: getComputedStyle(word).borderTopStyle,
          ink: getComputedStyle(word).color,
        }));
        const faint = colourOf(theme, 'ink-faint');

        expect(drawn.transform).toBe('none');
        expect(drawn.border).toBe('none');
        expect(sameColour(drawn.ink, faint), `${drawn.ink} ≠ ${faint}`).toBe(
          true,
        );
      });
    }
  });

  /**
   * A queue block's card, which is a different card
   * from every other block's.
   *
   * A queue block records no row of its own — the
   * work is its children's runs — so the card that
   * draws a block's rows would draw an empty one
   * here. What there is to say is how many children
   * are running, what the whole queue is doing, and
   * whether the app registered the queue the way
   * the document asks for it.
   */
  test.describe('what a run recorded about a queue block', () => {
    const INDEXED = {
      itemsPath: 'pages',
      queue: {
        name: 'document-index',
        globalConcurrency: 8,
        rateLimit: { limitPerPeriod: 5, periodSec: 10 },
      },
      enqueue: { deduplicationPath: 'documentId' },
    };

    /** The every-kind document with its queue block
     *  configured and its card on screen. */
    function queueCard(): BlockSubject {
      return queueSubject(INDEXED, [], 'evidence');
    }

    /** One reading on the card, found by what it is
     *  a reading of. */
    function reading(page: Page, field: string): Locator {
      return page.locator(
        `[data-evidence="queue"] [data-evidence-field="${field}"]`,
      );
    }

    test('draws a card of its own rather than a block’s rows', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3, queued: 12, delayed: 4, failed: 1 }),
        }),
      );

      await expect(page.locator('[data-evidence="queue"]')).toHaveCount(1);
      await expect(page.locator('[data-evidence="block"]')).toHaveCount(0);
    });

    /**
     * Half the card is this run and half is what
     * somebody wrote in the document, so every
     * reading ends in the word saying which: a limit
     * somebody typed, read as a figure a run
     * reached, is the mistake the card exists to
     * prevent.
     */
    test('says what this run’s items are doing, and where each figure came from', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3, queued: 12, delayed: 4, failed: 1 }),
        }),
      );

      const expected = [
        ['queue', 'document-index', 'configured'],
        ['active', '3 of 8 queue-wide', 'derived'],
        ['queued', '12 · 4 delayed', 'derived'],
        ['failed', '1', 'derived'],
        ['rateLimit', '5 per 10 s', 'configured'],
        ['globalConcurrency', '8', 'configured'],
      ] as const;

      for (const [field, value, kind] of expected) {
        const row = reading(page, field);
        const mark = `· ${inspectorStrings[kind]}`;

        await expect(row).toHaveAttribute('data-property', '');

        // The mark is inside the value's box, after
        // the figure; the room between the two is
        // drawn rather than typed.
        await expect(row.locator(':scope > .value')).toHaveText(
          `${value}${mark}`,
        );
        await expect(
          row.locator(`:scope > .value > [data-provenance="${kind}"]`),
        ).toHaveText(mark);
        await labelBeforeValue(row);
      }
    });

    /**
     * The pane is narrow and the labels wide, so a
     * figure and its word seldom fit on one line.
     * The figure keeps its words whole and the word
     * comes after the figure's last line, as it
     * would in a sentence; set side by side, the
     * word squeezed the figure a character wide.
     */
    test('keeps a figure whole, with its word after it', async ({ page }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun(
            { active: 3, queued: 12, delayed: 4, failed: 1 },
            queueEvidence(),
          ),
        }),
      );

      const laidOut = (field: string) =>
        reading(page, field)
          .locator(':scope > .value')
          .evaluate((value) => {
            const figure = document.createRange();
            figure.selectNodeContents(value.firstChild!);

            const tops = [...figure.getClientRects()].map((box) =>
              Math.round(box.top),
            );
            const mark = value.querySelector('[data-provenance]')!;

            return {
              lines: new Set(tops).size,
              last: Math.max(...tops),
              mark: Math.round(mark.getBoundingClientRect().top),
            };
          });

      await expect(reading(page, 'failed')).toHaveCount(1);

      expect((await laidOut('queue')).lines).toBe(1);

      const failed = await laidOut('failed');
      expect(failed.lines).toBeGreaterThan(1);
      expect(failed.mark).toBeGreaterThanOrEqual(failed.last - 1);

      const pane = await page
        .locator('[role="tabpanel"]')
        .evaluate((panel) => panel.scrollWidth - panel.clientWidth);
      expect(pane).toBeLessThanOrEqual(0);
    });

    /**
     * A quiet lowercase word in the faint voice, not
     * a bordered chip: capitals and an edge are how
     * this system marks a state or a control, and a
     * figure's provenance is neither.
     */
    for (const theme of THEMES_ALL) {
      test(`marks a figure’s source with a quiet word in ${theme}`, async ({
        page,
      }) => {
        await openInspector(
          page,
          blockInit({
            ...queueCard(),
            run: queuedRun({ active: 3 }),
          }),
          theme,
        );

        const marks = [
          ['queue', 'configured'],
          ['active', 'derived'],
          ['rateLimit', 'configured'],
        ] as const;
        const faint = colourOf(theme, 'ink-faint');

        for (const [field, kind] of marks) {
          const mark = reading(page, field).locator(
            `[data-provenance="${kind}"]`,
          );
          await expect(mark).toHaveCount(1);
          await expect(mark).toHaveText(`· ${inspectorStrings[kind]}`);

          const drawn = await mark.evaluate((word) => ({
            transform: getComputedStyle(word).textTransform,
            border: getComputedStyle(word).borderTopStyle,
            ink: getComputedStyle(word).color,
          }));

          expect(drawn.transform).toBe('none');
          expect(drawn.border).toBe('none');
          expect(
            sameColour(drawn.ink, faint),
            `${field}: ${drawn.ink} ≠ ${faint}`,
          ).toBe(true);
        }
      });
    }

    /**
     * The whole queue costs a read of its own, so
     * until one has been made the card says nothing
     * about it rather than saying zero.
     */
    test('says nothing about the whole queue until a read answers', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }),
        }),
      );

      await expect(
        page.locator('[data-evidence-field="observedStarts"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-evidence-field="registered"]'),
      ).toHaveCount(0);
    });

    test('asks for that read when the card is shown', async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }),
        }),
      );

      expect(await harness.postedOfType('inspectQueue')).toEqual([
        { type: 'inspectQueue', workflowId: 'wf_1', nodeId: 'queue' },
      ]);
    });

    test('draws what the read answered, said to be worked out', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3, failed: 1 }, queueEvidence()),
        }),
      );

      const derived = `· ${inspectorStrings.derived}`;

      await expect(reading(page, 'observedStarts')).toHaveAttribute(
        'data-property',
        '',
      );
      await expect(
        reading(page, 'observedStarts').locator('.value'),
      ).toHaveText(`74 in the last 60 s${derived}`);
      await expect(
        reading(page, 'observedStarts').locator('[data-provenance="derived"]'),
      ).toHaveText(derived);

      await expect(reading(page, 'registered').locator('.value')).toHaveText(
        `${inspectorStrings.queueMatches}${derived}`,
      );
      await expect(
        reading(page, 'registered').locator('[data-provenance="derived"]'),
      ).toHaveText(derived);

      // The window sees only the children still on
      // the queue, so its count of failures is the
      // errored ones and says so.
      await expect(reading(page, 'failed').locator('.value')).toHaveText(
        `1 · 2 errored queue-wide in the window${derived}`,
      );
    });

    /**
     * A rate limit is a registration, not a budget
     * anybody is spending down: the ledger records
     * what ran, never what it was allowed to run.
     * A card drawing `12/50 per 10 s` would be
     * claiming a number nothing measured, so the
     * shape itself is what is rejected here.
     */
    test('never draws a rate as a budget being spent', async ({ page }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }, queueEvidence()),
        }),
      );

      const said =
        (await page.locator('[data-evidence="queue"]').textContent()) ?? '';

      expect(said).not.toMatch(/\d+ ?\/ ?\d+ per/);
      expect(said).toContain(inspectorStrings.queueLocal);
    });

    test('says what the app registered where it is not what the document asks for', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun(
            { active: 3 },
            queueEvidence({
              registered: {
                registered: {
                  name: 'document-index',
                  globalConcurrency: 4,
                  minPollingIntervalMs: 1000,
                },
              },
            }),
          ),
        }),
      );

      await expect(reading(page, 'registered').locator('.value')).toHaveText(
        filled(
          inspectorStrings.queueDiffers,
          'global concurrency 4 · min polling interval 1000 ms',
        ) + `· ${inspectorStrings.derived}`,
      );
    });

    /**
     * An item is known by what the application
     * called it where it called it anything — the
     * partition it runs in, or the key it was
     * deduplicated on — and otherwise by its short
     * id, which is how every other run is named and
     * which carries the whole id with it, since four
     * characters collide.
     */
    test('names an item by its key, or by its short id', async ({ page }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }, queueEvidence()),
        }),
      );

      const keyed = page.locator('[data-queue-item="wf_child_1"]');
      const keyless = page.locator('[data-queue-item="wf_child_2"]');

      await expect(keyed).toHaveText('doc_7');
      await expect(keyed.locator('[data-short-run]')).toHaveCount(0);

      const short = keyless.locator('[data-short-run]');
      await expect(short).toHaveCount(1);
      await expect(short).toHaveText(shortRunId('wf_child_2'));
      await expect(short).toHaveAttribute('data-short-run', 'wf_child_2');
      await expect(short).toHaveAttribute('title', 'wf_child_2');

      // Both are quiet Buttons: a column of edged
      // controls would read as a toolbar.
      for (const item of [keyed, keyless]) {
        await expect(item).toHaveClass(/\bbtn\b/);
        await expect(item).toHaveAttribute('data-variant', 'quiet');
      }

      const said =
        (await page.locator('[data-evidence="queue"]').textContent()) ?? '';
      expect(said).not.toContain('wf_child_2');
    });

    /**
     * A partition key is whatever the application
     * made it, and can be longer than the pane is
     * wide. It wraps inside its own column rather
     * than pushing where the item got to, and when,
     * out of sight.
     */
    test('keeps a long item name beside where the item got to', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun(
            { active: 3 },
            queueEvidence({
              recent: [
                {
                  workflowId: 'wf_child_1',
                  label: 'tenant_acme_corporation_eu_west_2',
                  status: 'SUCCESS',
                  completedAt: RECORDED_AT,
                },
              ],
            }),
          ),
        }),
      );

      const line = page.locator('[data-evidence-field="recentWork"] li');
      await expect(line).toHaveCount(1);

      const laid = await line.evaluate((item) => {
        const name = item.querySelector('[data-queue-item]')!;
        const state = item.querySelector('.status-line')!;
        const panel = item.closest('[role="tabpanel"]')!;

        return {
          nameRight: name.getBoundingClientRect().right,
          stateLeft: state.getBoundingClientRect().left,
          stateRight: state.getBoundingClientRect().right,
          panelRight: panel.getBoundingClientRect().right,
          sideways: panel.scrollWidth - panel.clientWidth,
        };
      });

      expect(laid.nameRight).toBeLessThanOrEqual(laid.stateLeft);
      expect(laid.stateRight).toBeLessThanOrEqual(laid.panelRight);
      expect(laid.sideways).toBeLessThanOrEqual(0);
    });

    /**
     * DBOS's words are the ledger's, and a card that
     * printed `PENDING` beside one item would say a
     * different thing about the same run from every
     * other panel. A claimed item is running; one
     * still waiting for room, or out a delay, is
     * queued.
     */
    test('says where each item got to in the product’s words', async ({
      page,
    }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun(
            { active: 3 },
            queueEvidence({
              recent: [
                { workflowId: 'wf_child_1', label: 'doc_1', status: 'PENDING' },
                {
                  workflowId: 'wf_child_2',
                  status: 'SUCCESS',
                  completedAt: RECORDED_AT,
                },
                {
                  workflowId: 'wf_child_3',
                  label: 'doc_3',
                  status: 'ENQUEUED',
                },
                {
                  workflowId: 'wf_child_4',
                  label: 'doc_4',
                  status: 'ERROR',
                  completedAt: RECORDED_AT,
                },
              ],
            }),
          ),
        }),
      );

      const words = inspectorStrings.runOutcomes;
      const expected = [
        ['wf_child_1', 'running', words.running],
        ['wf_child_2', 'done', words.done],
        ['wf_child_3', 'queued', words.queued],
        ['wf_child_4', 'failed', words.failed],
      ] as const;

      const lines = page.locator('[data-evidence-field="recentWork"] li');
      await expect(lines).toHaveCount(expected.length);

      for (const [at, [id, state, word]] of expected.entries()) {
        const line = lines.nth(at);
        const status = line.locator('.status-line');

        await expect(line.locator('[data-queue-item]')).toHaveAttribute(
          'data-queue-item',
          id,
        );
        await expect(status).toHaveAttribute('data-run-state', state);
        await expect(status).toContainText(word);
        expect(word).toBe(word.toLowerCase());
      }

      // Only a finished item has a time to say.
      await expect(lines.nth(0).locator('[data-time="fine"]')).toHaveCount(0);
      await expect(lines.nth(1).locator('[data-time="fine"]')).toHaveCount(1);

      const said =
        (await page.locator('[data-evidence="queue"]').textContent()) ?? '';
      expect(said).not.toMatch(
        /\b(SUCCESS|ERROR|PENDING|ENQUEUED|DELAYED|CANCELLED)\b/,
      );
    });

    /** The Inspector is not the run page, so the way to
     *  a child is the way to any run: open it. */
    test('opens the run an item started', async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }, queueEvidence()),
        }),
      );

      await page.locator('[data-queue-item="wf_child_1"]').click();

      expect(await harness.postedOfType('openRun')).toEqual([
        { type: 'openRun', workflowId: 'wf_child_1' },
      ]);
    });

    /** Under everything, because every figure above
     *  it is one application's, read out of the one
     *  database this window can reach. */
    test('says last whose figures these are', async ({ page }) => {
      await openInspector(
        page,
        blockInit({
          ...queueCard(),
          run: queuedRun({ active: 3 }, queueEvidence()),
        }),
      );

      const local = page.locator(
        '[data-evidence="queue"] > [data-evidence-field="local"]',
      );

      await expect(local).toHaveCount(1);
      await expect(local).toHaveClass(/\bfield-hint\b/);
      await expect(local).toHaveText(inspectorStrings.queueLocal);
      await expect(
        page.locator('[data-evidence="queue"] > :last-child'),
      ).toHaveAttribute('data-evidence-field', 'local');
    });
  });

  /**
   * A block somebody picked on the run tab, drawn
   * against the run the tab is showing.
   *
   * The card is the one a canvas block gets, so what
   * a run recorded about a block reads the same
   * wherever somebody picked it, and every way on
   * from it names the tab's run.
   */
  test.describe('a block picked on the run tab', () => {
    /** The run tab's pick, on Run evidence: the
     *  block, the document it is in, the run and the
     *  row somebody picked, where they picked one. */
    function picked(
      nodeId: string,
      document: WorkflowIR,
      run: ShownRun | undefined,
      functionId?: number,
    ): InspectorInit {
      return blockInit({
        ...blockSubject(nodeId, {}, 'evidence', document),
        source: 'run',
        run,
        functionId,
      });
    }

    test('shows what the run recorded about the block that is picked', async ({
      page,
    }) => {
      await openInspector(
        page,
        picked('find_slot', GRAPH.ir, seeRun().live, 1),
      );

      await expect(page.locator('[data-evidence="block"]')).toHaveCount(1);

      const status = page.locator('[data-inspector-header] .status-line');
      await expect(status).toHaveAttribute('data-run-state', 'failed');
      await expect(status.locator('[data-function-id]')).toHaveText('#1');
    });

    /**
     * A queue block gets its card of its own, drawn
     * from the counts and from the one read a pick
     * costs. An item's run opens on the run tab,
     * because the Inspector is not a run page that
     * could show it in place.
     */
    test('shows a queue block’s card, and opens an item’s run', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        picked('index_pages', QUEUED_GRAPH.ir, {
          ...QUEUED,
          queueEvidence: { index_pages: QUEUE_READ },
        }),
      );

      const card = page.locator('[data-evidence="queue"]');
      const derived = `· ${inspectorStrings.derived}`;

      await expect(card).toHaveCount(1);
      await expect(
        card.locator('[data-evidence-field="queued"] .value'),
      ).toHaveText(`42${derived}`);
      await expect(
        card.locator(
          '[data-evidence-field="observedStarts"] [data-provenance="derived"]',
        ),
      ).toHaveText(derived);

      // Nothing names this item, so it goes by the
      // short id every other run goes by.
      const item = card.locator('[data-queue-item="wf_child_9f21"]');
      await expect(item.locator('[data-short-run]')).toHaveText(
        shortRunId('wf_child_9f21'),
      );

      await item.click();

      expect(await harness.postedOfType('openRun')).toEqual([
        { type: 'openRun', workflowId: 'wf_child_9f21' },
      ]);
      expect(await harness.postedOfType('runSelect')).toEqual([]);
      expect(await harness.postedOfType('inspectQueue')).toEqual([
        {
          type: 'inspectQueue',
          workflowId: 'wf_c9d2f3',
          nodeId: 'index_pages',
        },
      ]);
    });

    /**
     * The code the block runs and the agent, reached
     * from the face whichever surface the block was
     * picked on. A question about a row somebody
     * picked names the row, so the agent is told
     * which try it is being asked about.
     */
    test('reaches the code and the agent from a row picked there', async ({
      page,
    }) => {
      const shown = picked('find_slot', GRAPH.ir, seeRun().live, 1);
      const harness = await openInspector(page, shown);

      await page.locator('[data-evidence-action="openFunction"]').click();
      await page.locator('[data-evidence-action="askAgent"]').click();

      expect(await harness.postedOfType('openFunction')).toEqual([
        { type: 'openFunction', nodeId: 'find_slot', about: about(shown) },
      ]);
      expect(await harness.postedOfType('askAgent')).toEqual([
        {
          type: 'askAgent',
          workflowId: 'wf_c9d2f3',
          nodeId: 'find_slot',
          functionId: 1,
        },
      ]);
    });

    /** A replay of the run the tab is showing, from
     *  the block its graph had clicked. */
    test('replays the tab’s run from the block that is picked', async ({
      page,
    }) => {
      const harness = await openInspector(
        page,
        picked('find_slot', GRAPH.ir, seeRun().live),
      );

      await page.locator('[data-evidence-action="replayFrom"]').click();

      expect(await harness.postedOfType('replayFrom')).toEqual([
        { type: 'replayFrom', workflowId: 'wf_c9d2f3', nodeId: 'find_slot' },
      ]);
    });

    /**
     * A row picked in the trace is the row the face
     * draws, and the row a replay from here starts
     * from: the block travels beside it, so the host
     * can still answer about a pane that has moved
     * on.
     */
    test('replays from the row picked in the trace', async ({ page }) => {
      const harness = await openInspector(
        page,
        picked('find_slot', GRAPH.ir, recording([DONE]), 3),
      );

      await expect(
        page.locator('[data-inspector-header] [data-function-id]'),
      ).toHaveText('#3');

      const replay = page.locator('[data-evidence-action="replayFrom"]');

      await expect(replay).toHaveCount(1);
      await replay.click();

      expect(await harness.postedOfType('replayFrom')).toEqual([
        {
          type: 'replayFrom',
          workflowId: 'wf_1',
          nodeId: 'find_slot',
          functionId: 3,
        },
      ]);
    });
  });
});

/**
 * A field at rest and in use.
 *
 * A form is read far more often than it is typed
 * into, so a field spends nothing on a box until
 * somebody is in it: no edge, no ground, and one
 * ring while it has focus. A theme that draws
 * structure in lines keeps the edge at rest,
 * because there it is the only thing saying a field
 * is a field.
 *
 * Every row sets its label first, on the value's
 * line, and every control in a row answers to a
 * name.
 */
/**
 * How a block's form is grouped, and what sits at
 * its foot.
 *
 * A form is read in groups, each under a quiet label
 * saying what it holds: the function a block runs,
 * what an API call calls, how hard the block tries.
 * The rows in a group say nothing the label already
 * says, a number is kept apart from the unit it is
 * counted in, and the ways out of the form — to the
 * function's code, and to the agent — come last.
 */
test.describe('the groups a block is set in', () => {
  /** The labels over the groups on the page, in
   *  the order they are drawn. */
  function groupLabels(page: Page): Locator {
    return page.locator(
      '[role="tabpanel"] [data-control="section"] .section-label',
    );
  }

  /** Whether what a value holds sits side by side
   *  rather than wrapped under itself. */
  function oneRow(value: Locator): Promise<boolean> {
    return value.evaluate((node) => {
      const tallest = Math.max(
        ...[...node.children].map((one) => one.getBoundingClientRect().height),
      );

      return node.getBoundingClientRect().height <= tallest + 1;
    });
  }

  /** How many lines an element's text is set on. */
  function linesOf(element: Locator): Promise<number> {
    return element.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);

      return new Set(
        [...range.getClientRects()].map((box) => Math.round(box.top)),
      ).size;
    });
  }

  /**
   * The function behind a block already says what
   * it takes and what it gives back, on the row
   * that names it, so a block whose declarations
   * agree with it draws no rows repeating them. A
   * block with nothing behind it has no such row,
   * and its declarations are the only place those
   * types are said.
   */
  test('shows a function’s types in its row rather than as fields', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    const findSlot = manifest.functions.find((fn) => fn.export === 'findSlot')!;
    await expect(page.locator('[data-picker-current] .signature')).toHaveText(
      signatureOf(findSlot),
    );
    await expect(page.locator('[data-field="in"]')).toHaveCount(0);
    await expect(page.locator('[data-field="out"]')).toHaveCount(0);

    await harness.show(
      blockInit(blockSubject('find_slot', { handler: undefined })),
    );

    await expect(page.locator('[data-picker-current]')).toHaveAttribute(
      'data-state',
      'empty',
    );
    await expect(page.locator('[data-field="out"] .property-label')).toHaveText(
      word(inspectorStrings.fields, 'out'),
    );
    await expect(page.locator('[data-field="out"] input')).toHaveValue(
      'SlotGrid',
    );
    await expect(page.locator('[data-field="in"] input')).toHaveValue(
      'BookingReq',
    );
  });

  test('labels a block’s groups by what they hold', async ({ page }) => {
    const harness = await openInspector(page, blockInit(apiCallSubject()));
    const fields = inspectorStrings.fields;

    await expect(groupLabels(page)).toHaveText([
      word(fields, 'function'),
      word(fields, 'request'),
      `${word(fields, 'retryPolicy')} · ${inspectorStrings.configured}`,
    ]);

    // Worked out of the configuration rather than
    // read off a run, and said once for the whole
    // group rather than on every row in it.
    const mark = page.locator(
      '[data-field="retryPolicy"] .section-label ' +
        '[data-provenance="configured"]',
    );
    await expect(mark).toHaveText(`· ${inspectorStrings.configured}`);
    await expect(page.locator('[data-property] [data-provenance]')).toHaveCount(
      0,
    );

    // The function a group is named for is named by
    // that group, so the row carries no label of its
    // own.
    await expect(
      page.locator('[data-field="handler"] .property-label'),
    ).toHaveCount(0);
    await expect(page.locator('[data-field="handler"]')).toHaveAccessibleName(
      word(fields, 'function'),
    );

    const service = page.locator('[data-field="service"]');
    await expect(service.locator('.property-label')).toHaveText(
      word(fields, 'service'),
    );
    await expect(service.locator('input')).toHaveValue('Airtable');
    await expect(service.locator('input')).toHaveAttribute('data-mono', '');

    const retry = {
      retryMaxAttempts: ['5', undefined],
      retryIntervalSeconds: ['1', 's'],
      retryBackoffRate: ['2', '×'],
    } as const;

    for (const [id, [value, unit]] of Object.entries(retry)) {
      const row = page.locator(`[data-field="${id}"]`);

      await expect(row.locator('.property-label')).toHaveText(word(fields, id));
      await expect(row.locator('input')).toHaveValue(value);

      // The unit is drawn beside the box and read out
      // with it, and never typed into it: the value
      // stays a number.
      if (unit === undefined) {
        await expect(row.locator('.property-unit')).toHaveCount(0);
      } else {
        await expect(row.locator('.property-unit')).toHaveText(unit);
        await expect(row.locator('.property-unit')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
        await expect(row.locator('input')).toHaveAccessibleDescription(unit);

        // Beside the number, as "1 s" is written,
        // rather than at the far edge of the row.
        const [value, drawn] = await Promise.all([
          row.locator('.value').boundingBox(),
          row.locator('.property-unit').boundingBox(),
        ]);
        expect(drawn!.x - value!.x, id).toBeLessThan(48);
      }
    }

    // A label is one short noun, on one line, at a
    // pane's width and at a narrower one.
    for (const width of [300, 240]) {
      await page.setViewportSize({ width, height: 900 });

      const rows = page.locator('[role="tabpanel"] [data-property]');
      await expect(rows).toHaveCount(4);

      for (const row of await rows.all()) {
        expect(
          await linesOf(row.locator('.property-label')),
          `${width}px`,
        ).toBe(1);
        expect(await oneRow(row.locator('.value')), `${width}px`).toBe(true);
      }
    }

    // What a trigger starts on is its kind.
    await harness.show(blockInit(blockSubject('booking_requested')));

    await expect(
      page.locator('[data-field="mode"] .property-label'),
    ).toHaveText(word(fields, 'mode'));
    expect(word(fields, 'mode')).toBe('kind');
  });

  /**
   * One row of the ledger can cover every try DBOS
   * made at a step, which is worth saying where a
   * block is set to try more than once — after the
   * last of the rows that set it, and on this face
   * only, since the numbers are what it is about.
   */
  test('says what the duration covers after the retry rows, only when a step retries', async ({
    page,
  }) => {
    const harness = await openInspector(page, blockInit(apiCallSubject()));

    const hint = page.locator('[data-retry-hint]');
    await expect(hint).toHaveCount(1);
    await expect(hint).toHaveText(inspectorStrings.durationCoversTries);

    expect(
      await hint.evaluate(
        (node) =>
          node.previousElementSibling?.getAttribute('data-field') ?? null,
      ),
    ).toBe('retryBackoffRate');

    // What the host sends once a person has set it
    // to try once: the next revision.
    const once = apiCallSubject({
      retry: { maxAttempts: 1, intervalSeconds: 1, backoffRate: 2 },
    });
    const revision = once.ir.revision + 1;
    await harness.show(
      blockInit({ ...once, ir: { ...once.ir, revision }, revision }),
    );
    await expect(
      page.locator('[data-field="retryMaxAttempts"] input'),
    ).toHaveValue('1');
    await expect(page.locator('[data-retry-hint]')).toHaveCount(0);
    await expect(
      page.getByText(inspectorStrings.durationCoversTries),
    ).toHaveCount(0);

    await harness.show(
      blockInit({
        ...apiCallSubject({}, 'evidence'),
        run: recording([{ ...DONE, name: 'api_call', nodeId: 'api_call' }]),
      }),
    );
    await expect(
      page.locator('[data-evidence-field="retry"] [data-evidence-policy]'),
    ).toHaveCount(1);
    await expect(
      page.getByText(inspectorStrings.durationCoversTries),
    ).toHaveCount(0);
  });

  for (const theme of THEMES_ALL) {
    test(`offers the function and the agent from the foot of the form in ${theme}`, async ({
      page,
    }) => {
      const shown = blockInit(blockSubject('find_slot'));
      const harness = await openInspector(page, shown, theme);

      const actions = page.locator('[data-configure-actions]');
      await expect(actions).toHaveCount(1);
      await expect(actions.locator('.btn')).toHaveText([
        inspectorStrings.openHandler,
        inspectorStrings.askAgent,
      ]);

      // The last thing on the face.
      expect(
        await actions.evaluate(
          (row) =>
            row.parentElement?.getAttribute('role') === 'tabpanel' &&
            row.nextElementSibling === null,
        ),
      ).toBe(true);

      const open = actions.locator('[data-open-function]');
      await expect(open).toHaveAttribute('data-variant', 'secondary');
      await expect(open).toHaveAttribute('data-ink', 'brand');

      const drawn = await open.evaluate((button) => ({
        edge: getComputedStyle(button).borderTopColor,
        ink: getComputedStyle(button).color,
      }));
      const edge = colourOf(theme, 'hairline-strong');
      const ink = colourOf(theme, 'state-ink') || colourOf(theme, 'brand');
      expect(sameColour(drawn.edge, edge), `${drawn.edge} ≠ ${edge}`).toBe(
        true,
      );
      expect(sameColour(drawn.ink, ink), `${drawn.ink} ≠ ${ink}`).toBe(true);

      const ask = actions.locator('[data-ask-block]');
      await expect(ask).toHaveAttribute('data-variant', 'quiet');

      await open.click();
      await ask.click();

      expect(await harness.postedOfType('openFunction')).toEqual([
        { type: 'openFunction', nodeId: 'find_slot', about: about(shown) },
      ]);
      expect(await harness.postedOfType('askAboutBlock')).toEqual([
        {
          type: 'askAboutBlock',
          workflow: 'groom_booking',
          nodeId: 'find_slot',
        },
      ]);
    });

    test(`marks a group’s configured values with a quiet word in ${theme}`, async ({
      page,
    }) => {
      await openInspector(page, blockInit(apiCallSubject()), theme);

      const mark = page.locator(
        '[data-field="retryPolicy"] [data-provenance="configured"]',
      );
      await expect(mark).toHaveCount(1);

      const drawn = await mark.evaluate((word) => ({
        transform: getComputedStyle(word).textTransform,
        border: getComputedStyle(word).borderTopStyle,
        ink: getComputedStyle(word).color,
      }));
      const faint = colourOf(theme, 'ink-faint');

      expect(drawn.transform).toBe('none');
      expect(drawn.border).toBe('none');
      expect(sameColour(drawn.ink, faint), `${drawn.ink} ≠ ${faint}`).toBe(
        true,
      );
    });
  }

  /** A block nothing may be changed on still opens
   *  its code, and offers nothing that would start a
   *  conversation about changing it. */
  test('keeps only Open function on a block that cannot be edited', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit({
        ...blockSubject('find_slot'),
        source: 'run',
        revision: undefined,
        proposal: 'Preview — proposed by Claude · not applied yet',
        run: runOf(IN_FLIGHT),
      }),
    );

    const actions = page.locator('[data-configure-actions]');
    await expect(actions).toHaveCount(1);
    await expect(actions.locator('[data-open-function]')).toHaveCount(1);
    await expect(page.locator('[data-ask-block]')).toHaveCount(0);
    await expect(actions.locator('.btn')).toHaveCount(1);
  });

  /** A block with no function behind it has no code
   *  to open. */
  test('offers no Open function on a block with nothing behind it', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(blockSubject('find_slot', { handler: undefined })),
    );

    await expect(page.locator('[data-ask-block]')).toHaveCount(1);
    await expect(page.locator('[data-open-function]')).toHaveCount(0);
  });

  /**
   * A transaction's writes and DBOS's record that
   * it ran commit together, so it runs once and has
   * no policy to set. Said in the groups every
   * code-running block has, rather than in a box of
   * its own: the database it commits to, and the
   * retry policy it does not have.
   */
  test('says a transaction runs once, inside its own commit', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('record_booking')));
    const fields = inspectorStrings.fields;

    await expect(groupLabels(page)).toHaveText([
      word(fields, 'function'),
      word(fields, 'database'),
      word(fields, 'retryPolicy'),
    ]);

    await expect(
      page.locator('[data-field="handler"] [data-commit-hint]'),
    ).toHaveText(inspectorStrings.oneCommit);
    await expect(
      page.locator('[data-field="handler"] .field-hint'),
    ).toHaveCount(2);

    const database = page.locator('[data-database]');
    await expect(database.locator('.value')).toHaveText(
      inspectorStrings.database,
    );
    await expect(database.locator('input, select, textarea')).toHaveCount(0);
    expect(
      await database.evaluate(
        (row) => row.previousElementSibling?.getAttribute('data-field') ?? null,
      ),
    ).toBe('database');

    await expect(
      page.locator('[data-field="retryPolicy"] .field-hint'),
    ).toHaveText(inspectorStrings.retry);
    await expect(
      page.locator('[data-field="retryPolicy"] [data-provenance]'),
    ).toHaveCount(0);

    await expect(page.locator('[data-callout="transaction"]')).toHaveCount(0);
    await expect(page.locator('[data-field^="retry"] input')).toHaveCount(0);
  });
});

test.describe('a field at rest and in use', () => {
  /** The field a step's tries are counted in, found
   *  the way a screen reader finds it: by the label
   *  its row points at it. */
  function attempts(page: Page) {
    return page.getByRole('textbox', {
      name: word(inspectorStrings.fields, 'retryMaxAttempts'),
      exact: true,
    });
  }

  /** The same block at the revision after, carrying
   *  what was committed — what the host sends once
   *  the edit has landed. */
  function landed(maxAttempts: number) {
    const next = blockSubject('find_slot', {
      retry: { maxAttempts, intervalSeconds: 1, backoffRate: 2 },
    });
    const revision = next.ir.revision + 1;

    return blockInit({ ...next, ir: { ...next.ir, revision }, revision });
  }

  /** Marks every field on the page, so a spec can
   *  tell a form drawn afresh from one that stayed. */
  async function probe(page: Page): Promise<void> {
    await page
      .locator('[data-property] input')
      .first()
      .evaluate((input) => input.setAttribute('data-probe', ''));
  }

  /** Which lens the focused control belongs to. */
  function focusedField(page: Page): Promise<string | undefined> {
    return page.evaluate(
      () =>
        document.activeElement
          ?.closest('[data-field]')
          ?.getAttribute('data-field') ?? undefined,
    );
  }

  for (const theme of THEMES_ALL) {
    test(`leaves a field bare until it is used in ${theme}`, async ({
      page,
    }) => {
      await openInspector(page, blockInit(blockSubject('find_slot')), theme);

      const field = attempts(page);
      await expect(field).toHaveCount(1);

      const read = () =>
        field.evaluate((input) => {
          const style = getComputedStyle(input);

          return {
            edges: [
              style.borderTopColor,
              style.borderRightColor,
              style.borderBottomColor,
              style.borderLeftColor,
            ],
            ground: style.backgroundColor,
            ring: style.outlineColor,
            ringStyle: style.outlineStyle,
            ringWidth: style.outlineWidth,
            offset: style.outlineOffset,
          };
        });
      const edge = colourOf(theme, 'rest-border');

      const rest = await read();

      for (const one of rest.edges) {
        expect(sameColour(one, edge), `${one} ≠ ${edge}`).toBe(true);
      }
      expect(rest.ground).toBe('rgba(0, 0, 0, 0)');
      expect(rest.ringStyle).toBe('none');

      // Where the edge is the affordance, it has to
      // be seen against the pane it sits on.
      if (theme.startsWith('high-contrast')) {
        expect(
          contrast(edge, colourOf(theme, 'side-bar')),
        ).toBeGreaterThanOrEqual(3);
      }

      await field.focus();

      const focused = await read();
      const ring = colourOf(theme, 'focus-ring');

      expect(sameColour(focused.ring, ring), `${focused.ring}`).toBe(true);
      expect(focused.ringStyle).toBe('solid');
      expect(focused.ringWidth).toBe('1px');
      expect(focused.offset).toBe('-1px');

      // One ring: nothing under it changes colour.
      for (const one of focused.edges) {
        expect(sameColour(one, edge), `${one} ≠ ${edge}`).toBe(true);
      }
      expect(focused.ground).toBe('rgba(0, 0, 0, 0)');
    });

    /**
     * A word standing in for a value — what an empty
     * field would say — is set in the colour the
     * editor sets its own placeholders in, so even a
     * theme with one foreground keeps it apart from a
     * value somebody typed.
     */
    test(`sets a placeholder apart from a value in ${theme}`, async ({
      page,
    }) => {
      await openInspector(page, blockInit(blockSubject('find_slot')), theme);

      const field = attempts(page);
      await expect(field).toHaveCount(1);

      const value = await field.evaluate(
        (input) => getComputedStyle(input).color,
      );

      // A step's form draws no placeholder, so the
      // field is given one and emptied by hand, and
      // nothing is told: the page's own idea of the
      // value is left alone.
      await field.evaluate((input: HTMLInputElement) => {
        input.setAttribute('placeholder', '·');
        input.value = '';
      });
      const placeholder = await placeholderColour(page, field);
      const expected = colourOf(theme, 'input-placeholder');

      expect(
        sameColour(placeholder, expected),
        `${placeholder} ≠ ${expected}`,
      ).toBe(true);
      expect(sameColour(placeholder, value)).toBe(false);
    });

    /**
     * Asked of the forms the fixture's blocks really
     * have — a step, a branch, a transaction, a
     * trigger, an email and a queue — because a rule
     * held only on the form somebody thought to check
     * is a rule the other five are free to break.
     */
    test(`names every control and puts every label first in ${theme}`, async ({
      page,
    }) => {
      const harness = await mountInspector(page, theme);

      for (const block of [
        blockSubject('find_slot'),
        blockSubject('slot_open'),
        // Declaring a type its function does not
        // return, so the rows it declares are drawn
        // rather than left to the signature.
        blockSubject('record_booking', { out: 'Receipt' }),
        blockSubject('booking_requested'),
        blockSubject('send_confirmation'),
        queueSubject(INDEXING),
      ]) {
        await harness.show(blockInit(block));

        const rows = page.locator('[data-property]');
        await expect(rows.first()).toBeVisible();

        for (const row of await rows.all()) {
          await labelBeforeValue(row);
        }

        // Every control somebody can reach: the rest of
        // a limit nobody set is not drawn until a count
        // is typed, and has nothing to be called by
        // until then.
        const controls = await page
          .locator('[data-property] :is(input, select, textarea, button)')
          .filter({ visible: true })
          .all();

        expect(controls.length, block.nodeId).toBeGreaterThan(0);

        for (const control of controls) {
          await expect(control).toHaveAccessibleName(/\S/);
        }
      }
    });

    test(`spends no ground on a row at rest in ${theme}`, async ({ page }) => {
      const harness = await openInspector(
        page,
        blockInit(blockSubject('find_slot')),
        theme,
      );

      for (const block of [blockSubject('find_slot'), queueSubject(INDEXING)]) {
        await harness.show(blockInit(block));
        await expect(page.locator('[data-property]').first()).toBeVisible();

        const grounds = await page
          .locator('[data-property]')
          .evaluateAll((rows) =>
            rows.map((row) => getComputedStyle(row).backgroundColor),
          );

        expect(grounds.length).toBeGreaterThan(0);
        expect(new Set(grounds)).toEqual(new Set(['rgba(0, 0, 0, 0)']));
      }
    });
  }

  test('hides a menu’s chevron until the menu is used', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openInspector(page, blockInit(blockSubject('booking_requested')));

    const menu = page.locator('[data-field="mode"] select');
    const chevron = page.locator('[data-field="mode"] select + svg');

    await expect(menu).toHaveCount(1);
    await expect(chevron).toHaveAttribute('aria-hidden', 'true');
    await expect(chevron).toHaveCSS('opacity', '0');

    await menu.focus();

    await expect(chevron).toHaveCSS('opacity', '1');
  });

  /**
   * Hairlines separate rows; nothing boxes a group.
   * So a row draws its line above itself — the first
   * under a group's label too, which is what sets the
   * label off from what it names — and nothing that
   * follows a group's last row draws one, or the
   * group would read as closed.
   */
  test('rules a line above every row, the first in a group too', async ({
    page,
  }) => {
    await openInspector(page, blockInit(queueSubject(INDEXING)));
    await expect(page.locator('[data-property]').first()).toBeVisible();

    const read = await page.evaluate(() => {
      const width = (element: Element, side: 'Top' | 'Bottom') =>
        getComputedStyle(element)[`border${side}Width`];
      const sections = [
        ...document.querySelectorAll('[data-control="section"]'),
      ];

      return {
        rows: [...document.querySelectorAll('[data-property]')].map((row) => [
          width(row, 'Top'),
          width(row, 'Bottom'),
        ]),
        firstInGroup: sections
          .map((section) => section.nextElementSibling)
          .filter((next) => next?.matches('[data-property]') === true)
          .map((row) => width(row!, 'Top')),
        // A group's last row, or the sentence said
        // after it.
        afterGroup: sections
          .filter((section) =>
            section.previousElementSibling?.matches(
              '[data-property], .field-hint',
            ),
          )
          .map((section) => width(section, 'Top')),
        hints: [
          ...document.querySelectorAll('[role="tabpanel"] .field-hint'),
        ].map((hint) => width(hint, 'Top')),
      };
    });

    expect(read.rows.length).toBeGreaterThan(0);
    expect(new Set(read.rows.map(([top]) => top))).toEqual(new Set(['1px']));
    expect(new Set(read.rows.map(([, bottom]) => bottom))).toEqual(
      new Set(['0px']),
    );

    // The queue's registration, what each item is
    // enqueued with, and the retry policy.
    expect(read.firstInGroup).toEqual(['1px', '1px', '1px']);
    expect(read.afterGroup.length).toBeGreaterThanOrEqual(3);
    expect(new Set(read.afterGroup)).toEqual(new Set(['0px']));

    expect(read.hints.length).toBeGreaterThan(0);
    expect(new Set(read.hints)).toEqual(new Set(['0px']));
  });

  /**
   * A label is set a step under the value it names,
   * in a column of its own, so a person reads down
   * the values and across only to find out what one
   * is.
   */
  test('sets a label a step quieter than the value beside it', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    const row = page.locator('[data-property]').first();
    await expect(row).toHaveCount(1);

    await expect(row).toHaveCSS('padding', '7px 0px');
    await expect(row).toHaveCSS('column-gap', '12px');

    const label = await row
      .locator(':scope > .property-label')
      .evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          size: Number.parseFloat(style.fontSize),
          weight: style.fontWeight,
          colour: style.color,
        };
      });
    const muted = colourOf('light', 'ink-muted');

    expect(label.size).toBeCloseTo(11.05, 1);
    expect(label.weight).toBe('500');
    expect(sameColour(label.colour, muted), `${label.colour}`).toBe(true);
  });

  /**
   * Enter commits and leaves the person where they
   * were. The host answers with the next revision,
   * which draws the form afresh — and a form drawn
   * afresh that dropped focus would send the next
   * Tab back to the top of the pane.
   */
  test('keeps the field somebody was in after a commit comes back', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const field = attempts(page);

    await field.fill('5');
    await field.press('Enter');

    await expect(field).toBeFocused();
    expect(await harness.postedOfType('edit')).toHaveLength(1);

    await probe(page);
    await harness.show(landed(5));

    await expect(page.locator('[data-probe]')).toHaveCount(0);
    await expect(field).toHaveValue('5');
    expect(await focusedField(page)).toBe('retryMaxAttempts');
    expect(await harness.postedOfType('edit')).toHaveLength(1);
  });

  /** The block's name is drawn over the faces rather
   *  than among the fields, and a rename coming back
   *  hands focus back to it all the same. */
  test('keeps somebody in the block’s name after a rename comes back', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const title = page.locator('[data-inspector-heading]');

    await title.fill('Find a slot');
    await title.press('Enter');
    expect(await harness.postedOfType('edit')).toHaveLength(1);

    await title.evaluate((input) => input.setAttribute('data-probe', ''));

    const next = blockSubject('find_slot', { title: 'Find a slot' });
    const revision = next.ir.revision + 1;
    await harness.show(
      blockInit({ ...next, ir: { ...next.ir, revision }, revision }),
    );

    await expect(page.locator('[data-probe]')).toHaveCount(0);
    await expect(title).toHaveValue('Find a slot');
    await expect(title).toBeFocused();
  });

  /** A rename made before the host has answered an
   *  earlier edit carries that edit too: the name and
   *  the fields are one block somebody is setting. */
  test('renames a block without dropping what was set under its name', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    await attempts(page).fill('5');
    await attempts(page).press('Enter');

    const title = page.locator('[data-inspector-heading]');
    await title.fill('Find a slot');
    await title.press('Enter');

    const sent = await harness.postedOfType('edit');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      node: { title: 'Find a slot', retry: { maxAttempts: 5 } },
    });
  });

  /**
   * Leaving a field after Enter sends nothing more:
   * what was typed has already gone. Typed as a
   * number is not written back — `5.0` reads back
   * as `5` — so what the field shows and what the
   * document says differ, and only what was sent
   * tells the field it has nothing left to send.
   */
  /**
   * Until the host has answered, a field holds what
   * was typed in it as it was typed, even where the
   * document will write it back differently: the
   * answer is the next revision, which draws the
   * field afresh.
   */
  test('keeps what was typed in a field until the host answers', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const field = attempts(page);

    await field.fill('5.0');
    await field.press('Enter');

    expect(await harness.postedOfType('edit')).toHaveLength(1);
    await expect(field).toHaveValue('5.0');

    await harness.show(landed(5));

    await expect(field).toHaveValue('5');
  });

  test('sends one edit for a field left after Enter', async ({ page }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const field = attempts(page);

    await field.fill('5.0');
    await field.press('Enter');
    await field.press('Tab');

    await expect(field).not.toBeFocused();
    expect(await harness.postedOfType('edit')).toHaveLength(1);
  });

  /** A form drawn afresh hands focus back only to a
   *  field that had it. Somebody on a tab stays on
   *  the tab. */
  test('leaves focus on what somebody chose outside the form', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );
    const tab = page.locator('button[data-inspector-tab="configure"]');

    await probe(page);
    await tab.focus();
    await harness.show(landed(5));

    await expect(page.locator('[data-probe]')).toHaveCount(0);
    await expect(tab).toBeFocused();
  });

  /**
   * Nor to a form drawn later. Focus goes back only
   * to the form that replaced the one it was in, at
   * the moment it did: a field somebody was in
   * before the other face was shown is not where
   * they are once Configure comes back.
   */
  test('hands focus back only to the form drawn in its place', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await attempts(page).focus();
    await harness.show(
      blockInit({
        ...blockSubject('find_slot', {}, 'evidence'),
        run: runOf(IN_FLIGHT),
      }),
    );
    await expect(page.locator('[data-property] input')).toHaveCount(0);

    await harness.show(
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await expect(attempts(page)).toHaveCount(1);
    await expect(attempts(page)).not.toBeFocused();
  });

  /**
   * Nor to a pane somebody has left. An edit made on
   * the canvas draws this form afresh too, and a
   * field taking focus back then would pull the
   * person out of the frame they are typing in.
   */
  test('takes no focus back once somebody is in another frame', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    await attempts(page).focus();
    await probe(page);
    await page.evaluate(() => {
      document.hasFocus = () => false;
    });
    await harness.show(landed(3));

    await expect(page.locator('[data-probe]')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      'BODY',
    );
  });

  /**
   * A field holding several lines grows with what is
   * typed, so a short body is not a box of empty
   * lines and a long one does not push the rest of
   * the form out of the pane.
   */
  test('grows a field of several lines, as far as a limit', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('send_confirmation')));

    const body = page.getByRole('textbox', {
      name: word(inspectorStrings.fields, 'bodyMarkdown'),
      exact: true,
    });
    await expect(body).toHaveCount(1);

    const measure = () =>
      body.evaluate((area) => ({
        height: area.getBoundingClientRect().height,
        line: Number.parseFloat(getComputedStyle(area).lineHeight),
        overflows: area.scrollHeight > area.clientHeight,
      }));

    const short = await measure();
    expect(short.height).toBeGreaterThanOrEqual(3 * short.line);

    await body.fill(Array.from({ length: 30 }, (_, at) => `${at}`).join('\n'));

    const long = await measure();
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.height).toBeLessThan(13 * long.line);
    expect(long.overflows).toBe(true);
  });

  /** The function a block already runs is ringed,
   *  and the ring's pixel comes out of the padding,
   *  so the row is the size of every other. */
  test('pads an assigned function row the way the list does', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    const assigned = page.locator('[data-picker-current]');

    await expect(assigned).toHaveAttribute('data-state', 'assigned');
    await expect(assigned).toHaveCSS('padding', '7px 11px');
  });
});

/** What core says can sit behind that block, so
 *  an assertion cannot drift from the rule. */
function fitting(nodeId: string): string[] {
  const node = ir.nodes.find((one) => one.id === nodeId)!;

  return manifest.functions
    .filter((fn) => handlerFit(node, fn).fits)
    .map((fn) => fn.export);
}

/**
 * Which function a block runs, chosen from what the
 * project's code-behind actually offers.
 *
 * The list is the manifest put through one rule —
 * the same rule the drop target asks and the same
 * one validation reports — so what fits is offered
 * and what does not is counted and put away rather
 * than hidden: a function missing from a list with
 * no explanation is a bug report nobody can write.
 */
test.describe('the function picker', () => {
  /** The picker open over a block, the way a person
   *  opens it: by pressing the function it runs. */
  async function openPicker(page: Page, nodeId = 'slot_open') {
    const shown = blockInit(blockSubject(nodeId));
    const harness = await openInspector(page, shown);

    await page.locator('[data-picker-current]').click();
    await expect(page.locator('[data-picker-new]')).toBeVisible();

    return { ...harness, shown };
  }

  test('offers what fits, and counts what does not', async ({ page }) => {
    await openPicker(page);

    const fits = fitting('slot_open');
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.length).toBeLessThan(manifest.functions.length);

    await expect(page.locator('[data-picker-fn]')).toHaveText(
      fits.map((name) => new RegExp(`^${name}`)),
    );
    await expect(page.locator('[data-picker-hidden]')).toHaveText(
      `${manifest.functions.length - fits.length} incompatible functions hidden · show`,
    );
  });

  test('shows the rest, each with what is wrong with it', async ({ page }) => {
    await openPicker(page);

    await page.locator('[data-picker-hidden]').click();

    await expect(page.locator('[data-picker-fn]')).toHaveCount(
      manifest.functions.length,
    );
    await expect(
      page.locator('[data-picker-fn="parseRequest"] .lib-note'),
    ).toHaveText('returns BookingReq, decides nothing');
    await expect(
      page.locator('[data-picker-fn="autoApprove"] .lib-note'),
    ).toHaveText('takes ExpenseClaim, needs SlotGrid');

    await page.locator('[data-picker-hidden]').click();
    await expect(page.locator('[data-picker-fn]')).toHaveCount(
      fitting('slot_open').length,
    );
  });

  /**
   * The one reason a row is put away that is not
   * about its signature. A transaction's block puts
   * whatever its handler does inside the run's own
   * database transaction, so a handler that calls
   * another system is making a promise the block
   * cannot keep — and the repair is a step, not a
   * type. The row says which call and where, because
   * it is the only place a person is told before the
   * generated code runs.
   */
  test('puts away a transaction handler that dials out', async ({ page }) => {
    await openPicker(page, 'record_booking');

    expect(fitting('record_booking')).not.toContain('chargeCard');

    await page.locator('[data-picker-hidden]').click();

    await expect(
      page.locator('[data-picker-fn="chargeCard"] .lib-note'),
    ).toHaveText('calls fetch at line 12, needs a step');
  });

  test('assigns the row that was picked', async ({ page }) => {
    const harness = await openPicker(page);

    await page.locator('[data-picker-fn="tryAgain"]').click();

    expect(await harness.postedOfType('assign')).toEqual([
      {
        type: 'assign',
        baseRevision: ir.revision,
        nodeId: 'slot_open',
        export: 'tryAgain',
        about: about(harness.shown),
      },
    ]);
  });

  /**
   * The one row the manifest does not decide. A
   * person names a function before they write it —
   * which is exactly what the scaffolder writes the
   * stub for — so the picker cannot be manifest-only
   * without taking that path away.
   */
  test('takes a name for a function nobody has written', async ({ page }) => {
    const harness = await openPicker(page);

    await page.locator('[data-picker-new] button').click();

    const field = page.locator('[data-picker-new] input');
    await field.fill('decideLater');
    await field.press('Enter');

    expect(await harness.postedOfType('assign')).toEqual([
      {
        type: 'assign',
        baseRevision: ir.revision,
        nodeId: 'slot_open',
        export: 'decideLater',
        about: about(harness.shown),
      },
    ]);
  });

  test('puts the row back when the name is abandoned', async ({ page }) => {
    const harness = await openPicker(page);

    await page.locator('[data-picker-new] button').click();

    const field = page.locator('[data-picker-new] input');
    await field.fill('decideLater');
    await field.press('Escape');

    await expect(field).toHaveCount(0);
    await expect(page.locator('[data-picker-new]')).toHaveText(
      inspectorStrings.newFunction,
    );

    // And leaving the field is not a way to name one:
    // a name given by accident is a stub on disk.
    await page.locator('[data-picker-new] button').click();
    await field.fill('decideLater');
    await page.locator('[data-inspector-header]').click();

    await expect(field).toHaveCount(0);
    expect(await harness.postedOfType('assign')).toEqual([]);
  });

  test('says why there is nothing to pick from', async ({ page }) => {
    const harness = await mountInspector(page);
    await harness.show(
      blockInit({
        ...blockSubject('slot_open'),
        manifest: undefined,
      }),
    );

    await page.locator('[data-picker-current]').click();

    const empty = page.locator('[data-field="logic"] .empty-state');

    await expect(empty).toHaveCount(1);
    await expect(page.locator('[data-picker-fn]')).toHaveCount(0);
    await expect(empty.locator('.empty-title')).toHaveText(
      inspectorStrings.noLib,
    );
    await expect(empty.locator('.empty-detail')).toHaveCount(0);
    await expect(empty.locator('.btn')).toHaveCount(0);
    await expect(page.locator('[data-picker-new]')).toBeVisible();
  });

  /**
   * The kind whose relationship with its code is the
   * thing a person gets wrong: a branch owns none of
   * it.
   */
  test('says what a branch is', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('slot_open')));

    await expect(
      page.locator('[data-callout="branch"] .callout-title'),
    ).toHaveText(inspectorStrings.callouts.branch.title);
  });

  /**
   * A branch that runs a decision has no predicates
   * to edit — so its cases are read, not typed, and
   * they name where each outcome goes.
   */
  test('reads a decision’s outcomes rather than editing them', async ({
    page,
  }) => {
    const harness = await mountInspector(page);
    await harness.show(
      blockInit({
        ...blockSubject('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    await expect(page.locator('[data-outcome="true"]')).toContainText(
      'Book appointment',
    );
    await expect(page.locator('[data-field="cases"]')).toHaveCount(0);
  });

  /**
   * A decision can have a way out nobody has wired
   * yet, and the run stops there. Saying so is the
   * whole value of reading the outcomes back: a row
   * that quietly named nothing would look the same
   * as one leading somewhere.
   */
  test('says a way out nothing is wired to ends the run', async ({ page }) => {
    const branch = ir.nodes.find((one) => one.id === 'slot_open')!;
    if (branch.kind !== 'branch') throw new Error('slot_open is not a branch');

    // Seeded the way the host seeds them, so the
    // ports the outcomes are read through are the
    // ones a person would really have: the two the
    // branch is already wired by, and a third the
    // decision brought with it.
    const decided = withDecisionCases(branch, ['pay', 'refuse', 'hold']);
    const harness = await mountInspector(page);

    await harness.show(
      blockInit({
        ...blockSubject('slot_open', {
          ...decided,
          handler: { export: 'routeClaim' },
        }),
      }),
    );

    await expect(page.locator('[data-outcome="pay"]')).toContainText(
      'Book appointment',
    );
    await expect(page.locator('[data-outcome="refuse"]')).toContainText(
      'Twilio chat — you decide',
    );
    await expect(page.locator('[data-outcome="hold"]')).toHaveText(
      new RegExp(`${inspectorStrings.end}$`),
    );
  });

  /**
   * A block runs a function; a branch runs its
   * logic. Asserted on both sides, because a column
   * that drew one word for every kind would pass a
   * test that only ever looked at one of them.
   */
  test('calls it a function on a block and logic on a branch', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    await expect(
      page.locator('[data-field="function"] .section-label'),
    ).toHaveText('function');
    await expect(page.locator('[data-field="logic"]')).toHaveCount(0);

    await harness.show(
      blockInit({
        ...blockSubject('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    // No group over a branch's logic: the picker
    // names itself, and at rest it is one row.
    await expect(
      page.locator('[data-field="logic"] .property-label'),
    ).toHaveText('logic');
    await expect(page.locator('[data-field="function"]')).toHaveCount(0);
    await expect(page.locator('[data-picker-current]')).toHaveCount(1);
    await expect(page.locator('[data-field="handler"]')).toHaveCount(0);
  });

  /**
   * The row a block already runs is marked, and the
   * mark is a tick and a ring rather than a colour
   * alone — the column is read at a glance and a
   * tinted row is easy to miss against a tinted
   * panel.
   */
  test('marks the row the block already runs', async ({ page }) => {
    const harness = await mountInspector(page);
    await harness.show(
      blockInit({
        ...blockSubject('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    await page.locator('[data-picker-current]').click();

    const chosen = page.locator('[data-picker-fn="tryAgain"]');

    await expect(chosen).toHaveAttribute('data-state', 'assigned');

    // A border rather than an inset shadow, because
    // a theme that paints in forced colours drops
    // the shadow and keeps the border.
    const ring = await chosen.evaluate(
      (row) => getComputedStyle(row).borderTopColor,
    );
    const expected = colourOf('light', 'selection-ring');

    expect(sameColour(ring, expected), `${ring} ≠ ${expected}`).toBe(true);
    expect(
      await chosen.evaluate((row) => getComputedStyle(row, '::after').content),
    ).toBe('"✓"');
  });

  /**
   * A row that cannot sit behind the block says so
   * in words and is otherwise drawn like any other.
   * Dimming it would say the same thing a second
   * time, in the one language a person cannot read
   * — and the note is already there.
   */
  test('leaves an incompatible row undimmed, and lets it say why', async ({
    page,
  }) => {
    await openPicker(page);
    await page.locator('[data-picker-hidden]').click();

    const misfit = page.locator('[data-picker-fn="parseRequest"]');
    const fits = page.locator('[data-picker-fn="tryAgain"]');

    await expect(misfit.locator('.lib-note')).toHaveText(
      'returns BookingReq, decides nothing',
    );
    await expect(misfit).toHaveCSS('opacity', '1');
    await expect(misfit).toHaveCSS(
      'background-color',
      await fits.evaluate((row) => getComputedStyle(row).backgroundColor),
    );
  });

  test('offers the way back once the rest are shown', async ({ page }) => {
    await openPicker(page);

    const toggle = page.locator('[data-picker-hidden]');

    await toggle.click();
    await expect(toggle).toHaveText(inspectorStrings.hide);

    await toggle.click();
    await expect(toggle).toHaveText(
      `${manifest.functions.length - fitting('slot_open').length} incompatible functions hidden · show`,
    );
  });
});

/**
 * The function a block runs, before anybody asks
 * to change it.
 *
 * One row: the function, what it takes and gives
 * back, and what is wrong with it where something
 * is. What else could go there is a list that opens
 * from that row, because a pane that always showed
 * the list would spend most of itself on functions
 * the block does not run.
 */
test.describe('the function a block runs, at rest', () => {
  test('shows the function a block runs as one row until pressed', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    const current = page.locator('.lib-fn[data-picker-current]');

    await expect(current).toHaveCount(1);
    await expect(page.locator('[data-picker-current]')).toHaveCount(1);
    await expect(page.locator('[data-picker-fn]')).toHaveCount(0);
    await expect(page.locator('[data-picker-hidden]')).toHaveCount(0);
    await expect(page.locator('[data-picker-new]')).toHaveCount(0);

    await expect(current).toHaveAttribute('data-state', 'assigned');
    await expect(current.locator('.lib-name')).toHaveText('findSlot');
    await expect(current.locator('.signature')).toHaveCount(1);

    // A control that opens something, and says so.
    expect(await current.evaluate((row) => row.tagName)).toBe('BUTTON');
    await expect(current).toHaveAttribute('aria-expanded', 'false');
  });

  test('offers somewhere to put a function on a block that has none', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(blockSubject('find_slot', { handler: undefined })),
    );

    const current = page.locator('[data-picker-current]');

    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-state', 'empty');
    await expect(current).toHaveText(inspectorStrings.dropHere);
    await expect(current).toHaveCSS('border-top-style', 'dashed');
    expect(await current.evaluate((row) => row.tagName)).toBe('BUTTON');

    // The words carry their own ƒ; a mark in front
    // of them would stand for a function that is not
    // there.
    expect(
      await current.evaluate(
        (row) => getComputedStyle(row, '::before').content,
      ),
    ).toBe('none');
  });

  test('opens on a press and closes on Escape', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    const current = page.locator('[data-picker-current]');
    const offers = page.locator('[data-picker-fn]');
    const aside = page.locator('[data-picker-lib]');

    await expect(aside).toHaveCount(1);
    await current.click();

    await expect(offers.first()).toBeVisible();
    await expect(current).toHaveAttribute('aria-expanded', 'true');
    // The count it would give is the list's own
    // Button now.
    await expect(aside).toHaveCount(0);

    // From inside the list, which Escape takes off
    // the page along with the row that had focus.
    await offers.first().focus();
    await page.keyboard.press('Escape');

    await expect(offers).toHaveCount(0);
    await expect(current).toBeFocused();
    await expect(current).toHaveAttribute('aria-expanded', 'false');
    await expect(aside).toHaveCount(1);
  });

  /**
   * The host draws the pane afresh on every tick of
   * a run and every event on the canvas. A list
   * somebody opened is how they are reading the
   * block, so it stays open for the same block and
   * goes with a block they have left.
   */
  test('stays open for the same block, and closes for another', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('slot_open')),
    );
    const offers = page.locator('[data-picker-fn]');
    const toggle = page.locator('[data-picker-hidden]');

    await page.locator('[data-picker-current]').click();
    await toggle.click();
    await expect(offers).toHaveCount(manifest.functions.length);

    await harness.show(blockInit(blockSubject('slot_open')));

    await expect(offers).toHaveCount(manifest.functions.length);
    await expect(toggle).toHaveText(inspectorStrings.hide);

    await harness.show(blockInit(blockSubject('find_slot')));

    await expect(page.locator('[data-picker-current]')).toHaveCount(1);
    await expect(offers).toHaveCount(0);
    await expect(toggle).toHaveCount(0);
  });

  test('says at rest how many functions it hid', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('slot_open')));

    const hidden = manifest.functions.length - fitting('slot_open').length;
    expect(hidden).toBeGreaterThan(0);

    await expect(page.locator('[data-picker-lib]')).toHaveText(
      filled(inspectorStrings.libAtRest, String(hidden)),
    );
  });

  /**
   * Naming a function is how its stub gets written,
   * so starting a name is an action somebody takes
   * and leaving the box half-typed writes nothing.
   */
  test('names a new function in a box that leaving does not commit', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('slot_open')),
    );

    await page.locator('[data-picker-current]').click();

    const start = page.locator('[data-picker-new] .btn[data-variant="quiet"]');
    await expect(start).toHaveText(inspectorStrings.newFunction);

    await start.click();

    const naming = page.getByRole('textbox', {
      name: inspectorStrings.newFunction,
      exact: true,
    });
    await expect(naming).toBeFocused();

    await naming.fill('decideLater');
    await naming.blur();

    await expect(page.locator('[data-picker-new] input')).toHaveCount(0);
    expect(await harness.postedOfType('assign')).toEqual([]);
  });

  /**
   * Where the project's code has not been read, the
   * name is all anybody knows: no signature to show,
   * and no tick saying it was matched.
   */
  test('says the code has not been read where there is no manifest', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit({ ...blockSubject('find_slot'), manifest: undefined }),
    );

    const current = page.locator('[data-picker-current]');

    await expect(current).toHaveCount(1);
    await expect(page.locator('[data-picker-lib]')).toHaveText(
      inspectorStrings.libNotScanned,
    );
    await expect(current.locator('.lib-name')).toHaveText('findSlot');
    await expect(current.locator('.signature')).toHaveCount(0);
    await expect(current).not.toHaveAttribute('data-state', 'assigned');
    expect(
      await current.evaluate((row) => getComputedStyle(row, '::after').content),
    ).toBe('none');
  });

  test('says what is wrong with a function before it is pressed', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(
        blockSubject('slot_open', { handler: { export: 'parseRequest' } }),
      ),
    );

    await expect(page.locator('[data-picker-fn]')).toHaveCount(0);
    await expect(page.locator('[data-picker-current] .lib-note')).toHaveText(
      'returns BookingReq, decides nothing',
    );
  });
});

/**
 * A block picked on the run tab while an agent's
 * proposal is waiting on its document.
 *
 * The document on screen is the proposal's, which
 * nobody edits until it is approved or refused, so
 * there is no revision to edit against. The block
 * stays, because what it is set to is still worth
 * reading, and the first thing under the faces says
 * why nothing on it can be changed.
 */
test.describe('a block under a proposal, seen from the run tab', () => {
  const HEADLINE = 'Preview — proposed by Claude · not applied yet';

  function proposed(block: BlockSubject): InspectorInit {
    return blockInit({
      ...block,
      source: 'run',
      revision: undefined,
      proposal: HEADLINE,
      run: runOf(IN_FLIGHT),
    });
  }

  test('keeps the block, and says why it cannot be edited', async ({
    page,
  }) => {
    await openInspector(page, proposed(blockSubject('find_slot')));

    await expect(page.locator('[data-inspector-heading]')).toHaveValue(
      'Find open slot',
    );
    await expect(
      page.locator('[role="tabpanel"] .field-hint').first(),
    ).toHaveText(HEADLINE);
  });

  /** Asked of a step, a trigger, an email and a
   *  queue, which between them draw every kind of
   *  box the pane has. */
  test('lets nothing on it be typed into or chosen', async ({ page }) => {
    const harness = await mountInspector(page);
    const drawn = { input: 0, textarea: 0, select: 0 };

    for (const block of [
      blockSubject('find_slot'),
      blockSubject('booking_requested'),
      blockSubject('send_confirmation'),
      queueSubject(INDEXING),
    ]) {
      await harness.show(proposed(block));
      await expect(page.locator('[data-inspector-heading]')).toHaveCount(1);

      const read = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            [
              ':is([data-inspector-header], [role="tabpanel"])',
              ':is(input, textarea, select)',
            ].join(' '),
          ),
        ].map((box) => ({
          tag: box.tagName.toLowerCase() as 'input' | 'textarea' | 'select',
          locked:
            box.tagName === 'SELECT'
              ? (box as HTMLSelectElement).disabled
              : (box as HTMLInputElement).readOnly,
        })),
      );

      for (const box of read) {
        drawn[box.tag] += 1;
        expect(box, block.nodeId).toMatchObject({ locked: true });
      }
    }

    expect(drawn.input).toBeGreaterThan(4);
    expect(drawn.textarea).toBeGreaterThan(0);
    expect(drawn.select).toBeGreaterThan(0);
  });

  test('opens nothing, and says nothing back to the host', async ({ page }) => {
    const harness = await openInspector(
      page,
      proposed(blockSubject('find_slot')),
    );

    await page.locator('[data-picker-current]').click();
    await expect(page.locator('[data-picker-fn]')).toHaveCount(0);

    const title = page.locator('[data-inspector-heading]');
    await title.focus();
    await page.keyboard.type('Another name');
    await page.keyboard.press('Enter');
    await title.blur();

    await expect(title).toHaveValue('Find open slot');

    const said = (await harness.posted()).map(
      (message) => (message as { type: string }).type,
    );
    expect(said).not.toContain('edit');
    expect(said).not.toContain('assign');
  });

  /** A fold is how somebody reads the form, not a
   *  change to it, so it still answers. */
  test('still folds and unfolds a group', async ({ page }) => {
    await openInspector(page, proposed(queueSubject(INDEXING)));

    const fold = page.locator('[data-field="advanced"] .section-head');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');

    await fold.click();

    await expect(fold).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('a trigger block', () => {
  const MANUAL: TriggerConfig = { mode: 'manual' };

  /** The canonical document's own trigger. */
  const EVENT: TriggerConfig = {
    mode: 'event',
    topic: 'booking.requested',
    idempotencyKeyPath: 'requestId',
    requesterEmailPath: 'customer.email',
  };

  const WEEKLY: TriggerConfig = {
    mode: 'schedule',
    cron: '30 9 * * 1',
    timezone: 'Europe/London',
    start: '2026-09-01T00:00:00Z',
    ends: '2026-12-31T00:00:00Z',
  };

  /** Where the Runs view's input is reflected. */
  function sample(page: Page): Locator {
    return page.locator('[role="tabpanel"] [data-run-sample]');
  }

  /** The row of ways out at the foot of the form. */
  function actions(page: Page): Locator {
    return page.locator('[data-configure-actions]');
  }

  /** The value a row says, by the hook it carries. */
  function workflowRow(page: Page): Locator {
    return page.locator('[data-property][data-workflow] .value');
  }

  test('owns no function, no tries and nothing it takes', async ({ page }) => {
    await openInspector(page, blockInit(triggerSubject(EVENT)));

    // The rows a trigger does have, so the absences
    // below are read off a drawn form.
    await expect(page.locator('[data-field="mode"]')).toHaveCount(1);
    await expect(page.locator('[data-field="out"]')).toHaveCount(1);

    await expect(page.locator('.lib-fn')).toHaveCount(0);
    await expect(page.locator('[data-field="handler"]')).toHaveCount(0);
    await expect(page.locator('[data-field^="retry"]')).toHaveCount(0);
    await expect(page.locator('[data-field="in"]')).toHaveCount(0);
    await expect(page.locator('[data-open-function]')).toHaveCount(0);

    const hint = page.locator('[data-owns-no-function]');
    await expect(hint).toHaveText(inspectorStrings.triggerOwnsNoFunction);
    expect(inspectorStrings.triggerOwnsNoFunction).toBe(
      'a Trigger owns no ƒ — it names the workflow and its input type · ' +
        'DBOS starts the workflow with that input',
    );
  });

  test('says how it starts first, in words and in the machine face', async ({
    page,
  }) => {
    await openInspector(page, blockInit(triggerSubject(MANUAL)));
    const { fields, fieldsByKind, options } = inspectorStrings;

    await expect(
      page.locator('[data-field="startsOn"] .section-label'),
    ).toHaveText(inspectorStrings.startsOn);
    expect(inspectorStrings.startsOn).toBe('starts on');

    // Kind, then the workflow it starts, then the
    // type of what it starts that workflow with.
    const rows = page.locator('[role="tabpanel"] [data-property]');
    await expect(rows).toHaveCount(3);
    await expect(rows.locator('.property-label')).toHaveText([
      word(fields, 'mode'),
      inspectorStrings.workflow,
      word(fieldsByKind.trigger!, 'out'),
    ]);
    expect(word(fields, 'mode')).toBe('kind');
    expect(inspectorStrings.workflow).toBe('workflow');

    const kind = page.locator('[data-field="mode"] select');
    await expect(kind).toHaveAttribute('data-mono', '');
    await expect(kind.locator('option')).toHaveText([
      word(options, 'mode.manual'),
      word(options, 'mode.event'),
      word(options, 'mode.schedule'),
    ]);
    expect(
      await kind
        .locator('option')
        .evaluateAll((all) =>
          all.map((one) => (one as HTMLOptionElement).value),
        ),
    ).toEqual(['manual', 'event', 'schedule']);
    expect([
      options['mode.manual'],
      options['mode.event'],
      options['mode.schedule'],
    ]).toEqual(['on request', 'on event', 'on a schedule']);
  });

  test('names the saved workflow, and the type its input is', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(
        triggerSubject(EVENT, {
          selectedWorkflow: 'booking_intake',
          saved: { name: 'booking_intake', mode: 'event' },
        }),
      ),
    );

    await expect(workflowRow(page)).toHaveText('booking_intake');
    await expect(workflowRow(page)).toHaveAttribute('data-mono', '');
    await expect(page.locator('[data-workflow] input')).toHaveCount(0);

    await expect(page.locator('[data-field="out"] input')).toHaveValue(
      'WebhookEvent',
    );

    // A file the Runs view has not saved is named
    // by what the document calls itself.
    await harness.show(blockInit(triggerSubject(EVENT, { saved: undefined })));

    await expect(workflowRow(page)).toHaveText('groom_booking');
  });

  /**
   * The workflow is read, and the rows either side
   * of it are fields, whose text sits inside their
   * padding and edge. So its name starts where their
   * text does, and the values read down one edge.
   * Below the form, the sentence saying a schedule
   * starts the workflow stands where the sample it
   * replaces would, as far off the form.
   */
  test('reads its values down one edge, fields and the workflow alike', async ({
    page,
  }) => {
    const harness = await openInspector(page, blockInit(triggerSubject(EVENT)));

    const textStart = (selector: string) =>
      page.locator(selector).evaluate((drawn) => {
        const style = getComputedStyle(drawn);

        return (
          drawn.getBoundingClientRect().left +
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.borderLeftWidth)
        );
      });

    const workflow = await textStart('[data-workflow] .value');
    expect(workflow).toBeCloseTo(
      await textStart('[data-field="mode"] select'),
      0,
    );
    expect(workflow).toBeCloseTo(
      await textStart('[data-field="out"] input'),
      0,
    );

    const offForm = async (selector: string) => {
      const [form, below] = await Promise.all([
        page.locator('.configure').boundingBox(),
        page.locator(selector).boundingBox(),
      ]);
      const top = await page
        .locator(selector)
        .evaluate((drawn) =>
          Number.parseFloat(getComputedStyle(drawn).paddingTop),
        );

      return below!.y + top - (form!.y + form!.height);
    };

    const sampled = await offForm('[data-run-sample]');

    await harness.show(blockInit(triggerSubject(WEEKLY)));
    await expect(page.locator('[data-on-schedule]')).toHaveCount(1);

    expect(await offForm('[data-on-schedule]')).toBeCloseTo(sampled, 0);
  });

  test('labels the two payload paths by what they pick out', async ({
    page,
  }) => {
    await openInspector(page, blockInit(triggerSubject(EVENT)));
    const { fields } = inspectorStrings;

    await expect(
      page.locator('[data-field="idempotencyKeyPath"] .property-label'),
    ).toHaveText(word(fields, 'idempotencyKeyPath'));
    await expect(
      page.locator('[data-field="requesterEmailPath"] .property-label'),
    ).toHaveText(word(fields, 'requesterEmailPath'));
    expect([fields.idempotencyKeyPath, fields.requesterEmailPath]).toEqual([
      'idempotency',
      'requester',
    ]);
  });

  /** "Path" is said in the box, where a unit would
   *  be said beside one, so the label stays a
   *  single noun. */
  test('says in an empty path box that a path goes there', async ({ page }) => {
    await openInspector(
      page,
      blockInit(triggerSubject({ mode: 'event', topic: 'booking.requested' })),
    );
    const { placeholders } = inspectorStrings;

    for (const id of ['idempotencyKeyPath', 'requesterEmailPath']) {
      const box = page.locator(`[data-field="${id}"] input`);
      await expect(box).toHaveValue('');
      await expect(box).toHaveAttribute('placeholder', word(placeholders, id));
    }
    expect(placeholders.idempotencyKeyPath).toBe('payload path');
    await expect(page.locator('[data-field="topic"] input')).toHaveCount(1);
    await expect(
      page.locator('[data-field="topic"] input[placeholder]'),
    ).toHaveCount(0);
  });

  test('reflects the Runs view’s input as it changes, read-only', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(triggerSubject(EVENT, { text: '{"bookingId":7}' })),
    );

    await expect(page.locator('[data-run-sample] .section-label')).toHaveText(
      inspectorStrings.sampleInput,
    );
    expect(inspectorStrings.sampleInput).toBe('input · sample for Run');

    const value = sample(page).locator('[data-recorded] [data-verbatim]');
    await expect(value).toHaveText(inlineJson({ bookingId: 7 }));
    await expect(sample(page).locator('.inline-value')).toHaveCount(1);

    await harness.show(
      blockInit(triggerSubject(EVENT, { text: '{"bookingId":8}' })),
    );

    await expect(value).toHaveText(inlineJson({ bookingId: 8 }));
    await expect(
      sample(page).locator('input, textarea, select, [contenteditable]'),
    ).toHaveCount(0);
  });

  test('says Run sends nothing from an empty box', async ({ page }) => {
    const harness = await mountInspector(page);

    for (const text of ['', '  \n\t']) {
      await harness.show(blockInit(triggerSubject(MANUAL, { text })));

      const empty = sample(page).locator('[data-no-input]');
      await expect(empty).toHaveText(inspectorStrings.noInputRun);
      await expect(sample(page).locator('[data-recorded]')).toHaveCount(0);
      await expect(sample(page).locator('.inline-value')).toHaveCount(0);
      await expect(sample(page).locator('.artifact-ref')).toHaveCount(0);
    }
    expect(inspectorStrings.noInputRun).toBe('no input · Run sends none');
  });

  test('draws non-JSON text as typed, and says Run will refuse it', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(triggerSubject(MANUAL, { text: '{ bookingId:' })),
    );

    await expect(
      sample(page).locator('[data-recorded] [data-verbatim]'),
    ).toHaveText('{ bookingId:');

    const refused = sample(page).locator('[data-not-json]');
    await expect(refused).toHaveText(inspectorStrings.notJsonYet);
    await expect(refused).toHaveAttribute('data-tone', 'warn');
    expect(inspectorStrings.notJsonYet).toBe(
      'not JSON yet · Run will refuse it',
    );

    await harness.show(
      blockInit(triggerSubject(MANUAL, { text: '{ "bookingId": 7 }' })),
    );

    await expect(sample(page).locator('[data-recorded]')).toHaveCount(1);
    await expect(sample(page).locator('[data-not-json]')).toHaveCount(0);
  });

  test('says when the Runs view is set to another workflow', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(
        triggerSubject(MANUAL, {
          text: '{}',
          selectedWorkflow: 'refund_approval',
        }),
      ),
    );

    const elsewhere = sample(page).locator('[data-other-workflow]');
    await expect(elsewhere).toHaveText(
      filled(
        inspectorStrings.localRunsSetTo,
        'refund_approval',
        'groom_booking',
      ),
    );
    await expect(elsewhere).toHaveAttribute('data-tone', 'warn');
    await expect(elsewhere).toHaveText(
      'Local runs is set to refund_approval · ' +
        'Run with this input switches it to groom_booking',
    );

    // Set to this workflow, or to none at all, there
    // is nothing for a run to switch.
    for (const selectedWorkflow of ['groom_booking', undefined]) {
      await harness.show(
        blockInit(triggerSubject(MANUAL, { text: '{}', selectedWorkflow })),
      );

      await expect(sample(page).locator('[data-recorded]')).toHaveCount(1);
      await expect(sample(page).locator('[data-other-workflow]')).toHaveCount(
        0,
      );
    }
  });

  test('says why the last start of this workflow was refused', async ({
    page,
  }) => {
    const detail = 'The app did not answer on :3000. Start the stack.';
    const problem = { detail, rebuildToRun: false };
    const harness = await openInspector(
      page,
      blockInit(triggerSubject(MANUAL, { text: '{}', problem })),
    );

    const refused = sample(page).locator('[data-run-problem]');
    await expect(refused).toHaveText(detail);
    await expect(refused).toHaveAttribute('data-tone', 'fail');

    // A refusal is about the workflow the Runs view
    // is set to, which is not always this one.
    await harness.show(
      blockInit(
        triggerSubject(MANUAL, {
          text: '{}',
          problem,
          selectedWorkflow: 'refund_approval',
        }),
      ),
    );

    await expect(sample(page).locator('[data-other-workflow]')).toHaveCount(1);
    await expect(sample(page).locator('[data-run-problem]')).toHaveCount(0);
  });

  test('opens a long input where it can be read', async ({ page }) => {
    const long = JSON.stringify({ note: 'x'.repeat(110) });
    expect(inlineJson(JSON.parse(long)).length).toBeGreaterThan(INLINE_LIMIT);

    const harness = await openInspector(
      page,
      blockInit(triggerSubject(MANUAL, { text: long })),
    );

    const artifact = sample(page).locator('[data-recorded] .artifact-ref');
    await expect(artifact).toHaveCount(1);
    await expect(artifact.locator('.artifact-size')).toHaveText(
      filled(inspectorStrings.sizes.bytes, String(long.length)),
    );
    await expect(sample(page).locator('.inline-value')).toHaveCount(0);

    await artifact.locator('[data-open-run-input]').click();

    expect(await harness.postedOfType('openRunInput')).toEqual([
      { type: 'openRunInput' },
    ]);

    // One short of the limit stays whole.
    const short = JSON.stringify({ note: 'x'.repeat(106) });
    expect(inlineJson(JSON.parse(short)).length).toBe(INLINE_LIMIT);

    await harness.show(blockInit(triggerSubject(MANUAL, { text: short })));

    await expect(sample(page).locator('.inline-value')).toHaveCount(1);
    await expect(sample(page).locator('.artifact-ref')).toHaveCount(0);
  });

  test('says the input is for Run alone, never part of the workflow', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(triggerSubject(MANUAL, { text: '{"bookingId":7}' })),
    );

    const alone = sample(page).locator('[data-used-by-run]');
    await expect(alone).toHaveText(
      'used by Run only · not part of the saved workflow',
    );
    await expect(alone).toHaveText(inspectorStrings.usedByRunOnly);

    // There is one way to run a workflow from here,
    // and nothing on the pane or in its words names
    // another.
    const said = await page.locator('body').textContent();
    expect(said).toContain(inspectorStrings.usedByRunOnly);
    expect(said).not.toMatch(/debug/i);
    expect(JSON.stringify(inspectorStrings)).not.toMatch(/debug run/i);
  });

  test('starts its workflow with the Runs input, and nothing else', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(
        triggerSubject(MANUAL, {
          text: '{"bookingId":7}',
          selectedWorkflow: 'booking_intake',
          saved: { name: 'booking_intake', mode: 'manual' },
        }),
      ),
    );

    await expect(actions(page).locator(':scope > *')).toHaveCount(2);

    const run = actions(page).locator(':scope > [data-run-trigger]');
    await expect(run).toHaveText(inspectorStrings.runWithInput);
    expect(inspectorStrings.runWithInput).toBe('Run with this input');
    await expect(run).toHaveAttribute('data-variant', 'secondary');
    await expect(run).toHaveAttribute('data-ink', 'brand');

    const ask = actions(page).locator(':scope > [data-ask-block]');
    await expect(ask).toHaveAttribute('data-variant', 'quiet');
    expect(
      await actions(page)
        .locator(':scope > *')
        .evaluateAll((all) => all.map((one) => Object.keys(one.dataset))),
    ).toEqual([
      expect.arrayContaining(['runTrigger']),
      expect.arrayContaining(['askBlock']),
    ]);

    await run.click();
    await ask.click();

    expect(await harness.postedOfType('runTrigger')).toEqual([
      { type: 'runTrigger', workflow: 'booking_intake' },
    ]);
    expect(await harness.postedOfType('askAboutBlock')).toEqual([
      {
        type: 'askAboutBlock',
        workflow: 'groom_booking',
        nodeId: 'booking_requested',
      },
    ]);
  });

  test('leaves a scheduled trigger to its schedule', async ({ page }) => {
    const harness = await mountInspector(page);

    for (const block of [
      // Saved on a schedule, and nothing unsaved.
      triggerSubject(WEEKLY, { text: '{"n":1}' }),
      // Switched to one and not saved yet: what the
      // saved file will do once it is.
      triggerSubject(WEEKLY, {
        text: '{"n":1}',
        saved: { name: 'groom_booking', mode: 'manual' },
        unsaved: true,
      }),
    ]) {
      await harness.show(blockInit(block));

      const scheduled = page.locator('[data-on-schedule]');
      await expect(scheduled).toHaveText(inspectorStrings.runsOnSchedule);
      expect(inspectorStrings.runsOnSchedule).toBe('runs on its schedule');

      await expect(sample(page)).toHaveCount(0);
      await expect(page.locator('[data-recorded]')).toHaveCount(0);
      await expect(page.locator('[data-used-by-run]')).toHaveCount(0);
      expect(await page.locator('body').textContent()).not.toContain(
        inspectorStrings.usedByRunOnly,
      );
      await expect(page.locator('[data-run-trigger]')).toHaveCount(0);
      await expect(page.locator('[data-run-refused]')).toHaveCount(0);
      await expect(actions(page).locator(':scope > *')).toHaveCount(1);
      await expect(
        actions(page).locator(':scope > [data-ask-block]'),
      ).toHaveCount(1);
    }
  });

  test('asks for a save before a run the canvas does not show', async ({
    page,
  }) => {
    const harness = await mountInspector(page);
    const save = inspectorStrings.saveToRun;
    expect(save).toBe('save the workflow to run it');

    for (const [why, block] of [
      [
        'switched off a saved schedule',
        triggerSubject(MANUAL, {
          saved: { name: 'groom_booking', mode: 'schedule' },
          unsaved: true,
        }),
      ],
      // A file written on a schedule behind a buffer
      // that has not read it back yet.
      [
        'saved on a schedule the canvas is not showing',
        triggerSubject(MANUAL, {
          saved: { name: 'groom_booking', mode: 'schedule' },
        }),
      ],
      ['changed and not saved', triggerSubject(MANUAL, { unsaved: true })],
      ['never saved', triggerSubject(MANUAL, { saved: undefined })],
      // Unsaved is said first: saving is what gives
      // the file its topic.
      [
        'changed, over a file with no topic',
        triggerSubject(
          { mode: 'event', topic: '' },
          { saved: undefined, needsTopic: true, unsaved: true },
        ),
      ],
    ] as const) {
      await harness.show(blockInit(block));

      await expect(sample(page), why).toHaveCount(1);
      await expect(page.locator('[data-run-trigger]'), why).toHaveCount(0);

      const refused = actions(page).locator(':scope > [data-run-refused]');
      await expect(refused, why).toHaveText(save);
      await expect(actions(page).locator('[data-ask-block]'), why).toHaveCount(
        1,
      );
    }

    // Named by what the document calls itself.
    await expect(workflowRow(page)).toHaveText('groom_booking');
  });

  test('says a saved event trigger needs a topic before it can run', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(
        triggerSubject(
          { mode: 'event', topic: '' },
          { saved: undefined, needsTopic: true },
        ),
      ),
    );

    await expect(page.locator('[data-run-trigger]')).toHaveCount(0);
    await expect(
      actions(page).locator(':scope > [data-run-refused]'),
    ).toHaveText(inspectorStrings.needsTopic);
    expect(inspectorStrings.needsTopic).toBe(
      'the trigger needs a topic to run',
    );
  });

  /**
   * A run executes the project's own code, so a
   * window nobody has trusted starts none — and the
   * card says so where the Run would be rather than
   * offering a press that goes nowhere. Asking the
   * agent about the block reads nothing of the
   * project, so it stays.
   */
  test('says a run waits on trust in a restricted window', async ({ page }) => {
    await openInspector(
      page,
      blockInit(
        triggerSubject(MANUAL, {
          text: '{"bookingId":7}',
          saved: { name: 'groom_booking', mode: 'manual' },
          trusted: false,
        }),
      ),
    );

    await expect(page.locator('[data-run-trigger]')).toHaveCount(0);
    await expect(
      actions(page).locator(':scope > [data-run-refused]'),
    ).toHaveText(inspectorStrings.untrusted);
    await expect(
      actions(page).locator(':scope > [data-ask-block]'),
    ).toHaveCount(1);
  });

  test('offers nothing to do while an agent’s proposal holds it', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(
        triggerSubject(
          MANUAL,
          { text: '{"bookingId":7}' },
          {
            source: 'run',
            revision: undefined,
            proposal: 'Preview — proposed by Claude · not applied yet',
            run: runOf(IN_FLIGHT),
          },
        ),
      ),
    );

    await expect(page.locator('[data-proposal]')).toHaveCount(1);
    await expect(page.locator('[data-field="mode"] select')).toBeDisabled();

    await expect(page.locator('[data-run-trigger]')).toHaveCount(0);
    await expect(page.locator('[data-ask-block]')).toHaveCount(0);
    await expect(page.locator('[data-run-refused]')).toHaveCount(0);
    await expect(actions(page)).toHaveCount(0);
  });

  /**
   * The input is the Runs view's, so nothing a person
   * does to the trigger's own fields may carry it
   * into the document. Two edits, the second made
   * once the first has come back as the next
   * revision, the way the host answers one.
   */
  test('keeps the Runs input out of every edit it sends', async ({ page }) => {
    const SENTINEL = 'SENTINEL-7f3a';
    const at = triggerSubject(EVENT, { text: SENTINEL });
    const harness = await openInspector(page, blockInit(at));

    await expect(sample(page).locator('[data-verbatim]')).toHaveText(SENTINEL);

    const type = page.locator('[data-field="out"] input');
    await type.fill('BookingRequest');
    await type.press('Enter');

    await expect
      .poll(async () => (await harness.postedOfType('edit')).length)
      .toBe(1);

    const next = triggerSubject(EVENT, { text: SENTINEL });
    const revision = next.ir.revision + 1;
    const landed = {
      ...next,
      ir: {
        ...next.ir,
        revision,
        nodes: next.ir.nodes.map((one) =>
          one.id === 'booking_requested'
            ? { ...one, out: 'BookingRequest' }
            : one,
        ),
      },
      revision,
    };
    await page
      .locator('[data-field="topic"] input')
      .evaluate((box) => box.setAttribute('data-probe', ''));
    await harness.show(blockInit(landed));
    await expect(page.locator('[data-probe]')).toHaveCount(0);

    const topic = page.locator('[data-field="topic"] input');
    await topic.fill('booking.created');
    await topic.press('Enter');

    const edits = async () => harness.postedOfType('edit');
    await expect.poll(async () => (await edits()).length).toBe(2);
    expect((await edits()).map((edit) => edit.baseRevision)).toEqual([
      at.revision,
      revision,
    ]);

    expect(JSON.stringify(await harness.posted())).not.toContain(SENTINEL);
  });

  test('heads a trigger with its derived state on Configure too', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit(triggerSubject(EVENT, {}, { run: runOf(IN_FLIGHT) })),
    );

    await expect(page.locator('[data-field="mode"]')).toHaveCount(1);

    const status = page.locator('[data-inspector-header] .status-line');
    await expect(status).toHaveCount(1);
    await expect(status).toHaveAttribute('data-run-state', 'done');
    await expect(status).toHaveAttribute('data-provenance', 'derived');
    await expect(status.locator('.status-glyph')).toHaveText('✓');
    await expect(status).toHaveText(`✓${inspectorStrings.runStates.done}`);
    await expect(status).toHaveAccessibleDescription(/derived/);
  });

  test('fits every label on one line in the column every block uses', async ({
    page,
  }) => {
    const harness = await mountInspector(page);

    for (const config of [
      MANUAL,
      EVENT,
      { mode: 'event', topic: 'booking.requested' } as const,
      WEEKLY,
    ]) {
      await harness.show(blockInit(triggerSubject(config)));

      const rows = page.locator('[role="tabpanel"] [data-property]');
      await expect(rows.first()).toBeVisible();
      const drawn = await rows.all();
      expect(drawn.length, config.mode).toBeGreaterThanOrEqual(3);

      for (const row of drawn) {
        const label = row.locator('.property-label');
        const said = await label.textContent();

        expect(
          await row.evaluate(
            (one) => getComputedStyle(one).gridTemplateColumns,
          ),
          said ?? '',
        ).toMatch(/^76px /);
        expect(await linesIn(label), said ?? '').toBe(1);
      }
    }

    // The schedule's own rows are all there to be
    // measured.
    await expect(
      page.locator('[role="tabpanel"] [data-property] .property-label'),
    ).toHaveText([
      'kind',
      'workflow',
      'input type',
      'repeat',
      'on',
      'at',
      'timezone',
      'starts',
      'ends',
    ]);
  });
});
