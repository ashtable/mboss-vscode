import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  expect,
  test,
  type JSHandle,
  type Locator,
  type Page,
} from '@playwright/test';

import { DIST } from '../../src/build.js';

import { GRID } from '../../src/canvas/grid.js';
import {
  NODE_PALETTE,
  nodeSize,
  validateWorkflow,
  type NodeKind,
  type WorkflowIR,
} from '../../src/core/rules.js';
import { liveStep } from '../../src/test-support/runs.js';
import { shortRunId } from '../../src/webview/ids.js';
import type { CanvasInit } from '../../src/webview/protocol.js';

import {
  IN_FLIGHT,
  RECORDED_AT,
  boxes,
  canvasInit,
  clickWire,
  holdWire,
  ir,
  manifest,
  openCanvas,
  openEveryKind,
  pickWire,
  queuedRun,
  recording,
  runOf,
  showing,
  slugOf,
  sourceHandle,
} from './fixtures/canvas.js';
import { LIBRARY_COLOURS } from './fixtures/library.js';
import { graphAtRest } from './fixtures/runs.js';
import { mount, THEMES_ALL, type ThemeKind } from './harness.js';
import { colourOf, sameColour, type Role } from './palette.js';
import { settled } from './sweep.js';
import { canvasWords as canvasStrings } from './words.js';

/**
 * The canvas, driven — the palette and the graph,
 * which are one bundle and one message.
 *
 * Selecting a block is a round trip: the canvas
 * says which one, and the host sends the canvas
 * back with that block marked. The specs below play
 * the host's half. What the block does is drawn in
 * the Inspector, and asked in its own spec.
 *
 * The words the view draws are the ones sent in
 * below, not the ones the extension resolves. That
 * the host resolves the right ones — and that a
 * webview contains none of its own — is checked
 * where the host is, and by the bundle scan at the
 * bottom of this file.
 */

/**
 * The same page, with nothing on it still moving.
 *
 * A block's edge, its shadow and its lift are
 * transitioned, and a block a run is at breathes
 * for as long as the run lasts — so a style read
 * while any of that is in flight is a number
 * nobody chose. Somebody who asked for less
 * movement is shown the value the sheet settles
 * on, and that is the value worth holding.
 */
async function openAtRest(
  page: Page,
  over: Partial<CanvasInit> = {},
  theme: ThemeKind = 'light',
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const harness = await mount(page, 'canvas', theme);
  await harness.show(canvasInit(over));

  return harness;
}

test.describe('the palette', () => {
  test('offers every kind the catalog has, in its order', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('[data-palette-kind]')).toHaveText(
      NODE_PALETTE.map((entry) => entry.label),
    );
  });

  /**
   * One label over one list. The catalog's order is
   * what carries the grouping, and four headings
   * over three rows each spent more of a rail this
   * narrow than the grouping was worth.
   */
  test('draws them as one list under one label', async ({ page }) => {
    await openCanvas(page);

    const parts = await page
      .locator('.palette')
      .evaluate((rail) =>
        [...rail.querySelectorAll('.section-label, [data-palette-kind]')].map(
          (part) =>
            part.getAttribute('data-palette-kind') ??
            `label: ${part.textContent ?? ''}`,
        ),
      );

    expect(parts).toEqual([
      `label: ${canvasStrings.blocks}`,
      ...NODE_PALETTE.map((entry) => entry.kind),
      `label: ${canvasStrings.lib}`,
    ]);
  });

  /**
   * The same glyph the canvas draws, so a row and
   * the block it turns into are recognisably one
   * thing rather than two lists that happen to be
   * in the same order.
   */
  test('wears the glyph the canvas draws that kind in', async ({ page }) => {
    await openCanvas(page);

    const drawn: Record<string, (string | null)[]> = {};

    for (const { kind } of NODE_PALETTE) {
      const row = page.locator(`[data-palette-kind="${kind}"]`);

      await expect(row.locator('.node-icon')).toHaveCount(1);

      drawn[kind] = await row
        .locator('.node-icon path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
    }

    expect(drawn).toEqual(ICON_PATHS);
  });

  /**
   * A rail of filled boxes reads as eleven controls.
   * A rail of words under a glyph reads as a list of
   * what can go on the canvas, which is what it is —
   * so the ground arrives under the pointer and
   * nowhere else.
   */
  for (const theme of THEMES_ALL) {
    test(`spends no ground on a row at rest in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const rows = page.locator('[data-palette-kind]');

      await expect(rows).toHaveCount(NODE_PALETTE.length);

      const resting = await rows.evaluateAll((all) =>
        all.map((row) => getComputedStyle(row).backgroundColor),
      );

      expect([...new Set(resting)]).toEqual(['rgba(0, 0, 0, 0)']);

      // And the ground is really there to arrive:
      // a rail with no hover rule at all would pass
      // the read above and say nothing.
      await rows.first().hover();

      const hovered = await rows
        .first()
        .evaluate((row) => getComputedStyle(row).backgroundColor);

      expect(hovered).not.toBe('rgba(0, 0, 0, 0)');
    });
  }

  test('lists the code-behind under it, with each signature', async ({
    page,
  }) => {
    await openCanvas(page);

    await expect(page.locator('[data-lib-fn]')).toHaveCount(
      manifest.functions.length,
    );

    const parse = page.locator('[data-lib-fn="parseRequest"]');

    await expect(parse).toContainText('WebhookEvent → BookingReq');
    await expect(parse).toHaveAttribute(
      'title',
      manifest.functions.find((fn) => fn.export === 'parseRequest')!.doc!,
    );
  });

  test('says so plainly when nothing has been scanned', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ manifest: undefined }));

    await expect(page.locator('.palette .empty-state .empty-title')).toHaveText(
      canvasStrings.noLib,
    );
    await expect(page.locator('[data-lib-fn]')).toHaveCount(0);
  });
});

test.describe('the graph', () => {
  test('draws the fixture where core laid it out', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('.react-flow__node')).toHaveCount(
      ir.nodes.length,
    );

    // Read back through the viewport transform, so
    // this is about where the node was placed and
    // not about where the graph happens to be
    // scrolled to.
    for (const node of ir.nodes) {
      expect(await flowPosition(page, node.id)).toEqual({
        x: boxes[node.id]!.x,
        y: boxes[node.id]!.y,
      });
    }
  });

  /**
   * At the spacing a block lands on, not at one of
   * its own. Dots a block never comes to rest on
   * are a grid a person cannot use to line anything
   * up, which is worse than no grid at all.
   *
   * Read back through the zoom, because the pattern
   * is painted in screen pixels and the grid is a
   * fact about the graph's own coordinates.
   */
  test('is plotted on the dot grid a block lands on', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('.react-flow__background')).toBeVisible();
    await expect(
      page.locator('.react-flow__background pattern circle').first(),
    ).toBeAttached();

    const painted = Number(
      await page
        .locator('.react-flow__background pattern')
        .first()
        .getAttribute('width'),
    );

    // To the pixel, because the zoom is read back
    // out of a transform the browser has already
    // rounded to write it down.
    expect(Math.round(painted / (await zoom(page)))).toBe(GRID);
  });

  /**
   * The two faces are vendored because a webview
   * cannot reach a font host: `font-src` is the
   * extension's own origin and nothing else. So a
   * face that failed to ship does not fail — the
   * panel is simply set in whatever the platform
   * had, and only asking the page whether the face
   * loaded will say so.
   */
  test('is set in the faces the extension ships', async ({ page }) => {
    await openCanvas(page);

    // The loaded set, not `fonts.check`: a family
    // nothing declares falls back to the platform's
    // and checks out fine, which is the exact
    // failure this is about.
    expect(
      await page.evaluate(async () => {
        await document.fonts.ready;

        return [...document.fonts]
          .filter((face) => face.status === 'loaded')
          .map((face) => face.family)
          .sort();
      }),
    ).toEqual(['Albert Sans', 'Spline Sans Mono']);
  });

  test('captions itself with the document’s own revision', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('[data-caption="graph"]')).toHaveText(
      `groom_booking · graph v${ir.revision}`,
    );
  });

  /**
   * Which outcome a wire carries is worth reading
   * where a block has more than one; on a graph
   * where every block has one way out it would be
   * eleven wires wearing the word `out`.
   */
  test('names the port a wire leaves by, where there was a choice', async ({
    page,
  }) => {
    await openCanvas(page);

    await expect(page.locator('[data-edge-port="e9"]')).toHaveText('book_it');
    await expect(page.locator('[data-edge-port="e4"]')).toHaveText('yes');
    await expect(page.locator('[data-edge-port="e2"]')).toHaveCount(0);
  });

  /**
   * Every wire out of a block leaves by the same
   * dot, so a name written where a wire leaves would
   * be written on top of the name beside it. They go
   * half way along instead, by which point the wires
   * have separated.
   */
  test('keeps two names out of one block apart', async ({ page }) => {
    await openCanvas(page);

    const yes = (await page.locator('[data-edge-port="e4"]').boundingBox())!;
    const no = (await page.locator('[data-edge-port="e5"]').boundingBox())!;

    expect(Math.abs(yes.x - no.x) + Math.abs(yes.y - no.y)).toBeGreaterThan(20);
  });

  /**
   * And off the blocks. A branch leg that runs a
   * long way down the column has its half-way point
   * behind whatever it passes, so a name written
   * there lands on that block's own title — two
   * sentences in one place, and the one underneath
   * belongs to a block the wire has nothing to do
   * with.
   */
  test('keeps every name off the blocks it passes', async ({ page }) => {
    await openCanvas(page);

    // The graph fits itself to its pane a frame or
    // two after the view opens, and a rectangle read
    // before that is a rectangle of nothing.
    await expect(page.locator('.wire-port')).toHaveCount(4);

    const overlaps = await page.evaluate(() => {
      const boxOf = (element: Element): DOMRect =>
        element.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.react-flow__node .node')];

      return [...document.querySelectorAll('.wire-port')].flatMap((name) => {
        const over = boxOf(name);

        return blocks
          .filter((block) => {
            const under = boxOf(block);

            return (
              over.left < under.right &&
              over.right > under.left &&
              over.top < under.bottom &&
              over.bottom > under.top
            );
          })
          .map(
            (block) =>
              `${name.textContent} over ${
                (block.closest('.react-flow__node') as HTMLElement).dataset.id
              }`,
          );
      });
    });

    expect(overlaps).toEqual([]);
  });

  test('draws the loop-closing wire against the flow', async ({ page }) => {
    await openCanvas(page);

    await expect(
      page.locator('.react-flow__edge[data-id="e8"] .wire-back'),
    ).toBeAttached();
    await expect(
      page.locator('.react-flow__edge[data-id="e7"] .wire-back'),
    ).toHaveCount(0);
  });

  /**
   * A marker is referenced by id, so a wire whose
   * id names nothing draws a line with no head on
   * it and says nothing about that at all. The
   * state comes back off the same element, because
   * everything a run will colour hangs off it.
   */
  test('points each wire at the block it feeds', async ({ page }) => {
    await openCanvas(page);

    const drawn = await page
      .locator('.react-flow__edge[data-id="e2"] .wire')
      .evaluate((wire) => ({
        marker: wire.getAttribute('marker-end'),
        state: wire.getAttribute('data-state'),
      }));

    expect(drawn).toEqual({
      marker: 'url(#wire-arrow-idle)',
      state: 'idle',
    });
    await expect(page.locator('#wire-arrow-idle')).toBeAttached();

    // An open chevron rather than a filled
    // triangle: the head is stroked in the colour
    // of the line it ends, so the two cannot
    // disagree about what happened along it.
    await expect(page.locator('#wire-arrow-idle path')).toHaveCSS(
      'fill',
      'none',
    );
  });

  /**
   * What a keyboard on this board is told is this
   * product's, in the language the editor is running
   * in. The graph library describes its own keyboard
   * otherwise — in English, and in terms of a press
   * that selects and an escape that calls a deletion
   * off, neither of which this board has.
   *
   * Read off the elements the blocks and wires
   * actually point at rather than off what was
   * passed in: the library keeps two node
   * descriptions and picks between them by a flag,
   * so a sentence sent under the other key would be
   * a sentence nobody hears.
   */
  test('tells a keyboard about this board and not the library’s', async ({
    page,
  }) => {
    await openCanvas(page);

    const said = async (from: Locator): Promise<string> => {
      const named = await from.getAttribute('aria-describedby');

      expect(named).not.toBeNull();

      return page.locator(`#${named ?? ''}`).innerText();
    };

    expect(
      await said(page.locator('.react-flow__node[data-id="find_slot"]')),
    ).toBe(canvasStrings.ariaLabels['node.a11yDescription.default']);

    expect(await said(page.locator('.react-flow__edge[data-id="e2"]'))).toBe(
      canvasStrings.ariaLabels['edge.a11yDescription.default'],
    );
  });
});

/**
 * The glyph each kind is drawn in, written out.
 *
 * Distinct glyphs are not right ones: a Loop
 * wearing the Trigger's bolt differs from
 * everything else on the canvas and is still
 * wrong. These say which is which, so that
 * changing one is something somebody decides
 * rather than something that happens.
 */
