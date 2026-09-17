import { expect, test, type Page } from '@playwright/test';

import type { SeeRun } from '../../src/webview/protocol.js';

import { GRID } from '../../src/canvas/grid.js';
import { filled } from '../../src/webview/fill.js';

import { LIBRARY_COLOURS } from './fixtures/library.js';
import {
  GRAPH,
  NO_SAVED_WORKFLOW,
  QUEUED,
  QUEUED_GRAPH,
  RUNNING,
  RUNNING_GRAPH,
  graphAtRest,
  seeInit,
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
