import { expect, test, type Locator, type Page } from '@playwright/test';

import { handlerFit, withDecisionCases } from '../../src/core/rules.js';
import { filled } from '../../src/webview/fill.js';
import type { BlockSubject } from '../../src/webview/protocol.js';

import {
  DEDUPLICATES,
  DONE,
  EXHAUSTED,
  INDEXING,
  IN_FLIGHT,
  MARK,
  NO_PARTITION_KEY,
  PARTITIONED,
  THREW,
  THREW_IN_LIB,
  blockInit,
  blockSubject,
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
  word,
} from './fixtures/canvas.js';
import { THEMES_ALL } from './harness.js';
import { labelBeforeValue } from './labels.js';
import { colourOf, contrast, sameColour } from './palette.js';
import { inspectorWords as inspectorStrings } from './words.js';

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

/** The pane with nothing to inspect, with the
 *  canvas file when a canvas is in front. */
function nothing(file: string | undefined) {
  return inspectorInit({ at: 'none', file });
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
 * The one place a block's config is set, and what
 * a run recorded about it: whichever block was last
 * selected on the canvas in front, in a pane of its
 * own beside every canvas rather than a column
 * inside each one.
 */
test.describe('a block in the Inspector', () => {
  /** The pane's half of a click on the canvas: the
   *  host sends the block that was clicked. */
  test('names the block that was clicked', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('reply_decision')));

    await expect(page.locator('[data-inspector-heading]')).toHaveText(
      `${inspectorStrings.heading} · Branch`,
    );
    await expect(page.locator('[data-field="title"] input')).toHaveValue(
      'Reply?',
    );
  });

  /**
   * A block with no revision to edit against is one
   * nobody may edit, so its fields are not drawn at
   * all rather than drawn to refuse every change.
   */
  test('draws no fields for a block that cannot be edited', async ({
    page,
  }) => {
    await openInspector(
      page,
      blockInit({ ...blockSubject('find_slot'), revision: undefined }),
    );

    const column = page.locator('.inspector');
    await expect(column).toHaveCount(1);

    await expect(column.locator('.state')).toHaveText(
      inspectorStrings.nothingSelected,
    );
    await expect(page.locator('[data-field]')).toHaveCount(0);
  });

  /**
   * A pane is usually shorter than a block's form,
   * so the form scrolls under the header rather than
   * being cut off at the bottom of the pane.
   */
  test('scrolls a long form under its header', async ({ page }) => {
    const harness = await mountInspector(page);
    await page.setViewportSize({ width: 300, height: 320 });
    await harness.show(blockInit(queueSubject(INDEXING)));

    const column = page.locator('.inspector');
    await expect(column).toHaveCount(1);

    const header = (await page
      .locator('[data-inspector-header]')
      .boundingBox())!;
    const sized = await column.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      overflows: element.scrollHeight > element.clientHeight,
      pane: window.innerHeight,
    }));

    expect(sized.overflows).toBe(true);
    expect(sized.top).toBeGreaterThanOrEqual(header.y + header.height);
    expect(sized.bottom).toBeLessThanOrEqual(sized.pane);

    const last = page.locator('[data-field="enqueuePolicy"] .section-head');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test('offers a field per thing the kind carries', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('reply_decision')));

    await expect(page.locator('[data-field="elsePort"] input')).toHaveValue(
      'stop',
    );
    await expect(page.locator('[data-field="cases"] .row')).toHaveCount(2);
  });

  test('sends an edit once the field is finished with', async ({ page }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    const title = page.locator('[data-field="title"] input');

    await title.fill('Find an open slot');
    expect(await harness.postedOfType('edit')).toEqual([]);

    await title.press('Enter');

    const sent = await harness.postedOfType('edit');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      baseRevision: ir.revision,
      node: { id: 'find_slot', title: 'Find an open slot' },
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
   * And the one kind that has none says why, rather
   * than leaving the row out and reading as a kind
   * whose fields somebody forgot.
   */
  test('tells a transaction it runs once inside its commit', async ({
    page,
  }) => {
    await openInspector(page, blockInit(blockSubject('record_booking')));

    const retry = page.locator('[data-field="retry"]');

    await expect(retry.locator('.property-label')).toHaveText(
      inspectorStrings.retryPolicy,
    );
    await expect(retry.locator('.value')).toHaveText(inspectorStrings.retry);
    await expect(page.locator('[data-field="retryMaxAttempts"]')).toHaveCount(
      0,
    );
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
    test('come as groups, the last of them folded away', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      await expect(
        page.locator('[data-control="section"] .section-head'),
      ).toHaveText([
        `${MARK}${word(inspectorStrings.fields, 'queuePolicy')}`,
        `${MARK}${word(inspectorStrings.fields, 'enqueuePolicy')}`,
        `${MARK}${word(inspectorStrings.fields, 'advanced')}`,
      ]);

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

      const revised = queueSubject({
        ...partitioned,
        queue: {
          ...partitioned.queue,
          partitionRateLimit: { limitPerPeriod: 30, periodSec: 60 },
        },
      });
      await harness.show(
        blockInit({
          ...revised,
          ir: { ...revised.ir, revision: revised.ir.revision + 1 },
          revision: revised.ir.revision + 1,
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
     * What each group needs saying about it, which
     * is not a fact about any one field in it: which
     * process a limit holds back, and which two
     * settings the app refuses together.
     */
    test('say under each header what its fields do not', async ({ page }) => {
      await openInspector(page, blockInit(queueSubject(INDEXING)));

      await expect(
        page.locator('[data-field="queuePolicy"] .field-note'),
      ).toHaveText(word(inspectorStrings.hints, 'queuePolicy'));
      await expect(
        page.locator('[data-field="enqueuePolicy"] .field-note'),
      ).toHaveText(word(inspectorStrings.hints, 'enqueuePolicy'));
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

      await expect(mark).toHaveCSS('transform', 'matrix(0, -1, 1, 0, 0, 0)');

      await head.click();

      await expect(head).toHaveAttribute('aria-expanded', 'true');
      await expect(mark).toHaveCSS('transform', 'none');
      await expect(
        page.locator('[data-field="onConflict"] select'),
      ).toHaveCount(1);

      await head.click();

      await expect(page.locator('[data-field="onConflict"]')).toHaveCount(0);

      // And a group folded from the top takes its
      // own fields with it and nobody else's.
      await page.locator('[data-field="queuePolicy"] .section-head').click();

      await expect(page.locator('[data-field="queueName"]')).toHaveCount(0);
      await expect(
        page.locator('[data-field="queuePolicy"] .section-head'),
      ).toBeVisible();
      await expect(page.locator('[data-field="itemsPath"] input')).toHaveValue(
        'pages',
      );
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
     * `worker concurrency / partition` in the column
     * every other form is set in is four stacked
     * fragments beside a one-line box.
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
  });

  /**
   * The column asks two questions about one block —
   * what it should do, and what a run recorded about
   * it doing that — and never both at once. Two
   * faces rather than one long form.
   */
  test('offers two faces', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('find_slot')));

    await expect(page.locator('[data-inspector-mode]')).toHaveAttribute(
      'data-inspector-mode',
      'configure',
    );
    await expect(page.locator('button[data-inspector-tab]')).toHaveText([
      inspectorStrings.tabs.configure,
      inspectorStrings.tabs.evidence,
    ]);
    await expect(
      page.locator('button[data-inspector-tab="configure"]'),
    ).toHaveAttribute('aria-selected', 'true');
  });

  /** With no run there is nothing recorded to read,
   *  and the face says what would give it
   *  something. */
  test('disables Run Evidence with no run and says why', async ({ page }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    await expect(
      page.locator('button[data-inspector-tab="evidence"]'),
    ).toBeDisabled();
    await expect(page.locator('.inspector .hint')).toHaveText(
      inspectorStrings.noRun,
    );

    await harness.show(
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await expect(
      page.locator('button[data-inspector-tab="evidence"]'),
    ).toBeEnabled();
    await expect(page.locator('.inspector .hint')).toHaveCount(0);
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

    const harness = await openInspector(page, blockInit(onRunTab('find_slot')));

    await expect(configure).toBeEnabled();
    await expect(page.locator('.inspector > .hint')).toHaveCount(0);

    await harness.show(blockInit(onRunTab('deleted_block')));

    await expect(configure).toBeDisabled();
    await expect(page.locator('.inspector > .hint')).toHaveText(
      inspectorStrings.notInWorkflow,
    );
  });

  /** Two faces, not one long form: a field somebody
   *  may change never sits beside a fact they may
   *  not. */
  test('shows a block’s fields on Configure only', async ({ page }) => {
    const harness = await mountInspector(page);

    await harness.show(
      blockInit({ ...blockSubject('find_slot'), run: runOf(IN_FLIGHT) }),
    );

    await expect(page.locator('[data-field="title"]')).toHaveCount(1);

    await harness.show(
      blockInit({
        ...blockSubject('find_slot', {}, 'evidence'),
        run: runOf(IN_FLIGHT),
      }),
    );

    await expect(page.locator('[data-field]')).toHaveCount(0);
  });

  /**
   * And the face is the host's to hold. A panel is
   * torn down whenever it is hidden, so a tab a
   * person chose survives only where the selection
   * does.
   */
  test('posts the face a person picked', async ({ page }) => {
    const harness = await mountInspector(page);

    await harness.show(
      blockInit({
        ...blockSubject('find_slot', {}, 'evidence'),
        run: runOf(IN_FLIGHT),
      }),
    );

    await page.locator('button[data-inspector-tab="configure"]').click();

    expect(await harness.postedOfType('inspectorMode')).toEqual([
      { type: 'inspectorMode', mode: 'configure' },
    ]);
  });

  /**
   * The other face: what a run recorded about the
   * block on screen.
   *
   * Everything on it was read off the ledger and can
   * be edited by nobody. DBOS records no per-step
   * input and no count of the tries a step made, so
   * the first thing asked of the card is that it
   * invents neither.
   */
  test.describe('what a run recorded about a block', () => {
    test('never puts an attempt count or an INPUT section on a step card', async ({
      page,
    }) => {
      const harness = await mountInspector(page);
      const card = page.locator('[data-evidence="block"]');

      for (const step of [DONE, THREW, EXHAUSTED]) {
        await harness.show(
          blockInit({
            ...blockSubject('find_slot', {}, 'evidence'),
            run: recording([step]),
          }),
        );

        await expect(card).toHaveCount(1);

        const said = (await card.textContent()) ?? '';

        expect(said).not.toMatch(/attempt/i);
        expect(said).not.toMatch(/\bINPUT\b/);
        await expect(page.locator('[data-field="input"]')).toHaveCount(0);
      }
    });

    test('shows a completed step’s timing, output and configured policy', async ({
      page,
    }) => {
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([DONE]),
        }),
      );

      // The epoch the fixture records reads as a
      // different hour in every zone, so the shape
      // is what is held — but the whole of it: a
      // step timed to the millisecond is drawn to
      // the millisecond, on a 24-hour clock this
      // page's own 12-hour locale does not get a
      // say in.
      await expect(
        page.locator('[data-evidence-field="started"] .value'),
      ).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
      await expect(
        page.locator('[data-evidence-field="completed"] .value'),
      ).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
      await expect(
        page.locator('[data-evidence-field="duration"] .value'),
      ).toHaveText('48 ms');

      // The value the step returned, not the wrapper
      // whatever serializer the project registered
      // stored it in.
      await expect(
        page.locator('[data-evidence-field="output"] .value'),
      ).toHaveText(DONE.shown!);

      // The fixture's block spells the defaults out,
      // and the card says they are configuration
      // rather than something the run recorded.
      await expect(
        page.locator('[data-evidence-field="retry"] .value'),
      ).toHaveText('max 3 · interval 1 s · backoff 2×');
      await expect(
        page.locator('[data-evidence-field="retry"] .provenance'),
      ).toHaveText(inspectorStrings.configured);
    });

    /**
     * The class DBOS threw first, then its sentence.
     * A step that ran out of tries says so on a
     * third line and never lists the tries: one
     * entry per try is exactly the per-step history
     * nothing here may claim.
     */
    test('shows a failed step’s error, its class first', async ({ page }) => {
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW]),
        }),
      );

      const error = page.locator('.evidence-error');

      await expect(error).toContainText('StripeTimeoutError');
      await expect(error).toContainText('Request timed out after 30 s');
      await expect(error).not.toContainText(inspectorStrings.exhausted);

      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([EXHAUSTED]),
        }),
      );

      await expect(error).toContainText(inspectorStrings.exhausted);
    });

    /**
     * And the way to the line it threw on is offered
     * only where the stack named a file in the
     * project's own `lib/`. Most stacks name the SDK
     * and the generated workflow and nothing else,
     * and a button that opened one of those would be
     * worse than no button.
     */
    test('shows Open Error Location only when the step has a frame', async ({
      page,
    }) => {
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW]),
        }),
      );

      const door = page.locator('[data-evidence-action="openErrorLocation"]');

      await expect(page.locator('.evidence-error')).toBeVisible();
      await expect(door).toHaveCount(0);

      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW_IN_LIB]),
        }),
      );

      await expect(door).toHaveText(inspectorStrings.openErrorLocation);
      await expect(
        page.locator('[data-evidence-field="errorLocation"] .hint'),
      ).toHaveText(inspectorStrings.errorLocationFrom);
    });

    /**
     * The block and the row together. A block that
     * ran more than once failed on one of those
     * tries, and each wrote a stack of its own.
     */
    test('asks for the line by block and row', async ({ page }) => {
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW_IN_LIB]),
        }),
      );

      await page.locator('[data-evidence-action="openErrorLocation"]').click();

      expect(await harness.postedOfType('openErrorLocation')).toEqual([
        { type: 'openErrorLocation', nodeId: 'find_slot', functionId: 3 },
      ]);
    });

    /**
     * The ways on from a recorded step, in the order
     * somebody reaches for them: the code, the line
     * it broke on, a second run from here, and the
     * agent.
     *
     * Every one of them carries the block, and the
     * two that start something carry the run as
     * well — a panel may be drawing a run the
     * extension has since moved past, and which run
     * is being asked about is not a question a card
     * gets to answer from memory.
     */
    test('offers the four ways on from a failed step', async ({ page }) => {
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW_IN_LIB]),
        }),
      );

      await expect(
        page.locator('.evidence-actions [data-evidence-action]'),
      ).toHaveText([
        inspectorStrings.openHandler,
        inspectorStrings.openErrorLocation,
        inspectorStrings.replayFrom,
        inspectorStrings.askAgent,
      ]);

      await page.locator('[data-evidence-action="openFunction"]').click();
      await page.locator('[data-evidence-action="replayFrom"]').click();
      await page.locator('[data-evidence-action="askAgent"]').click();

      expect(await harness.postedOfType('openFunction')).toEqual([
        { type: 'openFunction', nodeId: 'find_slot' },
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
      const harness = await mountInspector(page);
      await harness.show(
        blockInit({
          ...blockSubject('find_slot', {}, 'evidence'),
          run: recording([THREW]),
        }),
      );

      await expect(
        page.locator('.evidence-actions [data-evidence-action]'),
      ).toHaveText([
        inspectorStrings.openHandler,
        inspectorStrings.replayFrom,
        inspectorStrings.askAgent,
      ]);
    });
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

      await expect(
        page.locator('[data-evidence-field="queue"] .value'),
      ).toHaveText('document-index');
      await expect(
        page.locator('[data-evidence-field="active"] .value'),
      ).toHaveText('3 of 8 queue-wide');
      await expect(
        page.locator('[data-evidence-field="queued"] .value'),
      ).toHaveText('12 · 4 delayed');
      await expect(
        page.locator('[data-evidence-field="rateLimit"] .value'),
      ).toHaveText('5 per 10 s');

      await expect(
        page.locator('[data-evidence-field="active"] .provenance'),
      ).toHaveText(inspectorStrings.derived);
      await expect(
        page.locator('[data-evidence-field="rateLimit"] .provenance'),
      ).toHaveText(inspectorStrings.configured);
    });

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

      await expect(
        page.locator('[data-evidence-field="observedStarts"] .value'),
      ).toHaveText('74 in the last 60 s');
      await expect(
        page.locator('[data-evidence-field="observedStarts"] .provenance'),
      ).toHaveText(inspectorStrings.derived);
      await expect(
        page.locator('[data-evidence-field="registered"] .value'),
      ).toHaveText(inspectorStrings.queueMatches);

      // The window sees only the children still on
      // the queue, so its count of failures is the
      // errored ones and says so.
      await expect(
        page.locator('[data-evidence-field="failed"] .value'),
      ).toHaveText('1 · 2 errored queue-wide in the window');
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

      await expect(
        page.locator('[data-evidence-field="registered"] .value'),
      ).toHaveText(
        filled(
          inspectorStrings.queueDiffers,
          'global concurrency 4 · min polling interval 1000 ms',
        ),
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

  /**
   * The colour a field's placeholder is painted in.
   *
   * The browser draws a placeholder in an element of
   * its own inside the field, which the page cannot
   * reach: asked for the placeholder's style, it
   * answers with the field's. The DevTools protocol
   * can reach it, so that is what is asked. The field
   * is given a placeholder and emptied by hand, since
   * no form draws one yet, and nothing is told: the
   * page's own idea of the value is left alone.
   */
  async function placeholderColour(
    page: Page,
    field: Locator,
  ): Promise<string> {
    await field.evaluate((input: HTMLInputElement) => {
      input.setAttribute('placeholder', '·');
      input.value = '';
    });

    const devtools = await page.context().newCDPSession(page);
    await devtools.send('DOM.enable');
    await devtools.send('CSS.enable');

    const { root } = await devtools.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });

    type Node = typeof root;
    const drawn: Node[] = [];
    const walk = (node: Node): void => {
      if (node.attributes?.includes('-webkit-input-placeholder')) {
        drawn.push(node);
      }
      [...(node.children ?? []), ...(node.shadowRoots ?? [])].forEach(walk);
    };
    walk(root);

    // The one field given a placeholder is the one
    // field that draws the element.
    expect(drawn).toHaveLength(1);

    const { computedStyle } = await devtools.send(
      'CSS.getComputedStyleForNode',
      { nodeId: drawn[0]!.nodeId },
    );

    return computedStyle.find((one) => one.name === 'color')?.value ?? '';
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
        blockSubject('record_booking'),
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

        const controls = await page
          .locator('[data-property] :is(input, select, textarea, button)')
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
        afterGroup: sections
          .filter((section) =>
            section.previousElementSibling?.matches('[data-property]'),
          )
          .map((section) => width(section, 'Top')),
        hints: [...document.querySelectorAll('.inspector .field-hint')].map(
          (hint) => width(hint, 'Top'),
        ),
      };
    });

    expect(read.rows.length).toBeGreaterThan(0);
    expect(new Set(read.rows.map(([top]) => top))).toEqual(new Set(['1px']));
    expect(new Set(read.rows.map(([, bottom]) => bottom))).toEqual(
      new Set(['0px']),
    );

    expect(read.firstInGroup).toEqual(['1px', '1px']);
    expect(read.afterGroup.length).toBeGreaterThanOrEqual(2);
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

  /**
   * Leaving a field after Enter sends nothing more:
   * what was typed has already gone. Typed as a
   * number is not written back — `5.0` reads back
   * as `5` — so what the field shows and what the
   * document says differ, and only what was sent
   * tells the field it has nothing left to send.
   */
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

    const assigned = page.locator('[data-picker-fn="findSlot"]');

    await expect(assigned).toHaveAttribute('data-state', 'assigned');
    await expect(assigned).toHaveCSS('padding', '7px 11px');
  });
});

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
  /** What core says can sit behind that block, so
   *  the assertion cannot drift from the rule. */
  function fitting(nodeId: string): string[] {
    const node = ir.nodes.find((one) => one.id === nodeId)!;

    return manifest.functions
      .filter((fn) => handlerFit(node, fn).fits)
      .map((fn) => fn.export);
  }

  async function openPicker(page: Page, nodeId = 'slot_open') {
    const harness = await openInspector(page, blockInit(blockSubject(nodeId)));

    return harness;
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

    await page.locator('[data-picker-new]').click();

    const field = page.locator('[data-picker-new] input');
    await field.fill('decideLater');
    await field.press('Enter');

    expect(await harness.postedOfType('assign')).toEqual([
      {
        type: 'assign',
        baseRevision: ir.revision,
        nodeId: 'slot_open',
        export: 'decideLater',
      },
    ]);
  });

  test('puts the row back when the name is abandoned', async ({ page }) => {
    const harness = await openPicker(page);

    await page.locator('[data-picker-new]').click();

    const field = page.locator('[data-picker-new] input');
    await field.fill('decideLater');
    await field.press('Escape');

    await expect(field).toHaveCount(0);
    await expect(page.locator('[data-picker-new]')).toHaveText(
      inspectorStrings.newFunction,
    );

    // And leaving the field is not a way to name one:
    // a name given by accident is a stub on disk.
    await page.locator('[data-picker-new]').click();
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

    await expect(page.locator('[data-picker-fn]')).toHaveCount(0);
    await expect(page.locator('.picker-empty')).toHaveText(
      inspectorStrings.noLib,
    );
    await expect(page.locator('[data-picker-new]')).toBeVisible();
  });

  /**
   * The two kinds whose relationship with their
   * code is the thing a person gets wrong: a branch
   * owns none of it, and a transaction's writes ride
   * on the step record.
   */
  test('says what a branch and a transaction are', async ({ page }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('slot_open')),
    );

    await expect(
      page.locator('[data-callout="branch"] .callout-title'),
    ).toHaveText(inspectorStrings.callouts.branch.title);

    await harness.show(blockInit(blockSubject('record_booking')));

    await expect(page.locator('[data-callout="transaction"]')).toContainText(
      inspectorStrings.callouts.transaction.title,
    );
    await expect(page.locator('[data-field="database"]')).toContainText(
      inspectorStrings.database,
    );
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
      page.locator('[data-field="handler"] .property-label'),
    ).toHaveText('function');
    await expect(page.locator('[data-field="logic"]')).toHaveCount(0);

    await harness.show(
      blockInit({
        ...blockSubject('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    await expect(
      page.locator('[data-field="logic"] .property-label'),
    ).toHaveText('logic');
    await expect(page.locator('[data-field="handler"]')).toHaveCount(0);
  });

  /**
   * The value is the way in: there is no native
   * select here, so the caret is what says the name
   * can be changed at all.
   */
  test('wears a caret on the name, and asks for one when there is none', async ({
    page,
  }) => {
    const harness = await openInspector(
      page,
      blockInit(blockSubject('find_slot')),
    );

    await expect(page.locator('[data-picker-value]')).toHaveText('findSlot ▾');

    await harness.show(blockInit(blockSubject('slot_open')));

    await expect(page.locator('[data-picker-value]')).toHaveText(
      inspectorStrings.dropHere,
    );
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

  /**
   * The way out of the column and into the code.
   * The block travels and nothing else: where that
   * function is written, and whether the project's
   * code-behind still has one of that name, is the
   * extension's answer rather than the panel's.
   */
  test('asks for the code the block already runs', async ({ page }) => {
    const harness = await openPicker(page, 'find_slot');

    await page.locator('[data-open-function]').click();

    expect(await harness.postedOfType('openFunction')).toEqual([
      { type: 'openFunction', nodeId: 'find_slot' },
    ]);
  });
});