const ICON_PATHS: Record<NodeKind, readonly string[]> = {
  trigger: [
    'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  ],
  step: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  transaction: [
    'M3 5v14a9 3 0 0 0 18 0V5',
    'M3 12a9 3 0 0 0 18 0',
    'M21 5a9 3 0 0 1-18 0 9 3 0 0 1 18 0Z',
  ],
  apiCall: [
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
    'M2 12h20',
  ],
  branch: [
    'M16 3h5v5',
    'M8 3H3v5',
    'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3',
    'm15 9 6-6',
  ],
  loop: [
    'm17 2 4 4-4 4',
    'M3 11v-1a4 4 0 0 1 4-4h14',
    'm7 22-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ],
  durableWait: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2'],
  approval: [
    'm16 11 2 2 4-4',
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  ],
  emailSend: [
    'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z',
    'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7',
  ],
  codeStep: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  queue: [
    'M2 12q2.5 2 5 0t5 0 5 0 5 0',
    'M2 19q2.5 2 5 0t5 0 5 0 5 0',
    'M2 5q2.5 2 5 0t5 0 5 0 5 0',
  ],
};

/**
 * A block says four things and no more: what kind
 * it is, what it is called, which code runs there,
 * and what is happening to it. Everything the
 * drawing used to carry beside those — the id, the
 * config lines, the type chip on every wire, a
 * square at every port — was detail a person
 * reading a canvas across a room cannot use.
 */
test.describe('one block', () => {
  test('wears a glyph of its own kind, and no kind wears two', async ({
    page,
  }) => {
    await openEveryKind(page);

    const glyphs = await page
      .locator('.react-flow__node .node-icon svg')
      .evaluateAll((icons) =>
        icons.map((icon) =>
          [...icon.querySelectorAll('path')]
            .map((path) => path.getAttribute('d'))
            .join(' '),
        ),
      );

    expect(glyphs).toHaveLength(NODE_PALETTE.length);
    expect(new Set(glyphs).size).toBe(NODE_PALETTE.length);
  });

  test('draws each kind in the glyph chosen for it', async ({ page }) => {
    await openEveryKind(page);

    const drawn: Record<string, (string | null)[]> = {};

    for (const { kind } of NODE_PALETTE) {
      drawn[kind] = await nodeBody(page, slugOf(kind))
        .locator('.node-icon path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
    }

    expect(drawn).toEqual(ICON_PATHS);
  });

  /**
   * A kind the graph has no component for is not a
   * compile error — React Flow draws its own
   * default node instead, which has none of a
   * block's parts. So this asks for the face and
   * not only for the glyph.
   */
  test('draws a queue block as a block, not a bare node', async ({ page }) => {
    await openEveryKind(page);

    const body = nodeBody(page, 'queue');

    await expect(body.locator('.node-title')).toHaveText('Queue');
    await expect(body.locator('.node-icon path')).toHaveCount(
      ICON_PATHS.queue.length,
    );
  });

  /**
   * A path the browser cannot parse is dropped in
   * silence. The glyph comes out missing a stroke,
   * which reads as a slightly different icon rather
   * than as a broken one, and the console is the
   * only place it is ever mentioned.
   */
  test('draws them all without the browser refusing a stroke', async ({
    page,
  }) => {
    const complaints: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') complaints.push(message.text());
    });

    await openEveryKind(page);

    await expect(page.locator('.react-flow__node .node-icon svg')).toHaveCount(
      NODE_PALETTE.length,
    );
    expect(complaints).toEqual([]);
  });

  test('names the function it runs', async ({ page }) => {
    await openCanvas(page);

    await expect(nodeLine(page, 'parse_request')).toHaveText('ƒ parseRequest');
  });

  test('says a block that runs code of its own has none yet', async ({
    page,
  }) => {
    await openEveryKind(page);

    await expect(nodeLine(page, 'step')).toHaveText('step · unassigned');
    await expect(nodeLine(page, 'branch')).toHaveText('branch · unassigned');
  });

  test('says only what a block that runs no code of its own is', async ({
    page,
  }) => {
    await openEveryKind(page);

    await expect(nodeLine(page, 'loop')).toHaveText('loop');
    await expect(nodeLine(page, 'durable_wait')).toHaveText('durable wait');
  });

  /** Except a trigger, whose kind is not the thing
   *  worth reading about it: how the run gets
   *  started is. */
  test('says how a trigger starts a run', async ({ page }) => {
    await openEveryKind(page);

    await expect(nodeLine(page, 'trigger')).toHaveText(
      `${canvasStrings.kinds.trigger} · ${canvasStrings.triggerPhrases.manual}`,
    );
  });

  /**
   * And says it more quietly. A name is a fact about
   * the block; a gap where a name goes is an absence,
   * and the two read as the same sentence when they
   * are the same grey. The kinds that never take a
   * function are facts too, so they stay at the
   * weight a name is written in.
   */
  test('draws a block still wanting a function fainter', async ({ page }) => {
    await openEveryKind(page);

    for (const id of ['trigger', 'loop']) {
      await expect(nodeLine(page, id)).toHaveCSS(
        'color',
        'color(srgb 0.231373 0.231373 0.231373 / 0.62)',
      );
      await expect(nodeLine(page, id)).toHaveCSS('font-size', '10.01px');
    }

    for (const id of ['step', 'branch']) {
      await expect(nodeLine(page, id)).toHaveCSS(
        'color',
        'color(srgb 0.231373 0.231373 0.231373 / 0.38)',
      );
    }

    await openCanvas(page);

    await expect(nodeLine(page, 'parse_request')).toHaveCSS(
      'color',
      'color(srgb 0.231373 0.231373 0.231373 / 0.62)',
    );
  });

  test('carries nothing else — no id, no config, no type chips', async ({
    page,
  }) => {
    await openCanvas(page);

    const node = page.locator('.react-flow__node[data-id="find_slot"]');

    await expect(node.locator('p')).toHaveText([
      'Find open slot',
      'ƒ findSlot',
    ]);

    // And nothing rides a wire but the way out of a
    // branch. The count is the check: a type chip
    // put back on the canvas would be drawn where
    // these are, so a fifth label on this graph is
    // one of them returning.
    await expect(page.locator('.wire-port')).toHaveCount(4);
    await expect(page.locator('.wire-port')).toHaveText([
      'yes',
      'no',
      'new_time',
      'book_it',
    ]);
  });

  /**
   * Connecting is a drag from a port, so the ports
   * have to be there — out of sight until the
   * pointer is on the block that owns them, or
   * until a wire is already being drawn.
   */
  test('keeps its ports out of sight until they are wanted', async ({
    page,
  }) => {
    await openCanvas(page);

    const handle = sourceHandle(page, 'find_slot', 'out');

    await expect(handle).toHaveCSS('opacity', '0');
    await expect(handle).toHaveCSS('border-radius', '50%');

    await page.locator('.react-flow__node[data-id="find_slot"]').hover();
    await expect(handle).toHaveCSS('opacity', '1');
  });

  /**
   * One dot to leave by, whatever the block does
   * with what leaves.
   *
   * A branch has three ways out and a dot is ten
   * pixels wide and out of sight until a pointer is
   * on the block. Three of those are not something
   * anybody can aim at, so which way out a wire takes
   * is asked once it has landed instead.
   */
  test('has one dot to leave by however many ways out it has', async ({
    page,
  }) => {
    await openCanvas(page);

    const branch = page.locator('.react-flow__node[data-id="reply_decision"]');

    expect(ir.nodes.find((node) => node.id === 'reply_decision')).toMatchObject(
      { kind: 'branch' },
    );

    await expect(branch.locator('.react-flow__handle-bottom')).toHaveCount(1);
    await expect(branch.locator('.react-flow__handle-top')).toHaveCount(1);
  });

  /**
   * Every port on the canvas, not only the ones
   * under the pointer: mid-drag a person is looking
   * for somewhere to land, and a target that only
   * appears once it is already hovered is one they
   * have to find blind.
   */
  test('shows every port while a wire is being drawn', async ({ page }) => {
    await openCanvas(page);

    const landing = targetHandle(page, 'book_appointment');
    await expect(landing).toHaveCSS('opacity', '0');

    const from = (await sourceHandle(page, 'find_slot', 'out').boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });

    await expect(landing).toHaveCSS('opacity', '1');

    await page.mouse.up();
  });

  test('is drawn as proposed while an agent is asking for it', async ({
    page,
  }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        preview: {
          headline: 'PREVIEW',
          banner: undefined,
          warning: undefined,
          proposed: ['await_reply'],
          named: ['Wait for SMS reply'],
          more: undefined,
        },
      }),
    );

    await expect(nodeBody(page, 'await_reply')).toHaveAttribute(
      'data-state',
      'proposed',
    );
    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'dormant',
    );
  });
});

/** An agent's proposal covering one block of the
 *  canonical fixture. */
const proposing = (id: string): CanvasInit['preview'] => ({
  headline: 'PREVIEW',
  banner: undefined,
  warning: undefined,
  proposed: [id],
  named: ['Wait for SMS reply'],
  more: undefined,
});

/** A run parked on a person, at the block that is
 *  waiting for them. */
const PARKED = [
  ['parse_request', 'done'],
  ['find_slot', 'done'],
  ['twilio_chat', 'done'],
  ['await_reply', 'waiting'],
] as const;

/** A run that stopped where it broke. */
const BROKEN = [
  ['parse_request', 'done'],
  ['find_slot', 'failed'],
] as const;

/** The parked run again, with the moment it parked
 *  spelled out: the line under the block reads it
 *  back. */
const WAITING_PARKED = recording(
  [
    liveStep({ name: 'parse_request', nodeId: 'parse_request', functionId: 0 }),
    liveStep({ name: 'twilio_chat', nodeId: 'twilio_chat', functionId: 1 }),
    liveStep({
      name: 'await_reply.register',
      nodeId: 'await_reply',
      state: 'waiting',
      functionId: 2,
      completedAt: RECORDED_AT,
    }),
  ],
  { outcome: 'waiting' },
);

/**
 * The line that block then shows.
 *
 * A shape rather than a string, because the epoch
 * the fixture records reads as a different hour in
 * every zone — but a closed shape: the clock is
 * written out rather than asked of a locale, so
 * nothing is allowed before or after it, and this
 * page runs in a 12-hour one.
 */
const WAITING_LINE = new RegExp(
  `^${canvasStrings.waitingSince.replace(
    '{0}',
    '\\d{2}:\\d{2}:\\d{2}\\.\\d{3}',
  )}$`,
);

/** What a run puts on a block, and what is left of
 *  it once the run has gone past. */
const RUN_STATES = [
  {
    state: 'running',
    edge: 'rgba(0, 0, 0, 0)',
    shadow:
      'rgb(23, 184, 144) 0px 0px 0px 1.5px, color(srgb 0.0901961 0.721569 0.564706 / 0.3) 0px 0px 12px 0px',
  },
  {
    state: 'waiting',
    edge: 'rgba(0, 0, 0, 0)',
    shadow:
      'rgb(233, 162, 59) 0px 0px 0px 1.5px, color(srgb 0.913725 0.635294 0.231373 / 0.3) 0px 0px 12px 0px',
  },
  {
    state: 'failed',
    edge: 'rgba(0, 0, 0, 0)',
    shadow:
      'rgb(238, 93, 104) 0px 0px 0px 1.5px, color(srgb 0.933333 0.364706 0.407843 / 0.28) 0px 0px 12px 0px',
  },
  {
    state: 'done',
    edge: 'color(srgb 0.231373 0.231373 0.231373 / 0.14)',
    shadow: 'rgba(23, 26, 35, 0.05) 0px 1px 2px 0px',
  },
] as const;

/**
 * What a block wears for the state it is in.
 *
 * Colour on this canvas is spent on one thing:
 * what is happening to a block right now. Three of
 * the states are facts about the document and
 * about what a person is looking at, and a block
 * arrives in them from a message. The four a run
 * gives a block have nothing sending them yet, so
 * those are put on the block here the way a run
 * will put them there — what is held below is the
 * sheet, not the plumbing that will reach it.
 *
 * Every value is written out rather than read back
 * off the token it came from. Read back, each
 * check passes whatever the token was changed to,
 * which is the one thing it exists to catch.
 */
test.describe('the state a block is in', () => {
  test('rests on a hairline, barely off the ground', async ({ page }) => {
    await openAtRest(page);

    const block = nodeBody(page, 'find_slot');

    await expect(block).toHaveCSS('border-top-width', '1px');
    await expect(block).toHaveCSS('border-top-style', 'solid');
    await expect(block).toHaveCSS(
      'border-top-color',
      'color(srgb 0.231373 0.231373 0.231373 / 0.14)',
    );
    await expect(block).toHaveCSS(
      'box-shadow',
      'rgba(23, 26, 35, 0.05) 0px 1px 2px 0px',
    );
    await expect(block).toHaveCSS('transform', 'none');

    // And the room inside it. A block whose padding,
    // gap and corner went to nothing would be the
    // cramped, hard-edged box this canvas was drawn
    // to stop being, and every check above it would
    // go on passing.
    await expect(block).toHaveCSS('padding', '8px 12px');
    await expect(block).toHaveCSS('gap', '8px');
    await expect(block).toHaveCSS('border-radius', '10px');
  });

  test('darkens its edge and lifts under the pointer', async ({ page }) => {
    await openAtRest(page);

    const block = nodeBody(page, 'find_slot');
    await block.hover();

    await expect(block).toHaveCSS(
      'border-top-color',
      'color(srgb 0.231373 0.231373 0.231373 / 0.22)',
    );
    await expect(block).toHaveCSS(
      'box-shadow',
      'rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, rgba(23, 26, 35, 0.07) 0px 4px 12px 0px',
    );
    // One pixel up, as the browser spells it. It is
    // the only transform anywhere in this system.
    await expect(block).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -1)');
  });

  test('wears the ring whole when it is the one selected', async ({ page }) => {
    await openAtRest(page, { ...showing('find_slot') });

    const block = nodeBody(page, 'find_slot');

    await expect(block).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    // Four shadows and not one merged value: the
    // ring, the softer ring around it, and the two
    // the block was already sitting on. Selected is
    // lit and still raised.
    await expect(block).toHaveCSS(
      'box-shadow',
      'rgb(83, 103, 255) 0px 0px 0px 1.5px, color(srgb 0.32549 0.403922 1 / 0.18) 0px 0px 0px 5px, rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, rgba(23, 26, 35, 0.07) 0px 4px 12px 0px',
    );
    await expect(block).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -1)');
  });

  test('is dashed and ghosted while an agent is asking for it', async ({
    page,
  }) => {
    await openAtRest(page, { preview: proposing('await_reply') });

    const block = nodeBody(page, 'await_reply');

    await expect(block).toHaveCSS('border-top-style', 'dashed');
    await expect(block).toHaveCSS('border-top-color', 'rgb(149, 103, 255)');
    // The sheet asks for a pixel and a half; a
    // display with whole pixels rounds it down, and
    // it is the dashes that carry the meaning.
    await expect(block).toHaveCSS('border-top-width', '1px');
    // No shadow at all. A block nobody has approved
    // sitting on the same ground as the ones on
    // disk is exactly the confusion the dashes are
    // there to prevent.
    await expect(block).toHaveCSS('box-shadow', 'none');
    await expect(block).toHaveCSS(
      'background-color',
      'color(srgb 0.972549 0.972549 0.972549 / 0.72)',
    );
  });

  test('is the selected one when it is both selected and proposed', async ({
    page,
  }) => {
    await openAtRest(page, {
      ...showing('await_reply'),
      preview: proposing('await_reply'),
    });

    const block = nodeBody(page, 'await_reply');

    // The three treatments never combine. A block
    // wearing a dashed edge and a halo at once says
    // two things a person has to choose between.
    await expect(block).toHaveAttribute('data-state', 'selected');
    await expect(block).toHaveCSS('border-top-style', 'solid');
    await expect(block).toHaveCSS(
      'box-shadow',
      'rgb(83, 103, 255) 0px 0px 0px 1.5px, color(srgb 0.32549 0.403922 1 / 0.18) 0px 0px 0px 5px, rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, rgba(23, 26, 35, 0.07) 0px 4px 12px 0px',
    );
  });

  test('glows where a run is, and wears nothing once it is past', async ({
    page,
  }) => {
    await openAtRest(page);

    const block = nodeBody(page, 'find_slot');

    for (const { state, edge, shadow } of RUN_STATES) {
      await block.evaluate(
        (element, value) => element.setAttribute('data-state', value),
        state,
      );

      await expect(block).toHaveCSS('box-shadow', shadow);
      await expect(block).toHaveCSS('border-top-color', edge);
    }
  });

  /**
   * The glow on the block a run is at is not a
   * fixed shadow but one that swells and falls
   * back, which is the difference between a block
   * that is running and one that stopped in a state
   * worth a colour.
   */
  test('breathes where the run is, and holds still where it is not', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(nodeBody(page, 'twilio_chat')).toHaveCSS(
      'animation-name',
      'sig-breathe',
    );
    await expect(nodeBody(page, 'find_slot')).toHaveCSS(
      'animation-name',
      'none',
    );
  });

  /**
   * Somebody who asked for less movement gets the
   * same picture without it. Read both ways round,
   * because a duration that was never running would
   * pass a check that only reads it afterwards.
   */
  test('collapses that breath for somebody who asked for less movement', async ({
    page,
  }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ run: runOf(IN_FLIGHT) }));

    const block = nodeBody(page, 'twilio_chat');

    await expect(block).toHaveCSS('animation-duration', '2s');

    await page.emulateMedia({ reducedMotion: 'reduce' });

    // A hundredth of a millisecond, as the browser
    // spells it back. Collapsed rather than removed:
    // the block still ends up wearing what the sheet
    // was animating it towards.
    await expect(block).toHaveCSS('animation-duration', '1e-05s');
  });

  /**
   * The same states, arriving the way they really
   * arrive: on the init message, over a graph
   * nobody has touched. What the tones look like is
   * held above — this holds that a run reaches the
   * blocks and the wires at all, including the
   * block it is at, which the ledger never names.
   */
  test('takes its tones from the run the window is following', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'done',
    );
    await expect(nodeBody(page, 'twilio_chat')).toHaveAttribute(
      'data-state',
      'running',
    );
    await expect(wireBody(page, 'e2')).toHaveAttribute('data-state', 'done');
    await expect(wireBody(page, 'e5')).toHaveAttribute('data-state', 'active');
  });
});

