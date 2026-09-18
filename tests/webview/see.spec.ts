import { expect, test, type Locator, type Page } from '@playwright/test';

import type { SeeRun } from '../../src/webview/protocol.js';

import { GRID } from '../../src/canvas/grid.js';
import { liveRun } from '../../src/test-support/runs.js';
import { filled } from '../../src/webview/fill.js';
import { shortRunId } from '../../src/webview/ids.js';

import { LIBRARY_COLOURS } from './fixtures/library.js';
import {
  GRAPH,
  NO_SAVED_WORKFLOW,
  QUEUED,
  QUEUED_GRAPH,
  QUEUED_TRACE,
  REPLAYED_TRACE,
  RUNNING,
  RUNNING_GRAPH,
  RUN_ID,
  SDK_OWNED,
  TRACE,
  UNATTRIBUTED,
  graphAtRest,
  seeInit,
  seeNothing,
  seeRun,
  showRun,
  transformOf,
} from './fixtures/runs.js';
import { THEMES_ALL } from './harness.js';
import { colourOf, sameColour, type Role } from './palette.js';
import { canvasWords, seeWords as seeStrings } from './words.js';

/**
 * One run, in the editor tab it is opened in.
 *
 * The tab draws a run two ways: the workflow the
 * run was a run of, with what the run did to each
 * block, and the rows it wrote in the order it
 * wrote them. The runs themselves come from
 * `fixtures/runs.ts`, because the Inspector's spec
 * draws the same runs from the other side of the
 * editor and two copies would drift apart.
 *
 * The words are the ones sent in, as everywhere in
 * these specs; that the extension resolves the
 * right ones is checked where the extension is.
 */

/** The run as the graph cases draw it: every state
 *  a block can be in, on a workflow that branches. */
const GOING = seeRun({ graph: RUNNING_GRAPH, live: RUNNING });

/** The same run with one block picked on it. */
const PICKED: SeeRun = seeRun({
  graph: GRAPH,
  selected: { nodeId: 'find_slot', functionId: undefined },
});

/** The small run on a layout that starts well away
 *  from the origin, right of it and below it. */
const AWAY = seeRun({
  graph: {
    ...GRAPH,
    boxes: Object.fromEntries(
      Object.entries(GRAPH.boxes).map(([id, box]) => [
        id,
        { ...box, x: box.x + 300, y: box.y + 400 },
      ]),
    ),
  },
});

/** Where the first block sits inside the board: in
 *  from the left, and down from the top. */
const INSET = { left: 26, top: 22 };

/** What a wire in each state is drawn in, and so
 *  what the head at the end of it is drawn in. */
const WIRE_ROLES: Record<string, Role> = {
  idle: 'hairline-strong',
  active: 'ok',
  done: 'edge-done',
  waiting: 'warn',
  failed: 'fail',
};

/** One wire's stroke, as the page resolved it. */
function strokeOf(page: Page, edge: string): Promise<string> {
  return page
    .locator(`.react-flow__edge[data-id="${edge}"] .wire`)
    .evaluate((wire) => getComputedStyle(wire).stroke);
}

/** A tab wide enough to hold the trace beside the
 *  graph, and one that is not. */
const WIDE = 1400;
const NARROW = 800;

/** A run named by a UUID, as DBOS mints them, so it
 *  has the short id a person reads a run by. */
const MINTED = seeRun({
  workflowId: RUN_ID,
  short: shortRunId(RUN_ID),
  graph: GRAPH,
  trace: TRACE,
  unattributed: UNATTRIBUTED,
});

/** Where an element sits on the page, by its middle. */
async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('nothing drawn to find the middle of');

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the board somewhere a fresh one would not
 *  open: dragged up and left, then zoomed in. */
async function moveTheBoard(page: Page): Promise<void> {
  const box = await page.locator('.run-flow').boundingBox();
  if (box === null) throw new Error('the graph pane has no box');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + 40);
  await page.mouse.up();
  await page.mouse.wheel(0, -120);

  await graphAtRest(page);
}

/** How wide the tab is, which the layout is sized
 *  against. */
function tabWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.clientWidth);
}

/**
 * One row over the run: which run it is and how it
 * went, the two views of it, and a way to look
 * again. Everything else a run page used to say
 * above its graph is the editor tab's or the
 * Inspector's.
 */