/**
 * The mark at the end of a block: what the run did
 * here, in one glyph.
 *
 * The glow says where the run is and the mark says
 * what came of it, and between them a person
 * crossing the room can read a run off the shape of
 * the graph. The block the run is at is the one
 * that matters: it wears a dot and never a tick,
 * because a block that has not finished saying it
 * has is the one thing this set must never do.
 */
test.describe('the mark a run leaves on a block', () => {
  test('ticks a block the run has been through', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const mark = runMark(page, 'find_slot');

    await expect(mark).toHaveText('✓');
    await expect(mark).toHaveCSS('color', 'rgb(23, 184, 144)');
  });

  test('pulses a dot, and no tick, where the run is now', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const mark = runMark(page, 'twilio_chat');

    await expect(mark).toBeEmpty();
    await expect(mark).toHaveCSS('width', '7px');
    await expect(mark).toHaveCSS('height', '7px');
    await expect(mark).toHaveCSS('background-color', 'rgb(23, 184, 144)');
    await expect(mark).toHaveCSS('animation-name', 'sig-pulse');
    await expect(nodeBody(page, 'twilio_chat')).not.toContainText('✓');
  });

  /**
   * A theme that forces its own colours fills the
   * dot with the page's ground and drops the glow
   * round the block, so unless the dot keeps a
   * system colour of its own there, the block a run
   * is at looks like one it has not reached.
   */
  test('keeps the dot where the run is visible when the system forces its colours', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openAtRest(page, { run: runOf(IN_FLIGHT) }, 'high-contrast');

    const mark = runMark(page, 'twilio_chat');

    await expect(mark).toHaveAttribute('data-run', 'running');

    const { fill, ground } = await mark.evaluate((element) => ({
      fill: getComputedStyle(element).backgroundColor,
      ground: getComputedStyle(document.body).backgroundColor,
    }));

    // Against the ground rather than a named colour:
    // the system picks both. Chromium writes an
    // opaque colour as rgb() with no alpha in it.
    const opaque = fill.startsWith('rgb(') && !fill.includes('/');

    expect(opaque && !sameColour(fill, ground), `${fill} on ${ground}`).toBe(
      true,
    );
  });

  test('crosses the block a run stopped at', async ({ page }) => {
    await openAtRest(page, { run: runOf(BROKEN, 'failed') });

    const mark = runMark(page, 'find_slot');

    await expect(mark).toHaveText('✕');
    await expect(mark).toHaveCSS('color', 'rgb(238, 93, 104)');
  });

  /**
   * The tick and the cross are text, so they are
   * drawn in the ink wherever a theme spends no
   * colour on state, as every other toned word is:
   * a voice colour chosen to sit under a word is too
   * light to be one there.
   */
  for (const theme of THEMES_ALL) {
    const toned = (role: 'ok' | 'fail') =>
      colourOf(theme, 'state-ink') || colourOf(theme, role);

    test(`ticks a block in the colour it says it finished in (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, { run: runOf(IN_FLIGHT) }, theme);

      const mark = runMark(page, 'find_slot');

      await expect(mark).toHaveText('✓');

      const colour = await mark.evaluate(
        (element) => getComputedStyle(element).color,
      );

      expect(sameColour(colour, toned('ok')), colour).toBe(true);
    });

    test(`crosses a block in the colour it says it failed in (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, { run: runOf(BROKEN, 'failed') }, theme);

      const mark = runMark(page, 'find_slot');

      await expect(mark).toHaveText('✕');

      const colour = await mark.evaluate(
        (element) => getComputedStyle(element).color,
      );

      expect(sameColour(colour, toned('fail')), colour).toBe(true);
    });
  }

  test('leaves a hollow dot where a run is parked', async ({ page }) => {
    await openAtRest(page, { run: runOf(PARKED, 'waiting') });

    const mark = runMark(page, 'await_reply');

    // Hollow rather than filled, and still rather
    // than turning: nothing is happening at this
    // block, which is exactly what a spinner would
    // deny.
    await expect(mark).toBeEmpty();
    await expect(mark).toHaveCSS('width', '8px');
    await expect(mark).toHaveCSS('height', '8px');
    await expect(mark).toHaveCSS('border-color', 'rgb(233, 162, 59)');
    await expect(mark).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(mark).toHaveCSS('animation-name', 'none');
  });

  /**
   * Two of the marks on this board were worked out
   * rather than read off a row — the dot where the
   * run is, which is derived from the rows either
   * side of it, and the trigger's tick, which is
   * read off there being a run at all. Neither has
   * room for a word, so each carries the admission
   * in its title and says it to a screen reader
   * besides. A derived mark somebody takes for a
   * recorded one is the whole failure mode of a
   * flight recorder.
   */
  test('says which marks it worked out rather than read', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const ahead = runMark(page, 'twilio_chat');

    await expect(ahead).toHaveAttribute('data-run', 'running');
    await expect(ahead).toHaveAttribute('data-provenance', 'derived');
    await expect(ahead).toHaveAttribute('title', canvasStrings.runningDerived);
    await expect(ahead).toHaveAccessibleDescription(
      canvasStrings.runningDerived,
    );

    const started = runMark(page, 'booking_requested');

    await expect(started).toHaveAttribute('data-run', 'done');
    await expect(started).toHaveAttribute('data-provenance', 'derived');
    await expect(started).toHaveAttribute('title', canvasStrings.derived);
    await expect(started).toHaveAccessibleDescription(canvasStrings.derived);
  });

  /** And a mark that came off a row says nothing
   *  about itself, which is what tells a reader the
   *  two apart. */
  test('leaves a recorded mark claiming nothing', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const recorded = runMark(page, 'find_slot');

    await expect(recorded).toHaveText('✓');
    await expect(recorded).not.toHaveAttribute('data-provenance');
    await expect(recorded).not.toHaveAttribute('title');
  });

  /** The mark is the run's, so a canvas nobody is
   *  following a run on carries none — and neither
   *  does a block the run has not reached. */
  test('leaves a block no run has been near unmarked', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(runMark(page, 'record_booking')).toHaveCount(0);

    await openAtRest(page);

    await expect(runMark(page, 'find_slot')).toHaveCount(0);
  });

  /**
   * And a block somebody clicked keeps the mark it
   * earned. The halo is what a click paints, so a
   * block that lost its tick the moment it was asked
   * about would answer the one gesture that should
   * add to what it says by taking something away.
   */
  test('keeps the mark under the halo of a block picked', async ({ page }) => {
    await openAtRest(page, {
      run: runOf(IN_FLIGHT),
      selected: 'find_slot',
    });

    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'selected',
    );

    const mark = runMark(page, 'find_slot');

    await expect(mark).toHaveAttribute('data-run', 'done');
    await expect(mark).toHaveText('✓');
  });

  /**
   * The mark says the block is parked; the line
   * under the title says since when. An absolute
   * moment and never a clock counting up — nothing
   * is happening here, and a number climbing would
   * say the opposite.
   */
  test('says since when a block is waiting', async ({ page }) => {
    await openAtRest(page, { run: WAITING_PARKED });

    const line = nodeLine(page, 'await_reply');

    await expect(line).toHaveAttribute('data-line', 'waiting');
    await expect(line).toHaveText(WAITING_LINE);

    // The block is only as wide as core laid it out,
    // and half a clock is not a moment — so the
    // whole sentence stays reachable however it is
    // cut.
    await expect(line).toHaveAttribute('title', WAITING_LINE);
  });

  /**
   * A branch that recorded which way it went is a
   * branch the run demonstrably did not take the
   * other way out of, so only one wire past it can
   * be carrying anything.
   */
  test('lights one successor of a decision the run made', async ({ page }) => {
    await openAtRest(page, {
      run: runOf(IN_FLIGHT),
      decided: { slot_open: 'yes' },
    });

    await expect(wireBody(page, 'e4')).toHaveAttribute('data-state', 'active');
    await expect(wireBody(page, 'e5')).toHaveAttribute('data-state', 'idle');
    await expect(nodeBody(page, 'book_appointment')).toHaveAttribute(
      'data-state',
      'running',
    );
    await expect(nodeBody(page, 'twilio_chat')).toHaveAttribute(
      'data-state',
      'dormant',
    );
  });

  /** A branch decided on predicates writes no row
   *  at all — it is settled in the generated code —
   *  so the run is somewhere past both arms. */
  test('lights both successors of a predicate branch', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT), decided: {} });

    await expect(wireBody(page, 'e4')).toHaveAttribute('data-state', 'active');
    await expect(wireBody(page, 'e5')).toHaveAttribute('data-state', 'active');
  });

  /**
   * A queue block's own row is written as each child
   * is handed over and carries no error, so the
   * ledger has the block finished while the work is
   * still to come. The children are counted instead,
   * and the count takes the line under the title —
   * which is the one place on a block where a
   * sentence about the run may go.
   */
  test('counts what a queue block’s children are doing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openEveryKind(page, { run: queuedRun({ active: 8, queued: 42 }) });

    const line = nodeLine(page, 'queue');

    await expect(line).toHaveAttribute('data-line', 'counts');
    await expect(line).toHaveText('8 running · 42 queued');
    await expect(line).toHaveAttribute('title', canvasStrings.derived);
    await expect(runMark(page, 'queue')).toHaveAttribute('data-run', 'running');

    // Written at the weight of a fact, like the name
    // of a function, and not at the fainter weight
    // the same block wears while it is still asking
    // for one.
    const fact = await nodeLine(page, 'trigger').evaluate(
      (node) => getComputedStyle(node).color,
    );
    await expect(line).toHaveCSS('color', fact);

    // In figures that hold their column, because
    // both numbers change on every tick and a line
    // that reflowed under them would be the only
    // thing moving on the canvas.
    await expect(line).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  /** Nothing left to count is nothing to say, and
   *  the line goes back to being about the code. */
  test('gives the line back once nothing is moving', async ({ page }) => {
    await openEveryKind(page, { run: queuedRun({ done: 12 }) });

    const line = nodeLine(page, 'queue');

    await expect(line).toHaveAttribute('data-line', 'unassigned');
    await expect(line).toHaveText(
      `${canvasStrings.kinds.queue} · ${canvasStrings.unassigned}`,
    );
    await expect(runMark(page, 'queue')).toHaveText('✓');
  });
});

/**
 * The chip at the end of the toolbar, while this
 * window is following a run of the workflow on
 * screen.
 *
 * It says which run and where it has got to, and
 * nothing about how long ago anything happened: the
 * canvas keeps no clock, and a chip that counted
 * would be one. The workflow is not named either —
 * the canvas the chip sits on is that workflow.
 */
test.describe('the followed run on the toolbar', () => {
  test('names the run this canvas is following', async ({ page }) => {
    await openAtRest(page, { run: runOf(PARKED, 'waiting') });

    await expect(page.locator('[data-following]')).toHaveText(
      `${canvasStrings.followingRun} ${shortRunId('wf_1')} · ` +
        canvasStrings.runOutcomes.waiting,
    );
  });

  /**
   * A few characters of it, with the whole of one
   * beside: four collide about once in fifty rows,
   * and a reader holding two of them has to be able
   * to tell which is which.
   */
  test('shows a run by the few characters it is known by', async ({ page }) => {
    const workflowId = 'run_1757232000000_a1b2c3d4';

    await openAtRest(page, {
      run: { ...runOf(IN_FLIGHT), workflowId },
    });

    const id = page.locator('[data-following] [data-short-run]');

    await expect(id).toHaveText(shortRunId(workflowId));
    await expect(id).toHaveAttribute('title', workflowId);
  });

  /** And it is the way from here to the run itself,
   *  now that the card beside the graph is about one
   *  block rather than the whole run. */
  test('opens the run it names', async ({ page }) => {
    const harness = await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await page.locator('[data-following]').click();

    expect(await harness.posted()).toContainEqual({
      type: 'openRun',
      workflowId: 'wf_1',
    });
  });

  test('says nothing on a canvas following no run', async ({ page }) => {
    await openAtRest(page);

    await expect(page.locator('[data-following]')).toHaveCount(0);
  });
});

/**
 * What a run does to a wire.
 *
 * The dashes march the way the value is going, so
 * they are drawn only along the wires something is
 * actually going down. A solid line is structure,
 * and a canvas of marching dashes would say the
 * whole workflow was running at once.
 */
test.describe('the dashes on a wire a run is going down', () => {
  test('marches them along the wire the run is travelling', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const wire = wireBody(page, 'e5');

    await expect(wire).toHaveCSS('stroke-dasharray', '6px, 5px');
    await expect(wire).toHaveCSS('animation-name', 'sig-edge-flow');
  });

  test('marches them into the block a run is parked at', async ({ page }) => {
    await openAtRest(page, { run: runOf(PARKED, 'waiting') });

    const wire = wireBody(page, 'e6');

    await expect(wire).toHaveCSS('stroke-dasharray', '6px, 5px');
    await expect(wire).toHaveCSS('animation-name', 'sig-edge-flow');
  });

  test('leaves the wires nothing is going down solid', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    // One the run has been down, and one it has not
    // reached: neither is carrying anything now.
    for (const id of ['e2', 'e10']) {
      const wire = wireBody(page, id);

      await expect(wire).toHaveCSS('stroke-dasharray', 'none');
      await expect(wire).toHaveCSS('animation-name', 'none');
    }
  });
});

/**
 * What colour a wire is drawn in.
 *
 * A run's colours live beside the wire rather than
 * in the stylesheet, so that the arrowhead at the
 * end of a line cannot disagree with the line —
 * which also means nothing in the sheet would catch
 * them going wrong. A run whose every wire came out
 * the colour of structure would say a workflow was
 * sitting still while it was going. Only a picked
 * wire's look is the sheet's, since only the
 * browser knows where a keyboard is.
 */
test.describe('the colour a wire is drawn in', () => {
  test('draws one nothing is going down as structure', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    const wire = wireBody(page, 'e10');

    await expect(wire).toHaveCSS(
      'stroke',
      'color(srgb 0.231373 0.231373 0.231373 / 0.22)',
    );
    await expect(wire).toHaveCSS('stroke-width', '1.5px');
  });

  test('draws the one a run is travelling in the run’s own', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(wireBody(page, 'e5')).toHaveCSS('stroke', 'rgb(23, 184, 144)');
  });

  /**
   * The name of a port on a live wire is a word, and
   * a theme that carries state in the ink draws every
   * state word in it: the colour the line takes is
   * picked to be seen as a line, and is too light to
   * be read as text there.
   */
  for (const theme of THEMES_ALL) {
    test(`names a port on a live wire in the colour a theme gives state words (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, { run: runOf(IN_FLIGHT) }, theme);

      const port = page.locator('[data-edge-port="e5"]');

      await expect(port).toHaveText('no');
      await expect(wireBody(page, 'e5')).toHaveAttribute(
        'data-state',
        'active',
      );

      const colour = await port.evaluate(
        (element) => getComputedStyle(element).color,
      );
      const expected = colourOf(theme, 'state-ink') || colourOf(theme, 'ok');

      expect(sameColour(colour, expected), `${colour} ≠ ${expected}`).toBe(
        true,
      );
    });
  }

  /** Behind the run, and faded: it says where the
   *  run has been rather than where it is. */
  test('fades the one a run has already come down', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(wireBody(page, 'e2')).toHaveCSS(
      'stroke',
      'color(srgb 0.104705 0.67119 0.530448 / 0.613)',
    );
  });

  test('draws the one into a parked block in the parked colour', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(PARKED, 'waiting') });

    await expect(wireBody(page, 'e6')).toHaveCSS('stroke', 'rgb(233, 162, 59)');
  });

  test('draws the one into a broken block in the broken one', async ({
    page,
  }) => {
    await openAtRest(page, { run: runOf(BROKEN, 'failed') });

    await expect(wireBody(page, 'e2')).toHaveCSS('stroke', 'rgb(238, 93, 104)');
  });

  /** The one wire that means "again" stays solid,
   *  so direction never reads as moving work. */
  test('keeps the one that runs back up the graph solid', async ({ page }) => {
    await openAtRest(page);

    await expect(wireBody(page, 'e8')).toHaveCSS('stroke-dasharray', 'none');
  });

  /**
   * A wire somebody picked, or has the keyboard on,
   * is drawn in the colour the editor marks focus
   * in, over whatever a run is doing along it. A
   * wire that looks the same picked as not leaves a
   * keyboard with no way of saying where it is. The
   * arrowhead goes with the line, and the wires
   * nobody is on keep their own colours.
   */
  for (const theme of THEMES_ALL) {
    test(`draws a picked wire in the focus colour, arrowhead too (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, { run: runOf(IN_FLIGHT) }, theme);
      await pickWire(page, 'e5');

      await page.mouse.move(0, 0);
      await settled(page);

      await drawnIn(page, theme, {
        e5: 'focus-ring',
        e2: 'edge-done',
        e10: 'hairline-strong',
      });
    });

    test(`draws a wire the keyboard is on in the focus colour, arrowhead too (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, { run: runOf(IN_FLIGHT) }, theme);

      const edge = page.locator('.react-flow__edge[data-id="e10"]');

      // A key first, so the browser takes the focus
      // for one a keyboard made.
      await page.keyboard.press('Shift');
      await edge.focus();
      await settled(page);

      expect(
        await edge.evaluate((wire) => wire.matches(':focus-visible')),
      ).toBe(true);
      await expect(edge).not.toHaveClass(/selected/);

      await drawnIn(page, theme, {
        e10: 'focus-ring',
        e5: 'ok',
        e2: 'edge-done',
      });
    });
  }
});

/** Holds each wire's line and arrowhead to the role
 *  it should be drawn in, in `theme`. */
async function drawnIn(
  page: Page,
  theme: ThemeKind,
  roles: Record<string, Role>,
): Promise<void> {
  for (const [edge, role] of Object.entries(roles)) {
    const { line, head } = await wireInk(page, edge);
    const expected = colourOf(theme, role);

    expect
      .soft(
        sameColour(line, expected),
        `${edge}: ${line} ≠ ${role} ${expected}`,
      )
      .toBe(true);
    expect
      .soft(
        sameColour(head, expected),
        `${edge}'s arrowhead: ${head} ≠ ${role} ${expected}`,
      )
      .toBe(true);
  }
}

/** Tint and ink per tone, as the browser resolves
 *  the mixes over this harness' light surface. The
 *  brand tile is the one that reads the deeper of
 *  the two brand tints, because it is the only tone
 *  whose glyph is drawn in the source colour. */
const TONE_COLOURS = [
  {
    tone: 'neutral',
    tint: 'color(srgb 0.928078 0.928078 0.928078)',
    ink: 'color(srgb 0.231373 0.231373 0.231373 / 0.62)',
  },
  {
    tone: 'brand',
    tint: 'color(srgb 0.881961 0.892941 0.976392)',
    ink: 'rgb(83, 103, 255)',
  },
  {
    tone: 'agent',
    tint: 'color(srgb 0.94149 0.927059 0.974745)',
    ink: 'rgb(149, 103, 255)',
  },
  {
    tone: 'ok',
    tint: 'color(srgb 0.893137 0.949961 0.935843)',
    ink: 'rgb(23, 184, 144)',
  },
  {
    tone: 'warn',
    tint: 'color(srgb 0.966078 0.935451 0.89102)',
    ink: 'rgb(233, 162, 59)',
  },
  {
    tone: 'fail',
    tint: 'color(srgb 0.96902 0.917843 0.921725)',
    ink: 'rgb(238, 93, 104)',
  },
] as const;

/**
 * The tile the glyph sits in, and the one place on
 * a block that state is spent as colour.
 */
test.describe('the tile a block’s glyph sits in', () => {
  test('is coloured by the state, never by the kind', async ({ page }) => {
    await openEveryKind(page);

    // Eleven kinds, one tone between them. Eleven
    // colours would be a legend to memorise, and
    // the block worth finding across a graph is the
    // one something is happening to.
    await expect(
      page.locator('.react-flow__node .node-icon[data-tone="neutral"]'),
    ).toHaveCount(NODE_PALETTE.length);
  });

  test('turns brand for the selected block, agent for a proposed one', async ({
    page,
  }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        ...showing('find_slot'),
        preview: proposing('await_reply'),
      }),
    );

    await expect(tile(page, 'find_slot')).toHaveAttribute('data-tone', 'brand');
    await expect(tile(page, 'await_reply')).toHaveAttribute(
      'data-tone',
      'agent',
    );
    await expect(tile(page, 'parse_request')).toHaveAttribute(
      'data-tone',
      'neutral',
    );
  });

  /**
   * And the three a run puts there, driven by a run
   * rather than by setting the attribute. The tile
   * is the one place on a block state is spent as
   * colour, so a table read only through the states
   * nothing is running could send every tile grey
   * the moment a run started and nothing would say
   * so.
   */
  test('turns the run’s own colours while one is going', async ({ page }) => {
    await openAtRest(page, { run: runOf(IN_FLIGHT) });

    await expect(tile(page, 'twilio_chat')).toHaveAttribute('data-tone', 'ok');

    // A block the run has finished with is no longer
    // the one to look at, so it goes back to neutral
    // and the mark at its end carries the outcome.
    await expect(tile(page, 'find_slot')).toHaveAttribute(
      'data-tone',
      'neutral',
    );

    await openAtRest(page, { run: runOf(PARKED, 'waiting') });

    await expect(tile(page, 'await_reply')).toHaveAttribute(
      'data-tone',
      'warn',
    );

    await openAtRest(page, { run: runOf(BROKEN, 'failed') });

    await expect(tile(page, 'find_slot')).toHaveAttribute('data-tone', 'fail');
  });

  test('paints each tone in its own tint and ink', async ({ page }) => {
    await openCanvas(page);

    const square = tile(page, 'find_slot');

    for (const { tone, tint, ink } of TONE_COLOURS) {
      await square.evaluate(
        (element, value) => element.setAttribute('data-tone', value),
        tone,
      );

      await expect(square).toHaveCSS('background-color', tint);
      await expect(square).toHaveCSS('color', ink);
    }
  });

  test('is a small square with a smaller glyph inside it', async ({ page }) => {
    await openCanvas(page);

    const square = tile(page, 'find_slot');

    await expect(square).toHaveCSS('width', '28px');
    await expect(square).toHaveCSS('height', '28px');
    await expect(square).toHaveCSS('border-radius', '6px');
    await expect(square.locator('svg')).toHaveCSS('width', '15px');

    // One weight and one shape of corner across
    // every glyph. Icons drawn at different weights
    // read as different products, and it
    // is the sort of thing nobody can name and
    // everybody sees.
    await expect(square.locator('svg')).toHaveCSS('stroke-width', '2px');
    await expect(square.locator('svg')).toHaveCSS('stroke-linecap', 'round');
    await expect(square.locator('svg')).toHaveCSS('stroke-linejoin', 'round');
  });
});

test.describe('drawing a wire', () => {
  test('refuses one the types forbid, in core’s own words', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await dragBetween(
      page,
      sourceHandle(page, 'find_slot', 'out'),
      targetHandle(page, 'record_booking'),
    );

    const refusal = page.locator('[data-rejection]');

    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(canvasStrings.typedWiring);
    await expect(refusal).toContainText(
      whatCoreSays('find_slot', 'out', 'record_booking'),
    );

    // The card's heading is the system's one section
    // label, in the case it was written in: a
    // refusal set in capitals reads as the product
    // raising its voice at somebody who drew a wire.
    const heading = refusal.locator('.section-label');

    await expect(heading).toHaveText(canvasStrings.typedWiring);
    await expect(heading).toHaveCSS('text-transform', 'none');

    expect(await harness.postedOfType('connect')).toEqual([]);
  });

  /**
   * The two blocks and no port. Which way out of the
   * first this wire takes is the host's question,
   * asked once the wire has landed — the panel has
   * one dot to draw from and no answer to give.
   */
  test('accepts one the types allow, and tells the host once', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await dragBetween(
      page,
      sourceHandle(page, 'find_slot', 'out'),
      targetHandle(page, 'book_appointment'),
    );

    expect(await harness.postedOfType('connect')).toEqual([
      {
        type: 'connect',
        baseRevision: ir.revision,
        from: { node: 'find_slot' },
        to: { node: 'book_appointment' },
      },
    ]);
  });

  test('refuses one that would loop the graph back on itself', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await dragBetween(
      page,
      sourceHandle(page, 'send_confirmation', 'out'),
      targetHandle(page, 'parse_request'),
    );

    const refusal = page.locator('[data-rejection]');

    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(whatCoreSaysAboutTheGraph());

    expect(await harness.postedOfType('connect')).toEqual([]);
  });
});

/**
 * What the canvas says while a wire is being drawn.
 *
 * The question a person is asking mid-drag is "where
 * can this go", and every block on the graph is
 * either an answer or not one. So every block
 * answers: the ones that could take the wire are
 * ringed, the ones that could not step back, and the
 * one under the pointer says what would meet what.
 */