test.describe('the run tab’s header', () => {
  for (const theme of THEMES_ALL) {
    test(`says in one row which run it is and how it went in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(MINTED, 'graph'), theme);

      const header = page.locator('.run-header');
      await expect(header).toHaveCount(1);

      const parts = [
        header.locator('.status-glyph[data-glyph="dot"]'),
        header.locator('.run-line'),
        header.getByRole('tablist'),
        header.locator('[data-see-refresh]'),
      ];

      for (const part of parts) await expect(part).toHaveCount(1);

      const box = await header.boundingBox();
      if (box === null) throw new Error('the header drew nothing');
      expect(box.height, `header ${box.height}px`).toBeLessThanOrEqual(44);

      const middles = await Promise.all(
        parts.map(async (part) => (await centreOf(part)).y),
      );
      expect(
        Math.max(...middles) - Math.min(...middles),
        `middles ${middles.join(', ')}`,
      ).toBeLessThanOrEqual(2);

      const line = header.locator('.run-line');
      await expect(line).toHaveText(
        `${seeStrings.run} ${shortRunId(RUN_ID)} · ` +
          'groom_booking · done · 8.2 s',
      );

      const short = line.locator('[data-short-run]');
      await expect(short).toHaveText(shortRunId(RUN_ID));
      await expect(short).toHaveAttribute('title', RUN_ID);

      const refresh = header.locator('[data-see-refresh]');
      await expect(refresh).toHaveAttribute('data-variant', 'quiet');
      await expect(refresh).toHaveAttribute('data-icon', 'refresh');
      await expect(refresh).toHaveAccessibleName(/\S/);

      const drawn = await line.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--text-sm)';
        document.body.append(probe);
        const small = parseFloat(getComputedStyle(probe).fontSize);
        probe.remove();

        const style = getComputedStyle(element);

        return {
          colour: style.color,
          size: parseFloat(style.fontSize),
          small,
        };
      });
      const soft = colourOf(theme, 'ink-soft');

      expect(
        sameColour(drawn.colour, soft),
        `line in ${theme}: ${drawn.colour} ≠ ${soft}`,
      ).toBe(true);
      expect(Math.abs(drawn.size - drawn.small)).toBeLessThanOrEqual(0.05);
    });
  }

  /**
   * The dot moves only while something is reading
   * the run, and a run nobody is reading any more
   * that was not over is drawn hollow: it may have
   * moved on since, and a filled dot would say it
   * had not. Read with motion reduced, so the dot is
   * read at rest rather than mid-pulse.
   */
  test('shows a watched run moving and an unwatched one hollow', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const dot = page.locator('.run-header .status-glyph[data-glyph="dot"]');
    const ground = (): Promise<string> =>
      dot.evaluate((glyph) => getComputedStyle(glyph).backgroundColor);

    await showRun(
      page,
      seeInit(seeRun({ state: 'running', following: 'following' })),
    );
    await expect(dot).toHaveCount(1);
    await expect(dot).toHaveAttribute('data-pulse', '');
    expect(await ground()).not.toBe('rgba(0, 0, 0, 0)');

    await showRun(
      page,
      seeInit(seeRun({ state: 'running', following: 'quiet' })),
    );
    await expect(dot).toHaveCount(1);
    await expect(dot).not.toHaveAttribute('data-pulse');
    expect(await ground()).toBe('rgba(0, 0, 0, 0)');

    await showRun(
      page,
      seeInit(seeRun({ state: 'running', following: 'quiet' })),
      'high-contrast-light',
    );
    await expect(dot).toHaveCount(1);

    const ring = await dot.evaluate(
      (glyph) => getComputedStyle(glyph).borderTopColor,
    );
    const ink = colourOf('high-contrast-light', 'ink');

    expect(sameColour(ring, ink), `${ring} ≠ ${ink}`).toBe(true);
  });

  /**
   * The breadcrumb's whole id is the editor tab's
   * title now, the ledger's status word is the
   * Inspector's, and whether the run is still being
   * read is the refresh Button's name. Nothing in the
   * header is set larger than a control.
   */
  test('leaves out the breadcrumb, the status and the follow line', async ({
    page,
  }) => {
    await showRun(page, seeInit(MINTED));

    const header = page.locator('.run-header');
    await expect(header).toHaveCount(1);

    await expect(page.locator('.crumb')).toHaveCount(0);
    await expect(page.getByText('mBoss ›')).toHaveCount(0);
    await expect(page.getByText(/refresh to check/)).toHaveCount(0);
    await expect(page.getByText('SUCCESS')).toHaveCount(0);

    const sizes = await header.evaluate((element) =>
      [element, ...element.querySelectorAll('*')].map((one) =>
        parseFloat(getComputedStyle(one).fontSize),
      ),
    );

    expect(sizes.length).toBeGreaterThan(4);
    expect(sizes.filter((size) => size >= 16)).toEqual([]);
  });

  /**
   * A glyph with no label, so its name is what a
   * pointer and a screen reader are told: whether
   * anything is still reading the run, and what it
   * would take to find out if not.
   */
  test('names the refresh Button by what the watch is doing', async ({
    page,
  }) => {
    for (const state of ['following', 'waiting', 'quiet'] as const) {
      const harness = await showRun(
        page,
        seeInit(seeRun({ following: state })),
      );
      const refresh = page.locator('[data-see-refresh]');
      const said = seeStrings.following[state];

      await expect(refresh).toHaveAccessibleName(said);
      await expect(refresh).toHaveAttribute('title', said);

      await refresh.click();

      expect(await harness.postedOfType('seeRefresh')).toEqual([
        { type: 'seeRefresh' },
      ]);
    }
  });

  /**
   * The pane is the strip's panel: the tab names the
   * pane it opens and the pane names the tab that
   * opened it. Only one pane is ever on the page, so
   * only the tab that is on points at anything.
   */
  test('makes the pane that is showing the tab’s panel', async ({ page }) => {
    for (const [on, off] of [
      ['graph', 'trace'],
      ['trace', 'graph'],
    ] as const) {
      await showRun(page, seeInit(MINTED, on));

      const pane = page.locator('[data-pane]');
      await expect(pane).toHaveCount(1);
      await expect(pane).toHaveAttribute('data-pane', on);
      await expect(pane).toHaveAttribute('data-showing', 'true');
      await expect(pane).toHaveAttribute('role', 'tabpanel');

      const labelled = await pane.getAttribute('aria-labelledby');
      const tab = page.locator(`[data-see-tab="${on}"]`);

      expect(labelled).not.toBeNull();
      await expect(tab).toHaveAttribute('id', labelled ?? '');
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toHaveAttribute(
        'aria-controls',
        (await pane.getAttribute('id')) ?? '',
      );
      await expect(page.locator(`[data-see-tab="${off}"]`)).not.toHaveAttribute(
        'aria-controls',
      );
    }
  });

  /**
   * The keyboard's way through a run is the trace, so
   * from the strip it reaches the refresh Button, the
   * way back to the document, and then the rows,
   * without stopping on anything the graph draws.
   */
  test('reaches refresh, Edit workflow and the first row by keyboard', async ({
    page,
  }) => {
    await showRun(page, seeInit(MINTED, 'graph'), 'light', { width: WIDE });
    await graphAtRest(page);

    await expect(page.locator('[data-trace-op]')).not.toHaveCount(0);

    const onTheGraph = (): Promise<boolean> =>
      page.evaluate(
        () =>
          document.activeElement?.closest(
            '.react-flow__node, .react-flow__edge',
          ) != null,
      );

    await page.locator('[data-see-tab][aria-selected="true"]').focus();

    for (const next of [
      page.locator('[data-see-refresh]'),
      page.locator('[data-edit-workflow]'),
      page.locator('[data-trace-op]').first(),
    ]) {
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
      expect(await onTheGraph()).toBe(false);
    }
  });
});

/**
 * What is under the header, and only what is being
 * read. A pane that is not showing is not on the
 * page at all: hidden, the graph's blocks still
 * painted over the trace, because the library draws
 * each one visible whatever its pane says.
 */
test.describe('the run tab’s panes', () => {
  test('gives the graph most of a wide tab and the trace the rest', async ({
    page,
  }) => {
    await showRun(page, seeInit(MINTED, 'graph'), 'light', { width: WIDE });
    await graphAtRest(page);

    const column = page.locator('.trace-column');
    await expect(column).toHaveCount(1);
    await expect(column.locator('[data-trace]')).toHaveCount(1);
    await expect(column).toHaveCSS('box-sizing', 'border-box');

    const canvas = await page.locator('.run-flow').boundingBox();
    if (canvas === null) throw new Error('the graph pane has no box');

    const share = canvas.width / (await tabWidth(page));
    expect(Math.abs(share - 0.62), `share ${share}`).toBeLessThanOrEqual(0.01);

    await showRun(page, seeInit(MINTED, 'graph'), 'light', { width: 2000 });
    await graphAtRest(page);
    await expect(column).toHaveCount(1);

    const widest = await column.boundingBox();
    expect(widest?.width).toBe(640);

    await showRun(page, seeInit(MINTED, 'graph'), 'light', { width: NARROW });
    await graphAtRest(page);

    await expect(page.locator('[data-node]')).toHaveCount(3);
    await expect(page.locator('[data-trace]')).toHaveCount(0);
  });

  test('keeps the trace to a readable width on its own tab', async ({
    page,
  }) => {
    await showRun(page, seeInit(MINTED, 'trace'), 'light', { width: 1900 });

    const list = page.locator('[data-pane="trace"] [data-trace]');
    await expect(list).toHaveCount(1);

    const box = await list.boundingBox();
    if (box === null) throw new Error('the trace drew nothing');

    expect(box.width).toBeGreaterThan(0);
    expect(box.width).toBeLessThanOrEqual(640);
  });

  for (const width of [NARROW, WIDE]) {
    test(`unmounts the graph while the trace shows, ${width}px wide`, async ({
      page,
    }) => {
      const harness = await showRun(page, seeInit(MINTED, 'graph'), 'light', {
        width,
      });
      await graphAtRest(page);

      const blocks = page.locator('[data-node]');
      await expect(blocks).toHaveCount(3);

      await moveTheBoard(page);
      const before = await transformOf(page);
      const centres = await Promise.all(
        (await blocks.all()).map((block) => centreOf(block)),
      );

      await page.locator('[data-see-tab="trace"]').click();
      await harness.show(seeInit(MINTED, 'trace'));

      await expect(page.locator('[data-pane="trace"]')).toHaveCount(1);
      await expect(blocks).toHaveCount(0);
      await expect(page.locator('[data-run-node]')).toHaveCount(0);
      await expect(page.locator('.react-flow__node')).toHaveCount(0);

      for (const at of centres) {
        const found = await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('[data-node]') != null,
          at,
        );

        expect(found, `a block at ${at.x},${at.y}`).toBe(false);
        await page.mouse.click(at.x, at.y);
      }

      expect(await harness.postedOfType('seeNode')).toEqual([]);

      await page.locator('[data-see-tab="graph"]').click();
      await harness.show(seeInit(MINTED, 'graph'));
      await graphAtRest(page);

      await expect(blocks).toHaveCount(3);
      expect(await transformOf(page)).toBe(before);
    });
  }

  /**
   * A person who panned and zoomed to look at
   * something is still looking at it after they
   * check the trace and come back. The graph is put
   * away while the trace shows and drawn again on the
   * way back, and it is handed the view it reported
   * last rather than opening at its first block.
   * Another run is another picture, and opens where
   * any run does.
   */
  test('keeps the graph where it was left when the tabs change', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ graph: GRAPH }), 'graph'),
    );
    await graphAtRest(page);

    await moveTheBoard(page);
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
      await graphAtRest(page);
    }

    expect(await transformOf(page)).toBe(before);

    await harness.show(
      seeInit(
        seeRun({
          workflowId: 'wf_other',
          short: shortRunId('wf_other'),
          graph: GRAPH,
        }),
        'graph',
      ),
    );
    await graphAtRest(page);

    // The top-left block is 160 above the origin.
    expect(await transformOf(page)).toBe(
      `translate(${INSET.left}px, ${INSET.top + 160}px) scale(1)`,
    );
  });

  test('moves only the trace column as the tab narrows and widens', async ({
    page,
  }) => {
    await showRun(page, seeInit(MINTED, 'graph'), 'light', { width: WIDE });
    await graphAtRest(page);

    const blocks = page.locator('[data-node]');
    const trace = page.locator('[data-trace]');

    await expect(blocks).toHaveCount(3);
    await expect(trace).toHaveCount(1);

    await moveTheBoard(page);
    const before = await transformOf(page);

    // Marked, so a board drawn afresh would be a
    // board without the mark.
    await page
      .locator('.react-flow')
      .evaluate((board) => board.setAttribute('data-kept', ''));

    await page.setViewportSize({ width: NARROW, height: 1800 });

    await expect(trace).toHaveCount(0);
    await expect(blocks).toHaveCount(3);
    await expect(page.locator('.react-flow[data-kept]')).toHaveCount(1);
    expect(await transformOf(page)).toBe(before);

    await page.setViewportSize({ width: WIDE, height: 1800 });

    await expect(trace).toHaveCount(1);
    await expect(page.locator('.react-flow[data-kept]')).toHaveCount(1);
    expect(await transformOf(page)).toBe(before);
  });

  /**
   * Where the project has no document of the run's
   * name, the pane says so in place of the picture,
   * rather than leaving a blank board that reads as
   * broken.
   */
  test('draws a run whose workflow is gone as a sentence', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: undefined }), 'graph'));

    const said = page.locator('.empty-state[data-graph-caption]');

    await expect(said).toHaveCount(1);
    await expect(said.locator('.empty-title')).toHaveText(NO_SAVED_WORKFLOW);
    await expect(page.locator('[data-run-node]')).toHaveCount(0);
    await expect(page.locator('.react-flow')).toHaveCount(0);
  });

  test('has nothing to draw before a run is picked', async ({ page }) => {
    await showRun(page, seeNothing());

    await expect(page.locator('.empty-state .empty-title')).toHaveText(
      seeStrings.nothingSelected,
    );
    expect(seeStrings.nothingSelected).toBe('Pick a run to see what it did');
    await expect(page.locator('.state')).toHaveCount(0);
  });

  /**
   * The page quotes its sources; it does not
   * decorate them. Asked of the sections this tab
   * actually draws, each counted first, since a check
   * over nothing is as true of a blank page.
   */
  test('frames its sections without ornament', async ({ page }) => {
    for (const [showing, sections] of [
      ['graph', ['.see', '.run-header', '[data-pane]', '.trace-column']],
      ['trace', ['.see', '.run-header', '[data-pane]', '.trace-pane']],
    ] as const) {
      await showRun(page, seeInit(MINTED, showing));

      for (const section of sections) {
        await expect(page.locator(section), section).toHaveCount(1);
      }

      const drawn = await page.evaluate(
        (selectors) =>
          selectors.flatMap((selector) => {
            const element = document.querySelector(selector);
            if (element === null) return [`${selector} missing`];

            const style = getComputedStyle(element);
            const parts = ['::before', '::after'].map((part) => {
              const pseudo = getComputedStyle(element, part);

              return `${pseudo.content} ${pseudo.backgroundImage}`;
            });

            return [
              `image ${style.backgroundImage}`,
              `radius ${style.borderTopLeftRadius} ` +
                style.borderBottomRightRadius,
              `shadow ${style.boxShadow}`,
              ...parts,
            ];
          }),
        [...sections],
      );

      expect([...new Set(drawn)].sort()).toEqual(
        ['image none', 'none none', 'radius 0px 0px', 'shadow none'].sort(),
      );
    }
  });

  /**
   * The run tab is the run and nothing beside it.
   * What a run recorded about a block, or about the
   * whole run, is the Inspector's to say, in the side
   * bar, so the panes keep the tab's whole width.
   */
  test('draws no rail beside the run', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          graph: GRAPH,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
        'graph',
      ),
    );
    await graphAtRest(page);

    await expect(page.locator('[data-run-node]')).toHaveCount(3);

    for (const hook of [
      '.rail',
      '[data-evidence]',
      '[data-inspector-tab]',
      '[data-inspector-mode]',
    ]) {
      await expect(page.locator(hook)).toHaveCount(0);
    }

    const { pane, tab } = await page.evaluate(() => ({
      pane:
        document.querySelector('[data-pane="graph"]')?.getBoundingClientRect()
          .width ?? 0,
      tab: document.querySelector('.see')?.clientWidth ?? -1,
    }));

    expect(pane).toBeGreaterThan(0);
    expect(Math.abs(pane - tab)).toBeLessThanOrEqual(1);
  });

  /**
   * Somebody moving by landmark lands on the view
   * itself rather than on the row of furniture above
   * it, and each list of rows says which rows it is
   * a list of. The trace beside the graph is a second
   * reading of the one run rather than an aside
   * about it, so it is no landmark of its own.
   */
  for (const width of [NARROW, WIDE]) {
    for (const showing of ['graph', 'trace'] as const) {
      test(`names the view and its lists, ${showing} at ${width}px`, async ({
        page,
      }) => {
        await showRun(page, seeInit(MINTED, showing), 'light', { width });

        await expect(page.locator('[data-pane]')).toHaveCount(1);

        const main = page.getByRole('main');
        await expect(main).toHaveCount(1);
        await expect(main.locator('[role="tabpanel"]')).toHaveCount(1);
        await expect(page.getByRole('complementary')).toHaveCount(0);

        const traced = await page.locator('[data-trace]').count();
        const apart = await page.locator('[data-unattributed]').count();

        await expect(
          page.getByRole('list', { name: seeStrings.trace }),
        ).toHaveCount(traced);
        await expect(
          page.getByRole('list', { name: seeStrings.unattributed }),
        ).toHaveCount(apart);
      });
    }
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
   * The graph opens where a reader starts, at its
   * top-left block and at the size it was drawn at.
   * Fitted to the pane, a run of three blocks sat in
   * the middle of a field of dots, and a run of
   * thirty was shrunk until nothing on it could be
   * read. The layout can put blocks on either side
   * of the origin, so the anchor is worked out from
   * the boxes rather than assumed to be zero.
   */
  for (const [where, run, blocks] of [
    ['left of and above the origin', GOING, 7],
    ['right of and below the origin', AWAY, 3],
  ] as const) {
    test(`anchors a graph laid out ${where} at its top-left block`, async ({
      page,
    }) => {
      await showRun(page, seeInit(run, 'graph'));
      await graphAtRest(page);

      await expect(page.locator('[data-run-node]')).toHaveCount(blocks);

      const inset = await page.evaluate(() => {
        const board = document.querySelector('.react-flow');
        const drawn = [...document.querySelectorAll('.react-flow__node')];

        if (board === null) return undefined;

        const at = board.getBoundingClientRect();
        const boxes = drawn.map((block) => block.getBoundingClientRect());

        return {
          left: Math.min(...boxes.map((box) => box.left)) - at.left,
          top: Math.min(...boxes.map((box) => box.top)) - at.top,
        };
      });

      if (inset === undefined) throw new Error('the graph drew no board');

      expect(
        Math.abs(inset.left - INSET.left),
        `left ${inset.left}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(inset.top - INSET.top),
        `top ${inset.top}`,
      ).toBeLessThanOrEqual(1);
      // At the size it was drawn at.
      expect(await transformOf(page)).toMatch(/scale\(1\)$/);
    });
  }

  /**
   * A document can hold no blocks at all, and the
   * board it draws is still a board somebody can
   * move, starting where a first block would.
   */
  test('opens a board with no blocks where the first would sit', async ({
    page,
  }) => {
    const empty = {
      ...GRAPH,
      ir: { ...GRAPH.ir, nodes: [], edges: [] },
      boxes: {},
    };

    await showRun(page, seeInit(seeRun({ graph: empty }), 'graph'));
    await graphAtRest(page);

    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    expect(await transformOf(page)).toBe(
      `translate(${INSET.left}px, ${INSET.top}px) scale(1)`,
    );
  });

  /**
   * One block on the page for every block in the
   * document, and nothing else on the board: the
   * run's end is the last block, not a pill of its
   * own the document never had.
   */
  test('draws the saved workflow, with what the run did to each block', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    await expect(page.locator('[data-run-node]')).toHaveCount(3);
    await expect(page.locator('[data-node]')).toHaveCount(3);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
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

  /**
   * The way back to Build, in the graph's own corner
   * beside the revision it draws. It opens the
   * document and projects nothing onto it, and it is
   * there only where the project still has a
   * document to open.
   */
  test('posts openWorkflow from Edit workflow', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ graph: GRAPH }), 'graph'),
    );
    await graphAtRest(page);

    const corner = page.locator('.react-flow__panel.bottom.left');

    await expect(corner).toHaveCount(1);
    await expect(corner.locator('[data-graph-caption]')).toHaveText(
      'workflow as saved · revision 4',
    );

    const edit = corner.locator('[data-edit-workflow]');

    await expect(edit).toHaveText(seeStrings.editWorkflow);
    await edit.click();

    expect(await harness.postedOfType('openWorkflow')).toEqual([
      { type: 'openWorkflow', workflowId: 'wf_c9d2f3' },
    ]);

    await harness.show(seeInit(seeRun({ graph: undefined }), 'graph'));

    await expect(page.locator('[data-graph-caption]')).toHaveText(
      NO_SAVED_WORKFLOW,
    );
    await expect(page.locator('[data-edit-workflow]')).toHaveCount(0);
  });

  test('tones every block by what the run did there', async ({ page }) => {
    await showRun(page, seeInit(GOING, 'graph'));
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
    await showRun(page, seeInit(GOING, 'graph'));
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
   * No row says a trigger fired, so its tick is
   * worked out from the run existing at all, and the
   * tick says so to a pointer and to a screen reader
   * alike.
   */
  test('says the trigger’s tick was worked out', async ({ page }) => {
    await showRun(page, seeInit(GOING, 'graph'));
    await graphAtRest(page);

    const mark = page.locator('[data-run-node="booking_requested"] .node-run');

    await expect(mark).toHaveAttribute('data-run', 'done');
    await expect(mark).toHaveAttribute('data-provenance', 'derived');
    await expect(mark).toHaveAccessibleDescription(seeStrings.derived);
  });

  /**
   * A row picked in the trace picks the block it
   * belongs to, and the block reads as picked on the
   * graph too. Picked is a ring round the block
   * rather than a new answer about the run, so a
   * finished block that is picked still says it
   * finished.
   */
  test('halos the block a picked row belongs to, and keeps its tick', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          graph: GRAPH,
          selected: { nodeId: 'parse_request', functionId: 0 },
        }),
        'graph',
      ),
    );
    await graphAtRest(page);

    const block = page.locator('[data-run-node="parse_request"]');

    await expect(block).toHaveAttribute('data-state', 'selected');
    await expect(block.locator('.node-run')).toHaveAttribute(
      'data-run',
      'done',
    );
    await expect(block.locator('.node-run')).toHaveText('✓');
  });

  /**
   * Once: the graph hears the click and says so, and
   * nothing inside the block says it a second time.
   */
  test('hands the block somebody clicked to the extension, once', async ({
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
   * Putting a block down is how somebody gets back
   * to what the Inspector says about the whole run,
   * so the empty board between the blocks is a way
   * to do it.
   */
  test('lets go of the block on a click on the background', async ({
    page,
  }) => {
    const harness = await showRun(page, seeInit(PICKED, 'graph'));
    await graphAtRest(page);

    // The corner is clear: the first block sits a
    // little way in from it.
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });

    expect(await harness.postedOfType('seeNode')).toEqual([
      { type: 'seeNode', nodeId: null },
    ]);
  });

  /**
   * Dragging the board is not a click on it:
   * somebody moving the picture to see more of it is
   * still reading about the block they picked.
   */
  test('keeps the block picked while the board is moved', async ({ page }) => {
    const harness = await showRun(page, seeInit(PICKED, 'graph'));
    await graphAtRest(page);

    const board = await page.locator('.react-flow__pane').boundingBox();
    if (board === null) throw new Error('the graph has no board');

    const before = await transformOf(page);

    await page.mouse.move(board.x + 5, board.y + 5);
    await page.mouse.down();
    await page.mouse.move(board.x + 65, board.y + 45, { steps: 4 });
    await page.mouse.up();
    await graphAtRest(page);

    expect(await transformOf(page)).not.toBe(before);
    expect(await harness.postedOfType('seeNode')).toEqual([]);
  });

  /**
   * The key that puts things down everywhere else in
   * the editor. It says something only while there
   * is a block to put down: pressed over a board
   * with nothing picked it would be a message about
   * nothing.
   */
  test('lets go of the block on Escape, and only while one is picked', async ({
    page,
  }) => {
    const harness = await showRun(page, seeInit(PICKED, 'graph'));
    await graphAtRest(page);

    await page.keyboard.press('Escape');

    expect(await harness.postedOfType('seeNode')).toEqual([
      { type: 'seeNode', nodeId: null },
    ]);

    // The host answers with the block put down, the
    // way the extension does.
    await harness.show(seeInit(seeRun({ graph: GRAPH }), 'graph'));

    // The board redraws with nothing picked before
    // it stops listening for the key: the listener
    // goes with the effect's cleanup, which runs
    // after the paint the count reads. Settling the
    // graph is what waits for that cleanup.
    await expect(
      page.locator('[data-run-node][data-state="selected"]'),
    ).toHaveCount(0);
    await graphAtRest(page);

    await page.keyboard.press('Escape');

    expect(await harness.postedOfType('seeNode')).toEqual([
      { type: 'seeNode', nodeId: null },
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
   * The board is the tab's own ground rather than a
   * picture framed inside it: a board that pans
   * inside a frame has blocks sliding under a line
   * that means nothing.
   */
  test('draws its board flush with the tab', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'));
    await graphAtRest(page);

    const board = page.locator('.run-flow');

    await expect(board).toHaveCSS('border-top-width', '0px');
    await expect(board).toHaveCSS('border-top-left-radius', '0px');
    await expect(board).toHaveCSS('background-size', `${GRID}px ${GRID}px`);
  });

  for (const theme of THEMES_ALL) {
    /**
     * A trigger writes no row of its own — it
     * compiles into the way the workflow is started
     * rather than into a durable operation — so the
     * run itself is the evidence that it fired. Left
     * grey it would be the one block on a page about
     * a run claiming nothing happened at it.
     */
    test(`draws the trigger of a run that exists as done in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(GOING, 'graph'), theme);
      await graphAtRest(page);

      const blocks = page.locator('.run-flow [data-run-node]');

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

    /**
     * Every wire runs from one block to another. A
     * wire whose end is somewhere on the board with
     * nothing there reads as a step the page lost.
     */
    test(`starts and ends every wire on a block in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(GOING, 'graph'), theme);
      await graphAtRest(page);

      await expect(page.locator('.react-flow__node')).toHaveCount(7);
      await expect(page.locator('.react-flow__edge path.wire')).toHaveCount(6);

      const loose = await page.evaluate(() => {
        // A port straddles the block's edge by half
        // its 10px, so a wire's end sits up to that
        // far outside the block's box.
        const reach = 6;
        const blocks = [...document.querySelectorAll('.react-flow__node')].map(
          (block) => block.getBoundingClientRect(),
        );
        const onABlock = (at: DOMPoint): boolean =>
          blocks.some(
            (box) =>
              at.x >= box.left - reach &&
              at.x <= box.right + reach &&
              at.y >= box.top - reach &&
              at.y <= box.bottom + reach,
          );
        const wires = [
          ...document.querySelectorAll<SVGPathElement>(
            '.react-flow__edge path.wire',
          ),
        ];

        return wires.flatMap((wire) => {
          const edge = wire
            .closest('.react-flow__edge')
            ?.getAttribute('data-id');
          const onScreen = wire.getScreenCTM();

          if (onScreen === null) return [`${edge} is not on screen`];

          return [0, wire.getTotalLength()]
            .map((length) => wire.getPointAtLength(length))
            .map((point) =>
              new DOMPoint(point.x, point.y).matrixTransform(onScreen),
            )
            .filter((at) => !onABlock(at))
            .map((at) => `${edge} ends at ${at.x},${at.y}`);
        });
      });

      expect(loose).toEqual([]);
    });

    /**
     * The wires are drawn between the ports, so the
     * ports have to be on the page — but nothing here
     * is wired, dragged or dropped on. A port a run
     * page showed would be offering an edit from a
     * page about something that already happened,
     * and one that took a click would swallow the
     * click that picks the block under it.
     */
    test(`draws its wires from ports nothing sees or hits in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'), theme);
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
     * board that clips and takes the trigger off the
     * top of it.
     */
    test(`gives the arrowheads it declares no room in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'), theme);
      await graphAtRest(page);

      await expect(page.locator('.wire-markers')).toHaveCount(1);

      const laidOut = await page.evaluate(() => {
        const markers = document.querySelector('.wire-markers');
        const pane = document.querySelector('.run-flow');
        const flow = document.querySelector('.react-flow');

        if (markers === null || pane === null || flow === null) {
          return undefined;
        }

        const box = markers.getBoundingClientRect();
        // Where the pane's content starts, inside
        // whatever border it is drawn with.
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
    test(`ends every wire in the colour it is drawn in, in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'), theme);
      await graphAtRest(page);

      for (const [state, role] of Object.entries(WIRE_ROLES)) {
        const head = page.locator(`#wire-arrow-${state} path`);

        await expect(head).toHaveCount(1);

        const drawn = await head.evaluate((path) => {
          const style = getComputedStyle(path);

          return { fill: style.fill, stroke: style.stroke };
        });
        const expected = colourOf(theme, role);

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
          const head =
            id === undefined ? null : document.querySelector(`#${id}`);
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
    test(`draws its wires and its grid as the canvas does in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(seeRun({ graph: GRAPH }), 'graph'), theme);
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
     * The wire into where the run is now moves, the
     * way the value along it is going; a wire the run
     * finished with or never took stands still.
     */
    test(`marches the dashes along a wire the run is on in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(GOING, 'graph'), theme);
      await graphAtRest(page);

      const going = page.locator(
        '.react-flow__edge .wire[data-state="active"]',
      );

      // Into the branch, and on along the arm it
      // took to where the run is now.
      expect(
        await going.evaluateAll((wires) =>
          wires.map((wire) =>
            wire.closest('.react-flow__edge')?.getAttribute('data-id'),
          ),
        ),
      ).toEqual(['e3', 'e4']);

      for (const wire of await going.all()) {
        await expect(wire).toHaveCSS('animation-name', 'sig-edge-flow');
      }

      await expect(
        page.locator('.react-flow__edge[data-id="e0"] .wire'),
      ).toHaveCSS('animation-name', 'none');
    });

    /**
     * Every colour on this graph is one this product
     * chose. The library has a default for each of
     * them, picked against a white diagramming page,
     * and a part it draws in one is a part wearing
     * somebody else's theme inside the editor's.
     */
    test(`paints its own ports and wires in ${theme}`, async ({ page }) => {
      const harness = await showRun(
        page,
        seeInit(seeRun({ graph: GRAPH }), 'graph'),
        theme,
      );
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

      // A finished wire and one the run never took,
      // each read by its own state first.
      await harness.show(seeInit(GOING, 'graph'));
      await graphAtRest(page);

      for (const [edge, state, role] of [
        ['e0', 'done', 'edge-done'],
        ['e5', 'idle', 'hairline-strong'],
      ] as const) {
        await expect(
          page.locator(`.react-flow__edge[data-id="${edge}"] .wire`),
        ).toHaveAttribute('data-state', state);

        const actual = await strokeOf(page, edge);
        const expected = colourOf(theme, role);

        expect(
          sameColour(actual, expected),
          `${edge} in ${theme}: ${actual} ≠ ${expected}`,
        ).toBe(true);
      }
    });

    /**
     * The graph is read with a pointer. A keyboard
     * reads the run in the trace, where every row is
     * a control, so no block or wire here is a stop
     * on the way there. And nothing on the board
     * speaks the library's own English: its
     * instructions are for a board somebody edits.
     */
    test(`is no tab stop and speaks no library English in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(GOING, 'graph'), theme);
      await graphAtRest(page);

      await expect(page.locator('.react-flow__node')).toHaveCount(7);
      await expect(page.locator('.react-flow__edge')).toHaveCount(6);

      await expect(
        page.locator(
          '.react-flow__node[tabindex], .react-flow__edge[tabindex]',
        ),
      ).toHaveCount(0);
      await expect(
        page.locator('[aria-describedby^="react-flow__"]'),
      ).toHaveCount(0);
      await expect(page.getByRole('group', { name: /Edge from/ })).toHaveCount(
        0,
      );
      await expect(page.getByRole('img', { name: /Edge from/ })).toHaveCount(0);
    });
  }
});

/** A duration as the host words one: one unit, or
 *  two where the second says how precise the first
 *  is. */
const LASTED =
  /^(\d+ ms|\d+\.\d s|\d+ m( \d+ s)?|\d+ h( \d+ m)?|\d+ d( \d+ h)?)$/;

/** The canonical run, its trace and the one row no
 *  block owns. */
const TRACED = seeRun({ trace: TRACE, unattributed: UNATTRIBUTED });

/** The top-level rows of the trace, in order. */
function traceRows(page: Page): Locator {
  return page.locator('[data-trace] > li');
}

/** The colour the spine is drawn in below one row,
 *  or nothing where the row draws none. */
function connectorOf(row: Locator): Promise<string | undefined> {
  return row.evaluate((li) => {
    const line = li.querySelector(':scope > .trace-spine > .trace-connector');

    return line === null ? undefined : getComputedStyle(line).borderLeftColor;
  });
}

/**
 * What the run did, in the order it did it.
 *
 * One list, one recorded operation to a row: a
 * mark saying how it went, the name the ledger
 * recorded, how long it took and one line about
 * it. The graph answers where; this answers what
 * happened, in order, and says it once.
 */
test.describe('the run tab’s trace', () => {
  test('draws each operation with its mark, name, time and line', async ({
    page,
  }) => {
    await showRun(page, seeInit(TRACED));

    await expect(page.locator('[data-trace-op]')).toHaveCount(5);
    await expect(page.locator('[data-trace]')).toHaveCount(1);

    const rows = traceRows(page);
    await expect(rows).toHaveCount(4);

    const mono = await page
      .locator('[data-pane="trace"] .field-hint')
      .evaluate((hint) => getComputedStyle(hint).fontFamily);

    for (const row of await rows.all()) {
      const op = row.locator(':scope > button.trace-op');

      await expect(row.locator('.status-glyph[data-glyph="dot"]')).toHaveCount(
        1,
      );
      await expect(op).toHaveCount(1);
      await expect(op.locator('.trace-name')).toHaveCount(1);
      await expect(op.locator('.trace-name')).toHaveCSS('font-family', mono);
      await expect(op.locator('.trace-detail')).toHaveCount(1);
      await expect(op.locator('.trace-duration')).toHaveCount(1);
      await expect(op.locator('.trace-duration')).toHaveText(LASTED);

      // The text itself at the end of the name's own
      // line: not under it, and not after it in a box
      // that happens to reach the edge.
      const { right, inside, middle, line } = await op.evaluate((button) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        const inked = (selector: string): DOMRect => {
          const range = document.createRange();
          const node = button.querySelector(selector);

          if (node !== null) range.selectNodeContents(node);

          return range.getBoundingClientRect();
        };
        const time = inked('.trace-duration');
        const name = inked('.trace-name');

        return {
          right: time.right,
          inside:
            box.right -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderRightWidth),
          middle: time.top + time.height / 2,
          line: { top: name.top, bottom: name.bottom },
        };
      });

      expect(Math.abs(right - inside)).toBeLessThanOrEqual(1);
      expect(middle).toBeGreaterThan(line.top);
      expect(middle).toBeLessThan(line.bottom);
    }

    for (const gone of [
      '.chips',
      '.chart',
      'table.raw',
      'details',
      '[data-raw-toggle]',
    ]) {
      await expect(page.locator(gone)).toHaveCount(0);
    }

    await expect(page.locator('[data-owner="sdk"]')).toHaveCount(0);
    await page.locator('[data-sdk-rows]').click();
    await expect(page.locator('[data-owner="sdk"]')).toHaveCount(2);
  });

  /**
   * One line about a row, whatever the run wrote
   * there. A step that returned a document turned its
   * row into a paragraph and pushed every row after
   * it off the pane; the line is cut at its end
   * instead, and the whole value is in the
   * Inspector's evidence once the row is picked.
   */
  test('keeps a long recorded value to one line under its row', async ({
    page,
  }) => {
    const value = 'x'.repeat(2000);

    await showRun(
      page,
      seeInit(
        seeRun({
          trace: TRACE.slice(0, 2).map((row) => ({
            ...row,
            detail: { ...row.detail, verbatim: value },
          })),
        }),
      ),
    );

    const lines = page.locator('[data-trace-op] .trace-detail');
    await expect(lines).toHaveCount(2);

    const drawn = await lines.evaluateAll((details) =>
      details.map((line) => ({
        height: line.getBoundingClientRect().height,
        leading: parseFloat(getComputedStyle(line).lineHeight),
        cut: line.scrollWidth > line.clientWidth,
        kept: line.querySelector('[data-verbatim]')?.textContent?.length ?? 0,
      })),
    );

    for (const [at, line] of drawn.entries()) {
      expect(
        line.height,
        `row ${at}: ${line.height}px against a ${line.leading}px line`,
      ).toBeLessThanOrEqual(line.leading + 1);
      expect(line.cut, `row ${at} runs past its box`).toBe(true);
      expect(line.kept, `row ${at} keeps the whole value`).toBe(value.length);
    }
  });

  /**
   * The row is already a button that picks the
   * operation, so the way to the run a start began
   * and the way to the SDK's rows sit beside it: a
   * button inside a button is one click meaning two
   * things.
   */
  test('keeps a row’s other controls beside it, not inside it', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          trace: [
            ...QUEUED_TRACE,
            ...TRACE.filter((row) => row.sdk.length > 0),
          ],
        }),
      ),
    );
    await page.locator('[data-sdk-rows]').click();

    const rows = page.locator('[data-trace] > li');

    await expect(rows.locator(':scope > button.trace-op')).toHaveCount(2);
    await expect(rows.locator(':scope > button[data-run-select]')).toHaveCount(
      1,
    );
    await expect(rows.locator(':scope > button[data-sdk-rows]')).toHaveCount(1);
    await expect(page.locator('button')).not.toHaveCount(0);
    await expect(page.locator('button button, button a, a button')).toHaveCount(
      0,
    );
  });

  /**
   * Picking a row is picking what the Inspector
   * draws, the SDK's own rows included. Opening a
   * block's SDK rows is the page's own business and
   * asks the extension for nothing; a row picked
   * under one opens it wherever the pick came from.
   */
  test('picks a row, the SDK’s own included', async ({ page }) => {
    const harness = await showRun(page, seeInit(TRACED));

    await page.locator('[data-trace-op="0"]').click();

    const open = page.locator('[data-sdk-rows]');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');

    await page.locator('[data-trace-op="4"]').click();

    expect(
      (await harness.posted()).filter(
        (message) => (message as { type: string }).type !== 'ready',
      ),
    ).toEqual([
      { type: 'stepSelect', functionId: 0 },
      { type: 'stepSelect', functionId: 4 },
    ]);

    await showRun(
      page,
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'find_slot', functionId: 4 },
        }),
      ),
    );

    await expect(page.locator('[data-trace-op="4"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-sdk-rows]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  /**
   * A pick can arrive after the page is drawn: the
   * extension answers a block picked somewhere else
   * with a repaint naming one of its rows. Where that
   * row is folded away, the fold holding it opens,
   * because a row marked as the one being read inside
   * a closed disclosure is a mark nobody can find.
   */
  test('opens the fold holding a row picked after the page is drawn', async ({
    page,
  }) => {
    const harness = await showRun(
      page,
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'parse_request', functionId: 0 },
        }),
      ),
    );

    const open = page.locator('[data-sdk-rows]');
    await expect(open).toHaveAttribute('aria-expanded', 'false');

    await harness.show(
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'find_slot', functionId: 4 },
        }),
      ),
    );

    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-trace-op="4"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  /**
   * A block picked on the graph marks the row its
   * evidence is drawn from, and only that one. A
   * block that wrote no row marks none.
   */
  test('marks only the headline row of a picked block', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );

    const ops = page.locator('[data-trace-op]');
    await expect(ops).toHaveCount(5);

    const marked = page.locator('[data-trace-op][aria-current="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveAttribute('data-trace-op', '1');

    await showRun(
      page,
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'booking_requested', functionId: undefined },
        }),
      ),
    );

    await expect(ops).toHaveCount(5);
    await expect(marked).toHaveCount(0);
  });

  /**
   * A row naming a block the saved workflow does not
   * have belongs to no block, so it is drawn apart
   * under a label that says so. It picks nothing,
   * because there is nothing for the Inspector to
   * draw about it — so it is text, not a control.
   */
  test('draws a row no block owns as text under its own label', async ({
    page,
  }) => {
    const harness = await showRun(page, seeInit(TRACED));

    const apart = page.locator('[data-unattributed]');
    await expect(apart.locator('.section-label')).toHaveText(
      seeStrings.unattributed,
    );

    const rows = apart.locator('li[data-trace-group=""]');
    await expect(rows).toHaveCount(1);

    const op = rows.locator('[data-trace-op]');
    await expect(op).toHaveAttribute('data-trace-op', '6');
    expect(await op.evaluate((row) => row.tagName)).not.toBe('BUTTON');
    await expect(op).not.toHaveClass(/\btrace-op\b/);
    await expect(page.getByRole('button', { name: /gone_away/ })).toHaveCount(
      0,
    );

    await op.click();

    expect(await harness.posted()).toEqual([{ type: 'ready' }]);
  });

  /**
   * A run whose workflow the project has lost wrote
   * rows, but there is no block left to draw any of
   * them under. Heading an empty list "trace", over a
   * line telling the reader to pick a row, promises
   * two things that are not there: the rows that
   * exist are the ones no block owns, and they pick
   * nothing. So the label the rows are under is the
   * only label, and the line about picking is gone
   * with the rows it was about.
   */
  test('draws a run whose document is gone as its unattributed rows alone', async ({
    page,
  }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          trace: [],
          unattributed: UNATTRIBUTED.flatMap((row) => [
            row,
            { ...row, functionId: row.functionId + 1, name: 'also_gone' },
          ]),
        }),
      ),
    );

    await expect(
      page.locator('[data-unattributed] [data-trace-op]'),
    ).toHaveCount(2);

    await expect(page.locator('.execution-trace .section-label')).toHaveText([
      seeStrings.unattributed,
    ]);
    await expect(page.getByText(seeStrings.traceHint)).toHaveCount(0);
    await expect(page.locator('[data-trace]')).toHaveCount(0);
  });

  /**
   * What the page worked out and what the run wrote
   * down are different claims. A word the page
   * derived says so; a value the run recorded is
   * kept apart from the words around it.
   */
  test('marks worked-out words derived and a value as recorded', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ trace: REPLAYED_TRACE })));

    await expect(
      page.locator('[data-trace-op="0"] [data-provenance="derived"]'),
    ).toHaveText(`${seeStrings.reused} ·`);

    const failed = page.locator('[data-trace-op="1"] .trace-detail');
    await expect(failed.locator('[data-verbatim]')).toHaveText('no slot left');
    await expect(failed).toHaveText('TypeError · no slot left');
    await expect(failed.locator('[data-verbatim]')).not.toContainText(
      'TypeError',
    );

    await expect(page.locator('[data-provenance]')).not.toHaveCount(0);
    await expect(page.locator('.provenance')).toHaveCount(0);
  });

  /**
   * A timeout the SDK set is a moment the page read
   * off a row, not something that has happened, so
   * it is said as worked out — and said as a
   * moment, never as the number the SDK stored.
   */
  test('says a parked block gives up, and that it worked it out', async ({
    page,
  }) => {
    await showRun(page, seeInit(TRACED));
    await page.locator('[data-sdk-rows]').click();

    const sleep = page.locator('[data-trace-op="4"]');
    await expect(sleep.locator('[data-provenance="derived"]')).toHaveText(
      'times out 14:04:11.000',
    );
    await expect(sleep.locator('[data-verbatim]')).toHaveCount(0);
  });

  /**
   * A row a replay carried over is the earlier run's
   * work, kept, and the row says so before what it
   * returned.
   */
  test('marks a reused row reused', async ({ page }) => {
    await showRun(page, seeInit(seeRun({ trace: REPLAYED_TRACE })));

    const carried = page.locator('[data-trace-op="0"]');
    await expect(carried).toHaveAttribute('data-reuse', 'recorded');
    await expect(carried).toContainText(seeStrings.reused);

    await expect(page.locator('[data-trace-op="1"]')).toHaveAttribute(
      'data-reuse',
      'own',
    );
  });

  /**
   * Every row names the block it is drawn under, and
   * whose row it is: the block's own, or the SDK's
   * beside it.
   */
  test('marks the row a block belongs to', async ({ page }) => {
    await showRun(
      page,
      seeInit(
        seeRun({
          ...TRACED,
          selected: { nodeId: 'find_slot', functionId: 1 },
        }),
      ),
    );
    await page.locator('[data-sdk-rows]').click();

    const block = page.locator('[data-trace-group="find_slot"]');
    await expect(block).toHaveCount(2);
    await expect(
      block.locator(':scope > button.trace-op[data-owner="node"]'),
    ).toHaveCount(2);
    await expect(block.locator('[data-owner="sdk"]')).toHaveCount(2);
    await expect(
      page.locator('[data-trace-group="find_slot"] [aria-current="true"]'),
    ).toHaveAttribute('data-trace-op', '1');
  });

  /**
   * What a queued item did is a run of its own, with
   * its own rows and its own page. All the parent's
   * ledger holds of it is the id, so the id is the
   * way there — said short, and whole where a
   * pointer asks.
   */
  test('offers the run a queued item started', async ({ page }) => {
    const harness = await showRun(
      page,
      seeInit(seeRun({ trace: QUEUED_TRACE })),
    );

    const open = page.locator('[data-run-select="wf_child_9f21"]');
    const short = open.locator('[data-short-run]');

    await expect(short).toHaveText(shortRunId('wf_child_9f21'));
    await expect(short).toHaveAttribute('title', 'wf_child_9f21');
    await expect(open).toHaveAttribute('data-variant', 'quiet');

    await open.click();

    expect(await harness.postedOfType('runSelect')).toEqual([
      { type: 'runSelect', workflowId: 'wf_child_9f21' },
    ]);
    expect(await harness.postedOfType('stepSelect')).toEqual([]);
  });

  /** A row that started nothing offers nothing. */
  test('offers none where no run was started', async ({ page }) => {
    await showRun(page, seeInit(TRACED));

    await expect(traceRows(page)).toHaveCount(4);
    await expect(page.locator('[data-run-select]')).toHaveCount(0);
  });

  /**
   * A row that threw, a row inside a wait, a row the
   * run is still sitting on, a row the SDK wrote:
   * none of them is a point a replay can begin at,
   * and each says why on the row itself.
   */
  test('says why a row is not offered as a boundary', async ({ page }) => {
    await showRun(page, seeInit(TRACED));

    const parked = page.locator('[data-trace-op="5"]');
    await expect(parked).toHaveAttribute('data-replayable', 'false');
    await expect(parked).toHaveAttribute(
      'title',
      'The run is sitting here now.',
    );

    const first = page.locator('[data-trace-op="0"]');
    await expect(first).toHaveAttribute('data-replayable', 'true');
    await expect(first).not.toHaveAttribute('title');

    await page.locator('[data-sdk-rows]').click();

    const sdk = page.locator('[data-trace-op="4"]');
    await expect(sdk).toHaveAttribute('data-replayable', 'false');
    await expect(sdk).toHaveAttribute('title', SDK_OWNED);
  });

  /**
   * A run that wrote nothing yet says so where the
   * rows would be, rather than drawing an empty
   * list under a label.
   */
  test('says a run that recorded nothing has nothing to draw', async ({
    page,
  }) => {
    await showRun(page, seeInit(seeRun({ trace: [], unattributed: [] })));

    await expect(
      page.locator('[data-pane="trace"] .empty-state .empty-title'),
    ).toHaveText(seeStrings.noOperations);
    await expect(page.locator('[data-trace-op]')).toHaveCount(0);
  });

  /**
   * A block's SDK rows are there for somebody
   * debugging the ledger, so they are folded under a
   * quiet control that says what it holds and whether
   * it is open. The control keeps the focus ring
   * every control has.
   */
  test('folds a block’s SDK rows under a quiet, focusable control', async ({
    page,
  }) => {
    const harness = await showRun(page, seeInit(TRACED));

    const open = page.locator('[data-sdk-rows]');
    await expect(open).toHaveText('findSlot · 2 durable operations');
    await expect(open).toHaveAttribute('data-variant', 'quiet');
    await expect(open).toHaveAttribute('data-mono', '');
    await expect(open).toHaveAttribute('aria-expanded', 'false');

    await open.focus();
    await expect(open).not.toHaveCSS('outline-style', 'none');
    await expect(open).toHaveCSS('letter-spacing', 'normal');

    const sdk = page.locator('button.trace-op[data-owner="sdk"]');
    await expect(sdk).toHaveCount(0);

    await page.keyboard.press('Enter');

    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(sdk).toHaveCount(2);
    await expect(sdk.nth(0)).toHaveText(/^├─/);
    await expect(sdk.nth(1)).toHaveText(/^└─/);
    expect(await harness.postedOfType('stepSelect')).toEqual([]);
  });

  for (const theme of THEMES_ALL) {
    /**
     * Boxes are earned: a row has no ground until it
     * is the one picked, and a pointer over it.
     */
    test(`leaves a row’s ground clear until it is picked in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit(TRACED), theme);

      const resting = page.locator(
        'button.trace-op:not([aria-current="true"])',
      );
      await expect(resting).toHaveCount(3);

      const grounds = await resting.evaluateAll((rows) =>
        rows.map((row) => getComputedStyle(row).backgroundColor),
      );

      expect([...new Set(grounds)]).toEqual(['rgba(0, 0, 0, 0)']);
    });

    /**
     * The spine between two rows says what happened
     * between them: the failure colour below a row
     * that threw, a pending line into a row that is
     * still waiting and below the last row of a run
     * that is still going, and the finished edge
     * everywhere else. A run that is over draws
     * nothing below its last row.
     */
    test(`tones the spine by what happened between rows in ${theme}`, async ({
      page,
    }) => {
      await showRun(page, seeInit({ ...TRACED, live: RUNNING }), theme);

      const rows = traceRows(page);
      await expect(rows).toHaveCount(4);

      const expected: (Role | undefined)[] = [
        'edge-done',
        'fail',
        'hairline-strong',
        'hairline-strong',
      ];

      for (const [at, role] of expected.entries()) {
        const drawn = await connectorOf(rows.nth(at));
        const wanted = role === undefined ? undefined : colourOf(theme, role);

        expect(
          drawn !== undefined &&
            wanted !== undefined &&
            sameColour(drawn, wanted),
          `row ${at} in ${theme}: ${drawn} ≠ ${wanted}`,
        ).toBe(true);
      }

      await showRun(
        page,
        seeInit({
          ...TRACED,
          trace: TRACE.map((row) =>
            row.state === 'waiting' ? { ...row, state: 'done' } : row,
          ),
          live: liveRun({ ...RUNNING, status: 'SUCCESS', outcome: 'done' }),
        }),
        theme,
      );

      await expect(rows).toHaveCount(4);

      const settled = await connectorOf(rows.nth(2));
      expect(
        settled !== undefined &&
          sameColour(settled, colourOf(theme, 'edge-done')),
        `row 2 of a finished run in ${theme}: ${settled}`,
      ).toBe(true);
      expect(await connectorOf(rows.nth(3))).toBeUndefined();
    });
  }
});