test.describe('a wire being drawn', () => {
  /**
   * It leaves by the out dot and only by the out
   * dot. The in dot is drawn on hover so a block
   * says where a wire arrives, and it takes a drop —
   * but every answer the canvas gives mid-drag is
   * worked out about the block the wire is leaving,
   * so a gesture begun at the other end would ring
   * what this block feeds instead of what could feed
   * it, and write the wire the other way round.
   */
  test('cannot be started from the dot a wire arrives at', async ({ page }) => {
    await openCanvas(page);

    // The block rather than the dot, because the dot
    // is what this is asserting a pointer cannot
    // begin a wire on.
    await nodeBody(page, 'record_booking').hover();

    const box = (await targetHandle(page, 'record_booking').boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 30, { steps: 4 });

    await expect(page.locator('[data-pending-wire]')).toHaveCount(0);
    await expect(ringOf(page, 'send_confirmation')).toHaveCount(0);

    await page.mouse.up();
  });

  test('rings every block it could land on', async ({ page }) => {
    await openCanvas(page);
    await holdWire(page, 'find_slot');

    await expect(ringOf(page, 'book_appointment')).toBeVisible();
    await expect(ringOf(page, 'record_booking')).toHaveCount(0);

    await page.mouse.up();
  });

  test('draws the ring in the colour a match is drawn in', async ({ page }) => {
    await openCanvas(page);
    await holdWire(page, 'find_slot');

    const ring = ringOf(page, 'book_appointment');

    await expect(ring).toHaveCSS('box-shadow', MATCHED);
    await expect(ring).toHaveCSS('border-radius', '12px');
    await expect(ring).toHaveCSS('inset', '-3px');

    await page.mouse.up();
  });

  /**
   * A block that cannot take the wire steps back and
   * says nothing else. The border is read before the
   * drag and again during it: dimming that also
   * outlined would be two statements where the design
   * makes one.
   */
  test('dims the ones it could not, and nothing more', async ({ page }) => {
    await openCanvas(page);

    const block = nodeBody(page, 'record_booking');
    const resting = await block.evaluate(
      (element) => getComputedStyle(element).border,
    );

    await holdWire(page, 'find_slot');

    await expect(block).toHaveCSS('opacity', '0.4');
    expect(
      await block.evaluate((element) => getComputedStyle(element).border),
    ).toBe(resting);
    await expect(page.locator('[data-shape-note]')).toHaveCount(0);

    await page.mouse.up();
  });

  /**
   * A block with no function behind it says nothing
   * about what it takes or produces, and an
   * undeclared shape fits everything — otherwise the
   * most ordinary thing there is, dragging two fresh
   * blocks out and wiring them, would be refused.
   */
  test('rings two blocks that name no shape at all', async ({ page }) => {
    await openEveryKind(page);
    await holdWire(page, 'step');

    await expect(ringOf(page, 'code_step')).toBeVisible();
    await expect(nodeBody(page, 'code_step')).toHaveCSS('opacity', '1');

    await page.mouse.up();
  });

  test('dims the trigger, which nothing may run before', async ({ page }) => {
    await openEveryKind(page);
    await holdWire(page, 'step');

    await expect(ringOf(page, 'trigger')).toHaveCount(0);
    await expect(nodeBody(page, 'trigger')).toHaveCSS('opacity', '0.4');

    await page.mouse.up();
  });

  test('says which shape meets which under the pointer', async ({ page }) => {
    await openCanvas(page);
    await holdWire(page, 'find_slot');
    await targetHandle(page, 'book_appointment').hover();

    await expect(page.locator('[data-shape-note]')).toHaveText(
      'SlotGrid → SlotGrid ✓ · release to connect',
    );

    await page.mouse.up();
  });

  for (const theme of THEMES_ALL) {
    test(`says which shape meets which in the colour a theme gives a gesture’s words (${theme})`, async ({
      page,
    }) => {
      await openCanvas(page, theme);
      await holdWire(page, 'find_slot');
      await targetHandle(page, 'book_appointment').hover();

      const note = page.locator('[data-shape-note]');

      await expect(note).toHaveText(
        'SlotGrid → SlotGrid ✓ · release to connect',
      );

      const colour = await inkOf(note);
      const expected = gestureInk(theme);

      expect(sameColour(colour, expected), `${colour} ≠ ${expected}`).toBe(
        true,
      );

      await page.mouse.up();
    });
  }

  test('says nothing where either end names no shape', async ({ page }) => {
    await openEveryKind(page);
    await holdWire(page, 'step');
    await targetHandle(page, 'code_step').hover();

    await expect(ringOf(page, 'code_step')).toBeVisible();
    await expect(page.locator('[data-shape-note]')).toHaveCount(0);

    await page.mouse.up();
  });

  /**
   * A wire being drawn must never read as a wire
   * being run, so it takes a dash of its own — and it
   * ends in a dot rather than an arrowhead, because
   * that end is the cursor and not an arrival.
   */
  test('draws itself dashed, ending in a dot rather than an arrow', async ({
    page,
  }) => {
    await openCanvas(page);
    await holdWire(page, 'find_slot');

    const drawn = page.locator('[data-pending-wire]');

    await expect(drawn).toHaveCSS('stroke-width', '1.5px');
    await expect(drawn).toHaveCSS('stroke-dasharray', '5px, 4px');
    await expect(drawn).toHaveCSS('stroke', BRAND);
    await expect(drawn).toHaveCSS('marker-end', 'none');

    const end = page.locator('[data-pending-end]');

    await expect(end).toHaveAttribute('r', '5');
    await expect(end).toHaveCSS('fill', BRAND);

    await page.mouse.up();
  });

  test('offers the kinds that could take it when it lands on nothing', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await holdWire(page, 'find_slot');
    await page.mouse.move(900, 900, { steps: 4 });
    await page.mouse.up();

    const offered = page.locator('[data-quick-add-kind]');

    await expect(offered.first()).toBeVisible();

    // Picking one writes a block, which is an
    // action, so each row is the system's Button
    // rather than a line of text somebody can
    // click — and the gesture ended here, so the
    // first of them is where the keyboard is.
    const rows = await offered.evaluateAll((found) =>
      found.map((row) => ({
        kind: row.getAttribute('data-quick-add-kind'),
        button: row.classList.contains('btn'),
        variant: row.getAttribute('data-variant'),
        holding: row === document.activeElement,
      })),
    );

    expect(rows.length).toBeGreaterThan(1);
    expect(rows.findIndex((row) => row.holding)).toBe(0);

    for (const row of rows) {
      expect(row.button).toBe(true);
      expect(row.variant).toBe('quiet');
    }

    const kinds = rows.map((row) => row.kind);

    expect(kinds).toContain('step');
    expect(kinds).not.toContain('trigger');

    const heading = page.locator('[data-quick-add] .section-label');

    await expect(heading).toHaveText(canvasStrings.quickAdd);
    await expect(heading).toHaveCSS('text-transform', 'none');

    // Nothing is written until one is chosen: the
    // list is the question, not the answer.
    expect(await harness.postedOfType('addNode')).toEqual([]);
  });

  test('writes the block and what it is wired to, together', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await holdWire(page, 'find_slot');
    await page.mouse.move(900, 900, { steps: 4 });
    await page.mouse.up();

    await page.locator('[data-quick-add-kind="step"]').click();

    expect(await harness.postedOfType('addNode')).toEqual([
      {
        type: 'addNode',
        baseRevision: ir.revision,
        kind: 'step',
        position: expect.anything(),
        connectFrom: { node: 'find_slot' },
      },
    ]);
  });

  test('offers nothing where the wire landed on a block', async ({ page }) => {
    await openCanvas(page);

    await dragBetween(
      page,
      sourceHandle(page, 'find_slot', 'out'),
      targetHandle(page, 'book_appointment'),
    );

    await expect(page.locator('[data-quick-add]')).toHaveCount(0);
  });
});

test.describe('the view toggle', () => {
  test('round-trips an edit made as text', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('[data-view-toggle="json"]').click();

    const editor = page.locator('[data-json-editor]');
    await expect(editor).toBeVisible();

    const edited = JSON.stringify(
      { ...ir, title: 'Groom booking, renamed' },
      null,
      2,
    );

    await editor.fill(`${edited}\n`);
    await editor.blur();

    const sent = await harness.postedOfType('text');
    expect(sent).toHaveLength(1);

    // What the host does with it: writes the document
    // and posts back what it now says.
    await harness.show(
      canvasInit({
        document: {
          ok: true,
          ir: JSON.parse(sent[0]!.text as string) as WorkflowIR,
        },
      }),
    );
    await page.locator('[data-view-toggle="canvas"]').click();

    await expect(
      page.locator('.react-flow__node[data-id="find_slot"]'),
    ).toBeVisible();
    expect(await harness.postedOfType('text')).toHaveLength(1);
  });
});

/**
 * The toolbar's one action.
 *
 * There is a palette entry for this too, and the
 * palette entry is what a keybinding binds to — but
 * nobody opens a palette to find out what a screen
 * can do. Somebody who has dragged their blocks into
 * a mess needs to be able to see the way out of it.
 */
test.describe('the Arrange button', () => {
  test('is on the toolbar, saying what it does', async ({ page }) => {
    await openCanvas(page);

    const arrange = page.locator('.toolbar [data-arrange]');

    await expect(arrange).toBeVisible();
    await expect(arrange).toHaveText(canvasStrings.arrange);
  });

  /**
   * Quiet, and the system's own button rather than
   * one this screen drew for itself: laying the
   * graph out again is something a person does now
   * and then, and a control shaped by hand here is
   * one nobody maintains beside the other five
   * surfaces.
   */
  test('wears the shape of an action nobody needs often', async ({ page }) => {
    await openCanvas(page);

    const arrange = page.locator('.btn[data-variant="quiet"][data-arrange]');

    await expect(arrange).toHaveCount(1);
    await expect(arrange).toHaveCSS('padding', '3px 10px');
    await expect(arrange).toHaveCSS('letter-spacing', 'normal');
    await expect(arrange).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const ink = await arrange.evaluate(
      (button) => getComputedStyle(button).color,
    );
    const expected = colourOf('light', 'ink-muted');

    expect(sameColour(ink, expected), `${ink} ≠ ${expected}`).toBe(true);

    // It takes a ground only under the pointer,
    // which is the whole of its reaction.
    await arrange.hover();
    await expect(arrange).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  /**
   * Gone, rather than there and refusing. Laying the
   * graph out again is an edit, and there is nothing
   * to edit over a file that will not parse or over
   * a draft nobody has approved.
   */
  test('is not offered where there is nothing to edit', async ({ page }) => {
    const harness = await mount(page, 'canvas');

    await harness.show(canvasInit({ preview: proposing('await_reply') }));
    await expect(page.locator('[data-arrange]')).toHaveCount(0);

    await harness.show(
      canvasInit({
        document: { ok: false, detail: 'Not a workflow document.' },
      }),
    );
    await expect(page.locator('[data-arrange]')).toHaveCount(0);
  });
});

test.describe('selecting a block', () => {
  test('tells the host which one', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('.react-flow__node[data-id="find_slot"]').click();

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: 'find_slot' },
    ]);
  });

  test('lets go of it when the canvas itself is clicked', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('.react-flow__node[data-id="find_slot"]').click();
    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } });

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: 'find_slot' },
      { type: 'select', nodeId: null },
    ]);
  });

  test('draws the selected one as selected', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ ...showing('find_slot') }));

    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'selected',
    );
    await expect(nodeBody(page, 'parse_request')).toHaveAttribute(
      'data-state',
      'dormant',
    );
  });
});

/**
 * The canvas's own columns: what can go on the
 * board, and the board. What a block does is set in
 * the Inspector, a pane of its own beside every
 * canvas, so a click here only tells the host which
 * block was picked.
 */
test.describe('the palette beside the graph', () => {
  /**
   * The palette is the left-hand track of one grid,
   * and the blocks and the wires are the rest of it.
   * Nothing else in the suite would notice the grid
   * collapsing to a single track, or a third one
   * coming back for a column the canvas no longer
   * draws.
   */
  test('leaves the graph beside the palette and nothing else', async ({
    page,
  }) => {
    await openCanvas(page);
    await expect(page.locator('.react-flow')).toHaveCount(1);

    // The palette is fixed; the graph is whatever
    // is left of the frame.
    const width = page.viewportSize()!.width;

    await expect(page.locator('.workspace')).toHaveCSS(
      'grid-template-columns',
      `204px ${width - 204}px`,
    );
    await expect(page.locator('.inspector')).toHaveCount(0);
    await expect(page.locator('[data-inspector-mode]')).toHaveCount(0);
    await expect(page.locator('[data-inspector-tab]')).toHaveCount(0);
  });

  /**
   * And keeps standing there in a narrow editor.
   * A canvas opens in an editor group, so its width
   * is whatever somebody's split happens to be —
   * and a rail of fixed width in a frame narrower
   * than it leaves the graph nothing at all. The
   * rail gives way; the graph has a floor.
   */
  test('gives the graph the room before the rails', async ({ page }) => {
    await openCanvas(page);
    await page.setViewportSize({ width: 480, height: 900 });

    const graph = page.locator('.react-flow');

    expect((await graph.boundingBox())!.width).toBeGreaterThanOrEqual(320);
    expect(
      await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      })),
    ).toEqual({ scroll: 480, client: 480 });
  });

  test('tells the host which block was clicked', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('.react-flow__node[data-id="reply_decision"]').click();

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: 'reply_decision' },
    ]);
  });

  test('tells the host the canvas itself was clicked', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ ...showing('find_slot') }));

    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } });

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: null },
    ]);
  });
});

/**
 * The other way a function gets behind a block:
 * dragged out of the palette and dropped on it. The
 * palette says which of its rows could sit behind
 * the block that is selected, so a drag starts from
 * something a person can already see will land.
 */
test.describe('dragging a function onto a block', () => {
  /**
   * A drag, picked up and left in the air.
   *
   * `dragAndDrop` is one movement with no middle to
   * look at, and what a row looks like while it is
   * being carried is exactly the middle. So the
   * start of the gesture is dispatched on its own,
   * carrying the same transfer object the browser
   * would hand it.
   */
  async function lift(
    page: Page,
    row: Locator,
  ): Promise<JSHandle<DataTransfer>> {
    const transfer = await page.evaluateHandle(() => new DataTransfer());

    await row.dispatchEvent('dragstart', { dataTransfer: transfer });

    return transfer;
  }

  test('marks the row the selected block already runs', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ ...showing('find_slot') }));

    await expect(page.locator('[data-lib-fn="findSlot"]')).toHaveAttribute(
      'data-state',
      'assigned',
    );
    await expect(
      page.locator('[data-lib-fn="parseRequest"] .lib-note'),
    ).toHaveText('takes WebhookEvent, needs BookingReq');
  });

  /**
   * A row on its way somewhere says so twice: the
   * row itself goes translucent and dashed, and the
   * toolbar says what the pointer is holding. The
   * dashes are the same ones the block under the
   * pointer will draw, so the two ends of the
   * gesture read as one thing.
   */
  test('shows the row it is carrying, and what it is', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ ...showing('slot_open') }));

    const row = page.locator('[data-lib-fn="tryAgain"]');
    await lift(page, row);

    await expect(row).toHaveAttribute('data-state', 'dragging');
    await expect(row).toHaveCSS('opacity', '0.85');
    // A hair under two device pixels, which the
    // engine reports as one — the same rounding the
    // proposed block's dashes go through.
    await expect(row).toHaveCSS('border-top-width', '1px');
    await expect(row).toHaveCSS('border-top-style', 'dashed');
    await expect(row).toHaveCSS('border-top-color', 'rgb(83, 103, 255)');

    await expect(page.locator('[data-dragging]')).toHaveText(
      'dragging tryAgain…',
    );
  });

  /**
   * The block under the pointer answers, in the
   * colour of somebody doing something rather than
   * the colour of an agent proposing one. Without
   * it a function is carried across a whole graph
   * with nothing on screen saying where it would
   * land, and the drop is a guess.
   */
  test('marks the block it is over, and lets go when it leaves', async ({
    page,
  }) => {
    await openCanvas(page);

    const carried = await lift(page, page.locator('[data-lib-fn="tryAgain"]'));
    const block = nodeBody(page, 'slot_open');

    await block.dispatchEvent('dragover', { dataTransfer: carried });

    await expect(block).toHaveAttribute('data-landing', 'lib-fn');
    await expect(block).toHaveCSS('border-top-style', 'dashed');
    await expect(block).toHaveCSS('border-top-color', 'rgb(83, 103, 255)');

    await block.dispatchEvent('dragleave', { dataTransfer: carried });

    await expect(block).not.toHaveAttribute('data-landing', 'lib-fn');
  });

  test('tells the host to put it behind the block it landed on', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await page.dragAndDrop(
      '[data-lib-fn="tryAgain"]',
      '.react-flow__node[data-id="slot_open"] .node',
    );

    expect(await harness.postedOfType('assign')).toEqual([
      {
        type: 'assign',
        baseRevision: ir.revision,
        nodeId: 'slot_open',
        export: 'tryAgain',
      },
    ]);
  });
});

/**
 * Dragging a block off the rail and onto the graph.
 *
 * A real press and a real pointer, because every
 * part of this is about where the pointer is: the
 * drag does not begin until it has moved far enough
 * to mean it, the graph opens a gap on every wire
 * while it is in flight, and where it is let go of
 * decides whether the block goes into a wire or sits
 * on its own.
 *
 * The whole thing is drawn in the canvas' own blue.
 * Purple on this canvas means an agent wrote it, and
 * every one of these marks is the person's own hand.
 */
test.describe('dragging a block onto the canvas', () => {
  /**
   * Four pixels of movement, because a press is how
   * a person points at something too. A block that
   * left the rail on the first pixel would leave it
   * every time somebody read the label.
   */
  test('waits for the pointer to mean it', async ({ page }) => {
    await openCanvas(page);

    const chip = await holdBlock(page, 'step', 2);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(page.locator('[data-splice-gap]')).toHaveCount(0);

    await page.mouse.move(chip.x + 40, chip.y);
    await expect(page.locator('[data-ghost]')).toHaveCount(1);

    await page.mouse.up();
  });

  test('opens a gap on every wire the block could go into', async ({
    page,
  }) => {
    await openCanvas(page);
    await dragBlockOverPane(page, 'step');

    const forward = ir.edges.filter((edge) => !edge.back);

    await expect(page.locator('[data-splice-gap]')).toHaveCount(forward.length);

    for (const edge of ir.edges) {
      await expect(page.locator(`[data-splice-gap="${edge.id}"]`)).toHaveCount(
        edge.back ? 0 : 1,
      );
    }

    await page.mouse.up();
  });

  /**
   * The block itself, half-there, with the pointer's
   * own arrow on it.
   *
   * Both halves said out loud. A ghost at full
   * opacity would read as a block that has already
   * landed, and one without the arrow would leave a
   * person hunting for where the pointer actually
   * is on a shape 230 pixels wide.
   */
  test('carries a half-there block under the pointer', async ({ page }) => {
    await openAtRest(page);
    await dragBlockOverPane(page, 'step');

    const ghost = page.locator('[data-ghost]');

    await expect(ghost).toHaveCSS('opacity', '0.8');
    await expect(ghost.locator('.node[data-state="selected"]')).toBeVisible();
    await expect(ghost.locator('svg.cursor-badge')).toBeVisible();

    await page.mouse.up();
  });

  /**
   * The rail says which block left it, in its own
   * words — not the ones a function on its way to a
   * block uses. They are two different journeys and
   * a person mid-drag should not have to work out
   * which one they started.
   */
  test('says on the chip which block is on its way', async ({ page }) => {
    await openCanvas(page);
    await dragBlockOverPane(page, 'step');

    const chip = page.locator('[data-palette-kind="step"]');

    await expect(chip).toHaveText('Step · dragging');
    await expect(chip).toHaveAttribute('data-state', 'dragging');
    await expect(page.locator('[data-dragging]')).toHaveCount(0);

    await page.mouse.up();
  });

  /**
   * A gap is the shape of the block that would fill
   * it, or it is not an offer of anything in
   * particular — and the block lands centred on the
   * gap, so an outline of some other height promises
   * a place the block does not go.
   */
  test('opens it the size of the block that would fill it', async ({
    page,
  }) => {
    await openCanvas(page);
    await dragBlockOverPane(page, 'step');

    const gap = (await page.locator('[data-splice-gap="e2"]').boundingBox())!;
    const block = (await nodeBody(page, 'find_slot').boundingBox())!;

    expect(gap.width).toBeCloseTo(block.width, 1);
    expect(gap.height).toBeCloseTo(block.height, 1);

    await page.mouse.up();
  });

  /**
   * Every wire offers a gap; one of them is the
   * offer. Filling every gap would say the block
   * was about to go into every one.
   */
  test('offers the splice only where the pointer is', async ({ page }) => {
    await openAtRest(page);
    await dragBlockOverPane(page, 'step');
    await overGap(page, 'e2');

    const under = page.locator('[data-splice-gap][data-under]');

    await expect(under).toHaveCount(1);
    await expect(under).toHaveAttribute('data-splice-gap', 'e2');
    await expect(under.locator('.splice-title')).toHaveText('splice here');
    await expect(under.locator('.splice-note')).toHaveText(
      'edge splits on drop',
    );

    // `--brand-tint`, which is the brand mixed into
    // the surface behind it.
    await expect(under).toHaveCSS(
      'background-color',
      'color(srgb 0.920784 0.927059 0.974745)',
    );
    await expect(page.locator('[data-splice-gap="e3"]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(
      page.locator('[data-splice-gap="e3"] .splice-title'),
    ).toHaveCount(0);

    // The unfilled ones are still there to be seen,
    // which is the whole point of opening all of
    // them: the offer is meant to be readable at
    // once. Unfilled and unoutlined is invisible.
    await expect(page.locator('[data-splice-gap="e3"]')).toHaveCSS(
      'border-top-style',
      'dashed',
    );
    await expect(page.locator('[data-splice-gap="e3"]')).toHaveCSS(
      'border-top-color',
      'rgb(83, 103, 255)',
    );
    await expect(page.locator('[data-splice-gap="e3"]')).toHaveCSS(
      'border-radius',
      '10px',
    );

    await page.mouse.up();
  });

  for (const theme of THEMES_ALL) {
    test(`offers the splice in the colour a theme gives a gesture’s words (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, {}, theme);
      await dragBlockOverPane(page, 'step');
      await overGap(page, 'e2');

      const under = page.locator('[data-splice-gap][data-under]');
      const title = under.locator('.splice-title');
      const note = under.locator('.splice-note');

      await expect(title).toHaveText('splice here');
      await expect(note).toHaveText('edge splits on drop');

      const expected = gestureInk(theme);

      for (const words of [title, note]) {
        const colour = await inkOf(words);

        expect(sameColour(colour, expected), `${colour} ≠ ${expected}`).toBe(
          true,
        );
      }

      await page.mouse.up();
    });
  }

  test('puts the block into the wire it was let go of on', async ({ page }) => {
    const harness = await openCanvas(page);

    await dragBlockOverPane(page, 'step');
    await overGap(page, 'e2');
    await page.mouse.up();

    const sent = await harness.postedOfType('addNode');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'addNode',
      baseRevision: ir.revision,
      kind: 'step',
      spliceEdge: 'e2',
    });
  });

  /** Let go of over open canvas, it goes where it
   *  was let go of and joins nothing. */
  test('leaves it wired to nothing where no wire was under it', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await dragBlockOverPane(page, 'step');
    await page.mouse.up();

    const sent = await harness.postedOfType('addNode');

    expect(sent).toHaveLength(1);
    expect(sent[0]!['spliceEdge']).toBeUndefined();

    const at = sent[0]!['position'] as { x: number; y: number };
    expect(Number.isInteger(at.x)).toBe(true);
    expect(Number.isInteger(at.y)).toBe(true);
  });

  /**
   * Escape puts it back, and the proof is finishing
   * the gesture anyway.
   *
   * The pointer is let go of over a gap that would
   * have spliced — so "nothing was written" is a
   * claim about Escape rather than about a drag that
   * was simply never completed.
   */
  test('calls the whole thing off when Escape is pressed', async ({ page }) => {
    const harness = await openCanvas(page);

    await dragBlockOverPane(page, 'step');
    await overGap(page, 'e2');

    await expect(page.locator('[data-splice-gap][data-under]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await harness.postedOfType('addNode')).toEqual([]);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(page.locator('[data-splice-gap]')).toHaveCount(0);
    await expect(page.locator('[data-palette-kind="step"]')).toHaveText('Step');
  });

  /**
   * Where a row goes, and the one thing a drop does
   * that a person would not guess: let go of a block
   * over a wire and the wire opens to take it.
   */
  test('says where a block goes and what a wire does with it', async ({
    page,
  }) => {
    await openCanvas(page);

    await expect(page.locator('[data-drag-hint]')).toHaveText(
      'drag onto the canvas · drop on an edge to splice',
    );
  });
});

/**
 * The same ten blocks in one column, small enough
 * that the graph is drawn as far in as the canvas
 * allows.
 *
 * The browser hands a synthetic pointer whole
 * pixels, so a gesture can only ask for an exact
 * number of grid squares where the zoom is a whole
 * number too. A graph well inside its pane is drawn
 * at the furthest in the canvas goes, which is one.
 */
const stacked: CanvasInit['boxes'] = Object.fromEntries(
  ir.nodes.map((node, index) => {
    const { width, height } = nodeSize(node.kind);

    return [node.id, { x: 0, y: index * height, w: width, h: height }];
  }),
);

/** Two shadows: near and soft, the way something
 *  held above a surface casts them. */
const LIFTED =
  'rgba(23, 26, 35, 0.08) 0px 2px 6px 0px, ' +
  'rgba(23, 26, 35, 0.12) 0px 12px 32px 0px';

/** The one colour a gesture is drawn in: blue means
 *  somebody is doing this. */
const BRAND = 'rgb(83, 103, 255)';

/** The system's one "this is the match" ring, at the
 *  geometry a block wears it. */
const MATCHED = 'color(srgb 0.32549 0.403922 1 / 0.45) 0px 0px 0px 2px';

/** The ring, the softer ring around it, and the two
 *  the block was already sitting on. */
const SELECTED =
  'rgb(83, 103, 255) 0px 0px 0px 1.5px, ' +
  'color(srgb 0.32549 0.403922 1 / 0.18) 0px 0px 0px 5px, ' +
  'rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, ' +
  'rgba(23, 26, 35, 0.07) 0px 4px 12px 0px';

/**
 * Moving a block that is already on the graph.
 *
 * The gesture writes where blocks are and nothing
 * else: the wires are the document's, and a person
 * tidying a picture has not said anything about what
 * runs after what. The specs below say what is drawn
 * while a block is in the air, and the last of them
 * says the wiring came through untouched.
 */
test.describe('moving a block by hand', () => {
  /**
   * Where the block was, outlined and neutral. Every
   * other thing a gesture draws is brand blue
   * because a person is doing it; the place they
   * have left is not something they are doing, and a
   * blue hole would read as an offer to put
   * something back.
   */
  test('outlines the slot the block came out of', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const slot = page.locator('[data-old-slot]');

    await expect(slot).toHaveCount(1);
    await expect(slot).toHaveCSS('border-top-style', 'dashed');
    await expect(slot).toHaveCSS(
      'border-top-color',
      'color(srgb 0.231373 0.231373 0.231373 / 0.22)',
    );

    await page.mouse.up();
    await expect(slot).toHaveCount(0);
  });

  /**
   * And the pointer's own arrow on its corner, the
   * one a block carried in from the rail wears. It
   * is needed more here, not less: a block picked up
   * off the graph keeps whatever offset it was
   * grabbed at, so without the arrow there is
   * nothing on screen saying where the pointer is —
   * which is the thing deciding where it lands.
   */
  test('wears the pointer on its corner while it is held', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const lift = page.locator('.react-flow__node[data-id="find_slot"] .lift');

    await expect(lift.locator('svg.cursor-badge')).toBeVisible();

    await page.mouse.up();
    await expect(page.locator('svg.cursor-badge')).toHaveCount(0);
  });

  /**
   * And exactly the size of the block that left it.
   * The hole is the shape of the thing that was in
   * it; an outline any other height is a different,
   * smaller thing sitting where the block was.
   */
  test('outlines it the size of the block that left', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const slot = (await page.locator('[data-old-slot]').boundingBox())!;
    const block = (await nodeBody(page, 'find_slot').boundingBox())!;

    expect(slot.width).toBeCloseTo(block.width, 1);
    expect(slot.height).toBeCloseTo(block.height, 1);

    await page.mouse.up();
  });

  /**
   * Two shadows on the wrapper and four inside it,
   * never one merged value. The block is raised off
   * the graph and lit as the one being looked at,
   * and they are two facts: merging them into one
   * shadow would lose whichever the merge favoured.
   *
   * Nothing selected it from the host's side here.
   * The block a hand is holding is the block that
   * hand is about to be asked about, so the lift
   * says so itself.
   */
  test('lifts the block off the graph while it is held', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const lift = page.locator('.react-flow__node[data-id="find_slot"] .lift');
    const block = nodeBody(page, 'find_slot');

    await expect(lift).toHaveCSS('box-shadow', LIFTED);
    await expect(block).toHaveAttribute('data-state', 'selected');
    await expect(block).toHaveCSS('box-shadow', SELECTED);

    await page.mouse.up();
    await expect(lift).toHaveCount(0);
  });

  test('says where the block is while it is in the air', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const readout = page.locator('[data-readout]');
    const at = await flowPosition(page, 'find_slot');

    await expect(readout).toContainText(`x ${at.x} · y ${at.y}`);
    await expect(readout).toHaveCSS('color', 'rgb(83, 103, 255)');
    await expect(readout).toHaveCSS('font-size', '10px');

    await page.mouse.up();
    await expect(readout).toHaveCount(0);
  });

  for (const theme of THEMES_ALL) {
    test(`says where the block is in the colour a theme gives a gesture’s words (${theme})`, async ({
      page,
    }) => {
      await openAtRest(page, {}, theme);
      await holdNode(page, 'find_slot', { x: 70, y: 50 });

      const readout = page.locator('[data-readout]');
      const at = await flowPosition(page, 'find_slot');

      await expect(readout).toContainText(`x ${at.x} · y ${at.y}`);

      const colour = await inkOf(readout);
      const expected = gestureInk(theme);

      expect(sameColour(colour, expected), `${colour} ≠ ${expected}`).toBe(
        true,
      );

      await page.mouse.up();
    });
  }

  /**
   * A block off a freshly-arranged graph is moved by
   * the grid on the first pixel, and then it is
   * simply not where the pointer is. The readout is
   * what explains that, so it has to say it.
   */
  test('says when the grid moved it off the pointer', async ({ page }) => {
    await openAtRest(page);
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    await expect(page.locator('[data-readout]')).toContainText(' — snapped');

    await page.mouse.up();
  });

  /**
   * And says nothing of the kind where the grid
   * moved nothing. Without this case a readout that
   * appended the word every time would pass the one
   * above, and the word would mean nothing.
   */
  test('says nothing of the kind when it was already on it', async ({
    page,
  }) => {
    await openAtRest(page, { boxes: stacked });

    // Said out loud, because the case below is
    // exactly one square of pointer travel and only
    // a whole-numbered zoom can express one.
    const scale = await zoom(page);
    expect(scale).toBe(2);

    const from = await holdNode(page, 'find_slot', { x: 4, y: 4 });

    // One square, in one movement, measured from
    // where the drag counts rather than from where
    // the pointer went down. In one movement because
    // the readout answers for where the block last
    // went: a hand that stopped part of the way
    // there would be told about the part.
    await page.mouse.move(from.x + GRID * scale, from.y + GRID * scale);

    const readout = page.locator('[data-readout]');

    // Said first, so that a readout which never
    // appeared fails as itself rather than passing
    // as a word nobody wrote.
    await expect(readout).toHaveCount(1);
    await expect(readout).not.toContainText('snapped');

    await page.mouse.up();
  });

  /**
   * Two blocks are lined up when their centres share
   * an axis, and the line says so while there is
   * still a hand on the block to do something about
   * it.
   */
  test('draws a line through a block it has come level with', async ({
    page,
  }) => {
    await openAtRest(page);

    const scale = await zoom(page);
    await holdNode(page, 'find_slot', { x: 0, y: 60 * scale });

    const guide = page.locator('[data-snap-guide]');

    await expect(guide).toHaveCount(1);
    await expect(guide).toHaveCSS('opacity', '0.55');
    await expect(guide).toHaveCSS('border-left-style', 'dashed');
    await expect(guide).toHaveCSS('border-left-color', 'rgb(83, 103, 255)');

    await page.mouse.up();
    await expect(guide).toHaveCount(0);
  });

  /**
   * Absent from the page, not merely invisible: a
   * line drawn wherever the block happens to be says
   * "lined up" everywhere, which says it nowhere.
   */
  test('draws none where nothing is level with it', async ({ page }) => {
    await openAtRest(page);

    const scale = await zoom(page);
    await holdNode(page, 'find_slot', { x: 60 * scale, y: 60 * scale });

    // The block really did travel, so the missing
    // line is a line that was not drawn rather than a
    // gesture that never got going.
    const at = await flowPosition(page, 'find_slot');
    expect(at.x).toBeGreaterThan(boxes['find_slot']!.x + GRID);

    await expect(page.locator('[data-readout]')).toHaveCount(1);
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0);

    await page.mouse.up();
  });

  test('lands the block on the grid', async ({ page }) => {
    const harness = await openAtRest(page);

    await holdNode(page, 'find_slot', { x: 70, y: 50 });
    await page.mouse.up();

    const sent = await harness.postedOfType('move');
    const positions = sent[0]!.positions as Record<
      string,
      { x: number; y: number }
    >;

    expect(positions['find_slot']!.x % GRID).toBe(0);
    expect(positions['find_slot']!.y % GRID).toBe(0);
  });

  /**
   * Moving a block says where it is and nothing
   * else. A wire that changed colour under a hand
   * tidying the picture would be saying the tidying
   * had changed what runs after what.
   */
  test('leaves every wire attached to it exactly as it was', async ({
    page,
  }) => {
    await openAtRest(page);

    const wires = ['e2', 'e3'].map((id) =>
      page.locator(`.react-flow__edge[data-id="${id}"] path.wire`),
    );

    const before = await Promise.all(
      wires.map(async (wire) => await strokeOf(wire)),
    );

    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    // The lift says the block really is off the
    // graph, so an unchanged wire is a wire that
    // held rather than a drag that never happened.
    await expect(
      page.locator('.react-flow__node[data-id="find_slot"] .lift'),
    ).toHaveCount(1);

    expect(
      await Promise.all(wires.map(async (wire) => await strokeOf(wire))),
    ).toEqual(before);

    await page.mouse.up();
  });

  test('nudges the selected block one square with an arrow key', async ({
    page,
  }) => {
    const harness = await openAtRest(page);

    await nodeBody(page, 'find_slot').click();
    await page.keyboard.press('ArrowRight');

    const sent = await harness.postedOfType('move');
    expect(sent).toHaveLength(1);

    const positions = sent[0]!.positions as Record<
      string,
      { x: number; y: number }
    >;

    // Every block, the way a drag names every block:
    // the first move a person makes pins the graph.
    expect(Object.keys(positions).sort()).toEqual(
      ir.nodes.map((one) => one.id).sort(),
    );
    expect(positions['find_slot']).toEqual({
      x: boxes['find_slot']!.x + GRID,
      y: boxes['find_slot']!.y,
    });
  });

  /**
   * A key held down repeats, and a message per
   * repeat would be several messages carrying one
   * base revision — the first landing and the rest
   * refused as stale. One press, however long, is
   * one edit.
   */
  test('writes once for a key held down, not once a repeat', async ({
    page,
  }) => {
    const harness = await openAtRest(page);

    await nodeBody(page, 'find_slot').click();

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');

    const sent = await harness.postedOfType('move');
    expect(sent).toHaveLength(1);

    const positions = sent[0]!.positions as Record<
      string,
      { x: number; y: number }
    >;

    // Three squares, in one message: the repeats
    // moved the block and the release reported it.
    expect(positions['find_slot']).toEqual({
      x: boxes['find_slot']!.x + GRID * 3,
      y: boxes['find_slot']!.y,
    });
  });

  /**
   * The whole row exists to say this. Where blocks
   * sit is a person's business; what runs after what
   * is the document's, and a gesture about the first
   * must not touch the second.
   */
  test('never says a word about the wiring', async ({ page }) => {
    const harness = await openAtRest(page);

    await holdNode(page, 'find_slot', { x: 70, y: 50 });
    await page.mouse.up();

    await nodeBody(page, 'parse_request').click();
    await page.keyboard.press('ArrowDown');

    expect(await harness.postedOfType('connect')).toHaveLength(0);
    expect(await harness.postedOfType('delete')).toHaveLength(0);

    const moves = await harness.postedOfType('move');

    // Both gestures reported, so the three claims
    // below are about what they said rather than
    // about their silence.
    expect(moves).toHaveLength(2);

    for (const sent of moves) {
      expect(Object.keys(sent)).toEqual(['type', 'baseRevision', 'positions']);
    }
  });
});

/**
 * Building the graph by hand: a block dragged in
 * from the rail, a block moved, and the graph laid
 * out again.
 *
 * Every one of them is a message. Nothing here
 * writes the picture it is drawing — the document
 * does, and the canvas draws what comes back —
 * which is what puts a drag on VS Code's undo
 * stack beside every other edit to the file.
 */
test.describe('building the graph', () => {
  test('drops a new block where the pointer let go of it', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.dragAndDrop('[data-palette-kind="step"]', '.react-flow__pane', {
      targetPosition: { x: 240, y: 180 },
    });

    const sent = await harness.postedOfType('addNode');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'addNode',
      baseRevision: ir.revision,
      kind: 'step',
    });

    const at = sent[0]!.position as { x: number; y: number };
    expect(Number.isInteger(at.x)).toBe(true);
    expect(Number.isInteger(at.y)).toBe(true);
  });

  /**
   * Every node's position, not the one that moved:
   * a person's first move pins the whole graph, and
   * dragging a selection of three is one write.
   */
  test('tells the host where every block is once one is moved', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    const node = page.locator('.react-flow__node[data-id="find_slot"]');
    const from = (await node.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 60, from.y + 40, {
      steps: 8,
    });
    await page.mouse.up();

    const sent = await harness.postedOfType('move');
    expect(sent).toHaveLength(1);

    const positions = sent[0]!.positions as Record<
      string,
      { x: number; y: number }
    >;

    expect(Object.keys(positions).sort()).toEqual(
      ir.nodes.map((one) => one.id).sort(),
    );
    expect(positions['find_slot']!.x).toBeGreaterThan(boxes['find_slot']!.x);
  });

  /**
   * Three blocks dragged together are one edit.
   *
   * The gesture is reported once and names
   * everything that moved in it. A handler that
   * wrote a document per block would spend the base
   * revision on the first one and have the other two
   * refused as stale — two thirds of a drag silently
   * lost, which is exactly the kind of thing nobody
   * notices until the file is wrong.
   */
  test('writes a whole selection once, not once a block', async ({ page }) => {
    const harness = await openCanvas(page);

    const moving = ['booking_requested', 'parse_request', 'find_slot'];

    const before = new Map(
      await Promise.all(
        ir.nodes.map(
          async (node) => [node.id, await flowPosition(page, node.id)] as const,
        ),
      ),
    );

    await rubberBand(page, moving);

    const grabbed = page.locator('.react-flow__node[data-id="find_slot"]');
    const from = (await grabbed.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2 + 80,
      from.y + from.height / 2 + 40,
      { steps: 8 },
    );
    await page.mouse.up();

    const sent = await harness.postedOfType('move');
    expect(sent).toHaveLength(1);

    const positions = sent[0]!.positions as Record<
      string,
      { x: number; y: number }
    >;

    expect(Object.keys(positions).sort()).toEqual(
      ir.nodes.map((one) => one.id).sort(),
    );

    for (const [id, at] of Object.entries(positions)) {
      // Whole pixels, every one of them: the
      // document's own schema refuses a fraction,
      // and a rejected move is a drag that did
      // nothing.
      expect(Number.isInteger(at.x)).toBe(true);
      expect(Number.isInteger(at.y)).toBe(true);

      const was = before.get(id)!;

      if (moving.includes(id)) {
        expect(at.x).toBeGreaterThan(was.x);
        expect(at.y).toBeGreaterThan(was.y);
      } else {
        expect(at).toEqual({ x: Math.round(was.x), y: Math.round(was.y) });
      }
    }
  });

  test('asks for the graph to be laid out again', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('[data-arrange]').click();

    expect(await harness.postedOfType('arrange')).toEqual([
      { type: 'arrange', baseRevision: ir.revision },
    ]);
  });

  /**
   * The key deletes nothing locally. React Flow
   * would drop the node out of its own copy and
   * leave the document holding a workflow nobody
   * asked for, so what the key does is say so and
   * wait for the file to come back.
   *
   * One message, and one only. The graph library
   * hands over every wire touching the block as
   * well as the block, and a message apiece would
   * all carry this revision — each applied to the
   * document as it stands now, so only the last of
   * them would survive and the block would still be
   * there.
   */
  test('deletes a block and its wires through the document', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await page.locator('.react-flow__node[data-id="find_slot"]').click();
    const before = (await harness.posted()).length;

    await page.keyboard.press('Delete');

    expect(await harness.posted()).toHaveLength(before + 1);

    const [sent] = await harness.postedOfType('delete');

    expect(sent).toMatchObject({
      baseRevision: ir.revision,
      nodeIds: ['find_slot'],
    });
    expect([...(sent!['edgeIds'] as string[])].sort()).toEqual([
      'e2',
      'e3',
      'e8',
    ]);

    await expect(
      page.locator('.react-flow__node[data-id="find_slot"]'),
    ).toBeVisible();
  });

  test('deletes a wire the same way', async ({ page }) => {
    const harness = await openCanvas(page);

    // The wire out of the last block: the
    // loop-closing one elbows over half the graph,
    // and a click that landed on that would be a
    // spec about the wrong edge.
    await clickWire(page, 'e11');
    await page.keyboard.press('Delete');

    expect(await harness.postedOfType('delete')).toEqual([
      {
        type: 'delete',
        baseRevision: ir.revision,
        nodeIds: [],
        edgeIds: ['e11'],
      },
    ]);
  });

  /**
   * The canvas holds its own nodes once they can be
   * dragged, so a message that is not a new layout
   * — a manifest finishing, a different block
   * selected — must not put them back where the
   * document says they are.
   */
  test('keeps a block where it was dragged until the document answers', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    const node = page.locator('.react-flow__node[data-id="find_slot"]');
    const from = (await node.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 60, from.y + 40, {
      steps: 8,
    });
    await page.mouse.up();

    const moved = await flowPosition(page, 'find_slot');

    // The same layout, with the code-behind now read.
    await harness.show(canvasInit({ ...showing('find_slot') }));

    expect(await flowPosition(page, 'find_slot')).toEqual(moved);
  });
});

/**
 * The chrome follows the theme, which is the one
 * thing every VS Code user notices immediately. The
 * ground a canvas is drawn on is the editor's own,
 * so what is asserted is the colour that editor
 * publishes rather than a colour this product chose.
 */
test.describe('every theme', () => {
  for (const theme of THEMES_ALL) {
    test(`draws on the editor’s own ground in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const expected = colourOf(theme, 'canvas');

      expect(sameColour(ground, expected), `${ground} ≠ ${expected}`).toBe(
        true,
      );

      await expect(page.locator('[data-caption="graph"]')).toBeVisible();
    });
  }

  /**
   * The three roles the shared classes are built
   * out of. Each is mixed against a ground the
   * theme chose, so what is asserted is that the
   * mix resolves at all — a token that does not is
   * an empty string, and every rule reading it
   * silently falls back to the initial value.
   */
  for (const theme of THEMES_ALL) {
    test(`mixes the shared roles against the ${theme} ground`, async ({
      page,
    }) => {
      await openCanvas(page, theme);

      const roles = await page.evaluate(() => {
        const style = getComputedStyle(document.body);

        return {
          tint: style.getPropertyValue('--brand-tint-2').trim(),
          soft: style.getPropertyValue('--ink-soft').trim(),
          tracking: style.getPropertyValue('--label-tracking').trim(),
        };
      });

      expect(roles.tint).not.toBe('');
      expect(roles.soft).not.toBe('');
      expect(roles.tracking).not.toBe('');
    });
  }

  /**
   * Every colour on the board is one this product
   * chose. The graph library publishes a default
   * for each part it draws, picked against a white
   * diagramming page, and a part drawn in one of
   * those is a part wearing somebody else's theme
   * in the middle of the editor's.
   */
  for (const theme of THEMES_ALL) {
    test(`draws its own dots and wires in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);
      await clickWire(page, 'e11');

      await expect(
        page.locator('.react-flow__edge[data-id="e11"]'),
      ).toHaveClass(/selected/);

      const painted = await page.evaluate(() => {
        const dot = document.querySelector(
          '.react-flow__background-pattern.dots',
        );
        const wire = document.querySelector('.react-flow__edge.selected .wire');

        if (dot === null || wire === null) return undefined;

        return {
          dot: getComputedStyle(dot).fill,
          wire: getComputedStyle(wire).stroke,
        };
      });

      if (painted === undefined) throw new Error('the board drew nothing');

      for (const [part, colour] of Object.entries(painted)) {
        expect(LIBRARY_COLOURS, `${part} in ${theme}`).not.toContain(colour);
      }

      const expected = colourOf(theme, 'grid-dot');

      expect(
        sameColour(painted.dot, expected),
        `${painted.dot} ≠ ${expected}`,
      ).toBe(true);
    });
  }

  /**
   * A block is a tab stop here, because the arrow
   * keys nudge whichever one a person is on. The
   * library hides the ring on it, which leaves a
   * keyboard with no way of saying where it is.
   */
  for (const theme of THEMES_ALL) {
    test(`rings the block a keyboard is on in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const node = page.locator('.react-flow__node[data-id="find_slot"]');
      await node.focus();

      await expect(node).toHaveCSS('outline-style', 'solid');

      const ring = await node.evaluate(
        (block) => getComputedStyle(block).outlineColor,
      );
      const expected = colourOf(theme, 'focus-ring');

      expect(sameColour(ring, expected), `${ring} ≠ ${expected}`).toBe(true);
    });
  }
});

/**
 * Two views draw the same tab strip and the same
 * focus ring, so both live in the token layer
 * rather than twice in two sheets. These mount a
 * view and put the bare markup on the page: what is
 * being checked is the rule, not the component that
 * will eventually carry it.
 */
test.describe('the controls two views share', () => {
  test('keeps the focus ring on a control that unsets everything', async ({
    page,
  }) => {
    await openCanvas(page);

    await page.evaluate(() => {
      const tab = document.createElement('button');
      tab.id = 'bare-tab';
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.textContent = 'Graph';
      document.body.prepend(tab);
    });

    await page.keyboard.press('Tab');

    const tab = page.locator('button#bare-tab');
    await expect(tab).toBeFocused();

    // `all: unset` takes the outline with it, which
    // would leave a keyboard user with no idea
    // where they are.
    await expect(tab).not.toHaveCSS('outline-style', 'none');

    // And the half that fails before the rule
    // exists: a bare button already wears the
    // global focus ring, so the outline alone would
    // pass against nothing. A bare one lays itself
    // out as an inline block, so this is the rule
    // speaking and not the browser.
    await expect(tab).toHaveCSS('display', 'inline-flex');
  });

  /**
   * A tab is furniture, and furniture is set in the
   * case it was written in. Capitals and the
   * tracking that opens them up are spent on what a
   * run is doing right now, which is the one thing
   * worth finding across a panel.
   */
  test('draws a tab in the case it was written', async ({ page }) => {
    await openCanvas(page);

    await page.evaluate(() => {
      const tab = document.createElement('button');
      tab.id = 'quiet-tab';
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.textContent = 'Graph';

      const word = document.createElement('span');
      word.id = 'loud-word';
      word.className = 'state-word';
      word.textContent = 'running';

      document.body.prepend(tab, word);
    });

    const tab = page.locator('button#quiet-tab');
    await expect(tab).toHaveCSS('text-transform', 'none');
    await expect(tab).toHaveCSS('letter-spacing', 'normal');

    // The other half of the same rule, so that
    // "nothing shouts" cannot pass by nothing
    // carrying the rule at all.
    const word = page.locator('span#loud-word');
    await expect(word).toHaveCSS('text-transform', 'uppercase');
    await expect(word).not.toHaveCSS('letter-spacing', 'normal');
  });
});

/**
 * The rule the whole string mechanism rests on: a
 * webview has no localization bundle, so every word
 * it draws has to arrive in the host's message. A
 * literal compiled into the bundle would be
 * untranslatable and nothing else would catch it.
 */
test.describe('the built bundles', () => {
  test('carry none of the words the host resolves', async ({ page }) => {
    const harness = await mount(page, 'canvas');

    // Every word below arrives in the message. Had
    // the bundle held a copy of its own, what is
    // sent here is not what would appear.
    await harness.show(
      canvasInit({
        manifest: undefined,
        strings: {
          ...canvasStrings,
          blocks: 'BLOKKEN',
          noLib: 'NIETS GESCAND',
          canvas: 'DOEK',
        },
      }),
    );

    await expect(page.locator('.palette .section-label').first()).toHaveText(
      'BLOKKEN',
    );
    await expect(page.locator('.palette .empty-state .empty-title')).toHaveText(
      'NIETS GESCAND',
    );
    await expect(page.locator('[data-view-toggle="canvas"]')).toHaveText(
      'DOEK',
    );
  });

  /**
   * The eleven glyphs are paths written out in this
   * repository. An icon package pulled in beside
   * them would ship a thousand more to draw eleven,
   * and the two sets would drift apart the first
   * time either was touched.
   */
  test('draw their glyphs from here, not from an icon package', () => {
    const bundle = readFileSync(join(DIST, 'webview', 'canvas.js'), 'utf8');

    // Said both ways round. A scan pointed at the
    // wrong file finds nothing, and finding nothing
    // is what this would otherwise call a pass.
    expect(bundle).toContain(ICON_PATHS.trigger[0]);
    expect(bundle).not.toContain('lucide');
  });
});

/* — driving the page — */

/** The block itself, inside the wrapper the graph
 *  library positions. */
function nodeBody(page: Page, node: string): Locator {
  return page.locator(`.react-flow__node[data-id="${node}"] .node`);
}

/** The mark at the end of a block, saying what the
 *  run did there. */
function runMark(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('[data-run]');
}

/** The line of one wire, which is what the run is
 *  drawn on rather than the group around it. */
function wireBody(page: Page, edge: string): Locator {
  return page.locator(`.react-flow__edge[data-id="${edge}"] .wire`);
}

/**
 * What a wire's line and its arrowhead are drawn in.
 *
 * The arrowhead is whichever marker the page ends
 * the line in, read from the line's computed style
 * rather than its attribute, so a rule that swaps
 * the marker is measured as well as one that swaps
 * the stroke.
 */
function wireInk(
  page: Page,
  edge: string,
): Promise<{ line: string; head: string }> {
  return wireBody(page, edge).evaluate((wire) => {
    const style = getComputedStyle(wire);
    const id = /#([\w-]+)/.exec(style.markerEnd)?.[1];
    const head =
      id === undefined ? null : document.querySelector(`marker#${id} path`);

    return {
      line: style.stroke,
      head: head === null ? '' : getComputedStyle(head).stroke,
    };
  });
}

/** The ring around a block a wire being drawn could
 *  land on. */
function ringOf(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('[data-ring]');
}

/** The one mono line under a block's title. */
function nodeLine(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('.node-line');
}

/** The tile a block's glyph sits in. */
function tile(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('.node-icon');
}

function targetHandle(page: Page, node: string): Locator {
  return page.locator(
    `.react-flow__node[data-id="${node}"] .react-flow__handle-top`,
  );
}

/**
 * A real pointer drag. The graph library measures
 * the DOM and listens for pointer events, so a
 * synthesised connection would prove nothing about
 * whether one can be drawn.
 */
async function dragBetween(
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}

/**
 * Selects exactly those blocks, by drawing a box
 * around them.
 *
 * A box rather than a modifier and a click: which
 * key adds to a selection is the platform's answer,
 * and this browser answers with the one the same
 * platform turns into a context menu. Shift and a
 * box mean the same thing everywhere.
 *
 * The box spans the pane, so it starts on ground
 * rather than on a block, and reaches a little way
 * past the group in each direction — far enough to
 * hold all of it, nowhere near the next block up or
 * down.
 */
async function rubberBand(page: Page, ids: string[]): Promise<void> {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const wanted = await Promise.all(
    ids.map(
      async (id) =>
        (await page
          .locator(`.react-flow__node[data-id="${id}"]`)
          .boundingBox())!,
    ),
  );

  const clearance = 8;
  const top = Math.min(...wanted.map((box) => box.y)) - clearance;
  const bottom =
    Math.max(...wanted.map((box) => box.y + box.height)) + clearance;

  await page.keyboard.down('Shift');
  await page.mouse.move(pane.x + 2, top);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 2, bottom, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // Said here so that a box that caught the wrong
  // blocks fails as itself, rather than as whatever
  // the drag afterwards then wrote.
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(
    ids.length,
  );
}

/**
 * Presses a block chip and moves the pointer that
 * far, still holding it.
 *
 * A real press, because the whole gesture is about
 * how far the pointer has travelled since it went
 * down. Answers where the press was, so a caller can
 * carry on from there.
 */
async function holdBlock(
  page: Page,
  kind: NodeKind,
  by: number,
): Promise<{ x: number; y: number }> {
  const chip = (await page
    .locator(`[data-palette-kind="${kind}"]`)
    .boundingBox())!;

  const at = { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 };

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + by, at.y);

  return at;
}

/**
 * Presses on a block already on the graph and moves
 * it that far, still holding it.
 *
 * In screen pixels, because that is what a hand
 * moves. The graph is fitted to its pane, so a
 * caller who means a distance on the graph itself
 * has to multiply by the zoom.
 *
 * Two moves rather than one, because the graph
 * spends the first of them deciding that this is a
 * drag and moves nothing. What comes back is where
 * the drag counts from, which is what a caller who
 * means an exact distance has to measure from.
 */
async function holdNode(
  page: Page,
  id: string,
  by: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);

  // Pointed at rather than aimed at: hovering waits
  // for the block to hold still, and the canvas
  // fits the graph to its pane a frame or two after
  // the view opens. A press aimed at where a block
  // was lands on the graph behind it.
  await node.hover();

  const box = (await node.boundingBox())!;

  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = { x: at.x + 4, y: at.y + 4 };

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(at.x + by.x, at.y + by.y, { steps: 4 });

  return from;
}

/** What colour a wire is actually drawn in, resolved
 *  rather than as the sheet spells it. */
async function strokeOf(wire: Locator): Promise<string> {
  return await wire.evaluate((path) => getComputedStyle(path).stroke);
}

/** And what colour a word is drawn in, the same
 *  way. */
async function inkOf(words: Locator): Promise<string> {
  return await words.evaluate((element) => getComputedStyle(element).color);
}

/**
 * What a theme draws a gesture's words in.
 *
 * Brand blue, because somebody is doing it — but
 * where a theme carries state in the ink the brand
 * is too light to be read as text, and every word
 * it would colour is drawn in the ink instead.
 */
function gestureInk(theme: ThemeKind): string {
  return colourOf(theme, 'state-ink') || colourOf(theme, 'brand');
}

/** The same, carried well past the threshold and out
 *  over open canvas, with nothing let go of. */
async function dragBlockOverPane(page: Page, kind: NodeKind): Promise<void> {
  await holdBlock(page, kind, 8);

  const pane = (await page.locator('.react-flow__pane').boundingBox())!;

  await page.mouse.move(pane.x + pane.width - 30, pane.y + 30, { steps: 8 });
}

/**
 * Moves the pointer into the gap one wire has
 * opened.
 *
 * By where the gap actually is on screen rather than
 * by working the graph's transform out again — the
 * gap is in the page by the time this is called, and
 * asking it is both shorter and harder to get wrong.
 */
async function overGap(page: Page, edge: string): Promise<void> {
  const gap = (await page
    .locator(`[data-splice-gap="${edge}"]`)
    .boundingBox())!;

  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2, {
    steps: 8,
  });
}

/** How far the graph is zoomed in, read off the
 *  transform the library sets. */
async function zoom(page: Page): Promise<number> {
  await graphAtRest(page);

  return await page.evaluate(() => {
    const viewport = document.querySelector(
      '.react-flow__viewport',
    ) as HTMLElement;

    return Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)![1]);
  });
}

/** Where the graph library put a node, in the
 *  graph's own coordinates. */
async function flowPosition(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  return await page.evaluate((nodeId) => {
    const element = document.querySelector(
      `.react-flow__node[data-id="${nodeId}"]`,
    ) as HTMLElement;

    const [x, y] = /translate\(([-\d.]+)px, ?([-\d.]+)px\)/
      .exec(element.style.transform)!
      .slice(1)
      .map(Number);

    return { x: x!, y: y! };
  }, id);
}

/**
 * What core says about the wire, computed here so
 * the assertion cannot drift from the rule.
 *
 * The type rule, specifically: the pair the spec
 * drags is one whose types disagree and whose loops
 * and reachability are otherwise untouched, so this
 * is the finding a person sees.
 */
function whatCoreSays(from: string, port: string, to: string): string {
  const producer = ir.nodes.find((node) => node.id === from);

  const wire = {
    id: 'e99',
    from: { node: from, port },
    to: { node: to },
    back: false,
    ...(producer?.out === undefined ? {} : { type: producer.out }),
  };

  return validateWorkflow(
    { ...ir, edges: [...ir.edges, wire] },
    { manifest },
  ).find((found) => found.code === 'V06' && found.edgeId === 'e99')!.message;
}

/**
 * What core says about a graph that loops back on
 * itself without saying so.
 *
 * Named after nothing, because that is the shape of
 * the finding: no node and no edge is at fault, the
 * document as a whole is. It is the reason a check
 * that reads only what was said about the new wire
 * cannot see a cycle at all.
 */
function whatCoreSaysAboutTheGraph(): string {
  const looped = {
    ...ir,
    edges: [
      ...ir.edges,
      {
        id: 'e99',
        from: { node: 'send_confirmation', port: 'out' },
        to: { node: 'parse_request' },
        back: false,
      },
    ],
  };

  return validateWorkflow(looped, { manifest }).find(
    (found) => found.code === 'V04',
  )!.message;
}
