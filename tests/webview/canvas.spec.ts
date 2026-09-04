import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { DIST } from '../../src/build.js';

import { layoutKeyOf } from '../../src/canvas/graph.js';
import { GRID, snap } from '../../src/canvas/grid.js';
import { configToForm } from '../../src/canvas/inspector/forms.js';
import {
  NODE_PALETTE,
  WorkflowIRSchema,
  handlerFit,
  nodeSize,
  starterNode,
  validateWorkflow,
  withDecisionCases,
  type LibManifest,
  type NodeKind,
  type WorkflowIR,
  type WorkflowNode,
} from '../../src/core/rules.js';
import type {
  CanvasInit,
  CanvasInspector,
  CanvasStrings,
  DecisionOutcome,
  InspectorStrings,
} from '../../src/webview/protocol.js';

import { mount, type ThemeKind } from './harness.js';

/**
 * The canvas, driven — palette, graph and the
 * Inspector column, which are one bundle and one
 * message.
 *
 * Selecting a block is a round trip: the canvas
 * says which one, and the host sends the canvas
 * back with that block in its column. The specs
 * below play the host's half, because the whole
 * point of the column is that both halves land in
 * the same frame.
 *
 * The words the view draws are the ones sent in
 * below, not the ones the extension resolves. That
 * the host resolves the right ones — and that a
 * webview contains none of its own — is checked
 * where the host is, and by the bundle scan at the
 * bottom of this file.
 */

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../mboss-core/fixtures/${name}`, import.meta.url),
      ),
      'utf8',
    ),
  );
}

const ir = WorkflowIRSchema.parse(fixture('ir/groom_booking.workflow.json'));
const boxes = fixture(
  'golden/layout/groom_booking.layout.json',
) as CanvasInit['boxes'];
const manifest = fixture('golden/manifest/lib.manifest.json') as LibManifest;

const canvasStrings: CanvasStrings = {
  caption: 'Workflow IR — the source of truth',
  unreadable: 'Not a workflow document.',
  canvas: 'Canvas',
  json: 'JSON',
  graph: 'graph',
  blocks: 'Blocks',
  lib: '/lib · from manifest',
  noLib: 'Nothing scanned yet.',
  unassigned: 'unassigned',
  typedWiring: 'Typed wiring',
  arrange: 'Arrange',
  libFnDragging: 'dragging {0}…',
  blockDragging: '{0} · dragging',
  spliceHere: 'splice here',
  spliceNote: 'edge splits on drop',
  dragHint: 'drag starts after {0} px of movement · esc cancels',
  readout: 'x {0} · y {1}',
  snapped: '{0} — snapped',
  groups: {
    start: 'Start',
    work: 'Work',
    control: 'Control',
    people: 'People',
  },
  misfits: {
    'no-handler-kind': 'this block runs no code',
    'too-many-params': 'takes {0} arguments, needs one',
    'input-mismatch': 'takes {0}, needs {1}',
    'output-mismatch': 'returns {0}, needs {1}',
    'not-a-decision': 'returns {0}, decides nothing',
  },
};

const paletteLabels = Object.fromEntries(
  NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
) as CanvasInit['paletteLabels'];

function canvasInit(over: Partial<CanvasInit> = {}): CanvasInit {
  const shown = { document: { ok: true, ir } as CanvasInit['document'], boxes };
  const drawn = { ...shown, ...over };

  return {
    type: 'init',
    view: 'canvas',
    strings: canvasStrings,
    paletteLabels,
    ...shown,

    // Worked out the way the host works it out, so a
    // spec that shows a different graph gets a
    // different key without having to say so.
    layoutKey: drawn.document.ok
      ? layoutKeyOf(drawn.document.ir, drawn.boxes)
      : '',
    diagnostics: validateWorkflow(ir, { manifest }),
    manifest,
    inspector: { strings: inspectorStrings, selected: undefined },
    preview: undefined,
    run: undefined,
    ...over,
  };
}

/**
 * A block of every kind, in a column.
 *
 * The canonical fixture is a real workflow and so
 * uses six of the ten kinds. Seeing that each kind
 * draws its own glyph takes a document that holds
 * them all, which no workflow anybody would write
 * does.
 */
const everyKind = WorkflowIRSchema.parse({
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 1,
  name: 'every_kind',
  nodes: NODE_PALETTE.map((entry) =>
    starterNode(entry.kind, slugOf(entry.kind), entry.label),
  ),
  edges: [],
});

const everyKindBoxes: CanvasInit['boxes'] = Object.fromEntries(
  everyKind.nodes.map((node, index) => {
    const { width, height } = nodeSize(node.kind);

    return [node.id, { x: 0, y: index * 90, w: width, h: height }];
  }),
);

/** A kind's id, written the way node ids are: a
 *  lower-case slug, so `apiCall` is `api_call`. */
function slugOf(kind: NodeKind): string {
  return kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The column of every kind, on a page. */
async function openEveryKind(page: Page) {
  const harness = await mount(page, 'canvas');
  await harness.show(
    canvasInit({
      document: { ok: true, ir: everyKind },
      boxes: everyKindBoxes,
      diagnostics: [],
    }),
  );

  return harness;
}

const inspectorStrings: InspectorStrings = {
  heading: 'Node inspector',
  nothingSelected: 'Pick a block.',
  kinds: paletteLabels,
  fields: {
    ...Object.fromEntries(
      [
        'title',
        'in',
        'out',
        'handler',
        'logic',
        'database',
        'cases',
        'elsePort',
        'port',
        'predicatePath',
        'predicateOp',
        'predicateValue',
        'maxIterations',
        'onExhausted',
      ].map((id) => [id, id]),
    ),

    // One field carries its real word rather than
    // its id. A block runs a function and a branch
    // runs its logic, and the column picks between
    // them by field id — so an expectation of
    // `handler` would read the same whichever one
    // it drew.
    handler: 'function',
  },
  options: {},
  lib: '/lib · matched by signature',
  hidden: '{0} incompatible functions hidden · show',
  hide: 'Hide incompatible functions',
  newFunction: 'New function…',
  noLib: 'Nothing scanned yet.',
  dropHere: 'drop a ƒ here',
  end: 'end',
  database: 'app postgres · prisma tx',
  callouts: {
    branch: {
      title: 'Branches own no code.',
      body: 'The Lib function is the logic.',
    },
    transaction: {
      title: 'One commit.',
      body: 'The writes and the record of them land together.',
    },
  },
};

/** What the host sends back once it has been told
 *  which block was clicked. */
function showing(
  nodeId: string,
  over: Partial<WorkflowNode> = {},
): CanvasInspector {
  const node = {
    ...ir.nodes.find((one) => one.id === nodeId)!,
    ...over,
  } as WorkflowNode;

  return {
    strings: inspectorStrings,
    selected: {
      node,
      form: configToForm(node),
      revision: ir.revision,
      outcomes: outcomesOf(node),
    },
  };
}

/**
 * Where each outcome of a decision goes, worked out
 * the way the host works it out — from the document
 * rather than from a list written into the spec, so
 * the assertion cannot drift from the graph.
 */
function outcomesOf(node: WorkflowNode): DecisionOutcome[] {
  if (node.kind !== 'branch' || node.handler === undefined) return [];

  return node.config.cases.map((one) => {
    const edge = ir.edges.find(
      (wire) => wire.from.node === node.id && wire.from.port === one.port,
    );

    return {
      value: String(one.when.value),
      target: ir.nodes.find((to) => to.id === edge?.to.node)?.title,
    };
  });
}

/** The graph, on a page, showing the canonical
 *  fixture. */
async function openCanvas(page: Page, theme: ThemeKind = 'light') {
  const harness = await mount(page, 'canvas', theme);
  await harness.show(canvasInit());

  return harness;
}

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
async function openAtRest(page: Page, over: Partial<CanvasInit> = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const harness = await mount(page, 'canvas');
  await harness.show(canvasInit(over));

  return harness;
}

test.describe('the palette', () => {
  test('offers the catalog’s ten kinds, in its order', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('[data-palette-kind]')).toHaveText(
      NODE_PALETTE.map((entry) => entry.label),
    );
  });

  test('groups them the way the catalog groups them', async ({ page }) => {
    await openCanvas(page);

    const control = page.locator('.drawer', { hasText: 'Control' });

    await expect(control.locator('[data-palette-kind]')).toHaveText([
      'Branch',
      'Loop',
      'Wait',
    ]);
  });

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

    await expect(page.locator('.drawer-empty')).toHaveText(canvasStrings.noLib);
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
  });
});

/**
 * The glyph each kind is drawn in, written out.
 *
 * Ten distinct glyphs are not ten right ones: a
 * Loop wearing the Trigger's bolt differs from
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
      .locator('.node-icon svg')
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
   * A path the browser cannot parse is dropped in
   * silence. The glyph comes out missing a stroke,
   * which reads as a slightly different icon rather
   * than as a broken one, and the console is the
   * only place it is ever mentioned.
   */
  test('draws all ten without the browser refusing a stroke', async ({
    page,
  }) => {
    const complaints: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') complaints.push(message.text());
    });

    await openEveryKind(page);

    await expect(page.locator('.node-icon svg')).toHaveCount(
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

    await expect(nodeLine(page, 'step')).toHaveText('Step · unassigned');
    await expect(nodeLine(page, 'branch')).toHaveText('Branch · unassigned');
  });

  test('says only what a block that runs no code of its own is', async ({
    page,
  }) => {
    await openEveryKind(page);

    await expect(nodeLine(page, 'trigger')).toHaveText('Trigger');
    await expect(nodeLine(page, 'loop')).toHaveText('Loop');
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

    await expect(page.locator('.wire-label')).toHaveCount(0);
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
    await openAtRest(page, { inspector: showing('find_slot') });

    const block = nodeBody(page, 'find_slot');

    await expect(block).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    // Four shadows and not one merged value: the
    // ring, the softer ring around it, and the two
    // the block was already sitting on. Selected is
    // lit and still raised.
    await expect(block).toHaveCSS(
      'box-shadow',
      'rgb(83, 103, 255) 0px 0px 0px 1.5px, color(srgb 0.32549 0.403922 1 / 0.3) 0px 0px 0px 5px, rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, rgba(23, 26, 35, 0.07) 0px 4px 12px 0px',
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
      inspector: showing('await_reply'),
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
      'rgb(83, 103, 255) 0px 0px 0px 1.5px, color(srgb 0.32549 0.403922 1 / 0.3) 0px 0px 0px 5px, rgba(23, 26, 35, 0.06) 0px 1px 3px 0px, rgba(23, 26, 35, 0.07) 0px 4px 12px 0px',
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
    await openAtRest(page, {
      run: {
        workflowId: 'wf_1',
        workflow: 'groom_booking',
        status: 'PENDING',
        steps: [
          { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
          { name: 'find_slot', nodeId: 'find_slot', state: 'done' },
        ],
        recovered: false,
        outcome: 'running',
      },
    });

    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'done',
    );
    await expect(nodeBody(page, 'twilio_chat')).toHaveAttribute(
      'data-state',
      'running',
    );
    await expect(
      page.locator('.react-flow__edge[data-id="e2"] .wire'),
    ).toHaveAttribute('data-state', 'done');
    await expect(
      page.locator('.react-flow__edge[data-id="e5"] .wire'),
    ).toHaveAttribute('data-state', 'active');
  });
});

/** Tint and ink per tone, as the browser resolves
 *  the mixes over this harness' light surface. */
const TONE_COLOURS = [
  {
    tone: 'neutral',
    tint: 'color(srgb 0.928078 0.928078 0.928078)',
    ink: 'color(srgb 0.231373 0.231373 0.231373 / 0.62)',
  },
  {
    tone: 'brand',
    tint: 'color(srgb 0.907843 0.915686 0.975294)',
    ink: 'rgb(83, 103, 255)',
  },
  {
    tone: 'agent',
    tint: 'color(srgb 0.933725 0.915686 0.975294)',
    ink: 'rgb(149, 103, 255)',
  },
  {
    tone: 'ok',
    tint: 'color(srgb 0.866667 0.942431 0.923608)',
    ink: 'rgb(23, 184, 144)',
  },
  {
    tone: 'warn',
    tint: 'color(srgb 0.964314 0.925333 0.868784)',
    ink: 'rgb(233, 162, 59)',
  },
  {
    tone: 'fail',
    tint: 'color(srgb 0.967843 0.899608 0.904784)',
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

    // Ten kinds, one tone between them. Ten kinds
    // in ten colours is a legend to memorise, and
    // the block worth finding across a graph is the
    // one something is happening to.
    await expect(page.locator('.node-icon[data-tone="neutral"]')).toHaveCount(
      NODE_PALETTE.length,
    );
  });

  test('turns brand for the selected block, agent for a proposed one', async ({
    page,
  }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        inspector: showing('find_slot'),
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

    expect(await harness.postedOfType('connect')).toEqual([]);
  });

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
        from: { node: 'find_slot', port: 'out' },
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
   * Quiet, and shaped like the rest of the chrome:
   * laying the graph out again is something a person
   * does now and then, and a button that shouted
   * would be competing with the graph it is about.
   */
  test('wears the shape of an action nobody needs often', async ({ page }) => {
    await openCanvas(page);

    const arrange = page.locator('[data-arrange]');

    await expect(arrange).toHaveCSS('border-radius', '6px');
    await expect(arrange).toHaveCSS('padding', '3px 10px');
    await expect(arrange).toHaveCSS('font-weight', '600');
    await expect(arrange).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(arrange).toHaveCSS(
      'color',
      'color(srgb 0.231373 0.231373 0.231373 / 0.62)',
    );
    await expect(arrange).toHaveCSS(
      'transition',
      'background 0.12s cubic-bezier(0.2, 0, 0, 1)',
    );

    // It takes a ground only under the pointer,
    // which is the whole of its reaction.
    await arrange.hover();
    await expect(arrange).toHaveCSS(
      'background-color',
      'color(srgb 0.928078 0.928078 0.928078)',
    );
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
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

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
 * The one place a block's config is set, and it is
 * a column of this canvas rather than a panel
 * somewhere else: clicking a block and reading what
 * it does happen in the same frame, without a view
 * being disposed in between.
 */
test.describe('the Inspector column', () => {
  /**
   * The column is the right-hand third of one grid,
   * and the blocks and the wires are the middle of
   * it. Nothing else in the suite would notice the
   * grid collapsing to a single track: every other
   * assertion here finds the column by class and
   * passes just as well when it is stacked under
   * the graph at full width, which is not a canvas
   * anybody can work in.
   */
  test('stands beside the graph, not under it', async ({ page }) => {
    await openCanvas(page);

    // The two outer tracks are fixed; the middle
    // one is whatever is left of the frame, which
    // at this suite's viewport is 792px.
    await expect(page.locator('.workspace')).toHaveCSS(
      'grid-template-columns',
      '204px 792px 284px',
    );
  });

  test('shows the block that was clicked, beside it', async ({ page }) => {
    const harness = await openCanvas(page);

    await page.locator('.react-flow__node[data-id="reply_decision"]').click();

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: 'reply_decision' },
    ]);

    // The host's half: the canvas comes back with
    // that block in its column.
    await harness.show(canvasInit({ inspector: showing('reply_decision') }));

    await expect(page.locator('[data-inspector-heading]')).toHaveText(
      'Node inspector · Branch',
    );
    await expect(page.locator('[data-field="title"] input')).toHaveValue(
      'Reply?',
    );
  });

  test('offers a field per thing the kind carries', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('reply_decision') }));

    await expect(page.locator('[data-field="elsePort"] input')).toHaveValue(
      'stop',
    );
    await expect(page.locator('[data-field="cases"] .row')).toHaveCount(2);
  });

  test('sends an edit once the field is finished with', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

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
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

    const title = page.locator('[data-field="title"] input');

    await title.fill('Something else entirely');
    await title.press('Escape');

    await expect(title).toHaveValue('Find open slot');
    expect(await harness.postedOfType('edit')).toEqual([]);
  });

  test('says so plainly when the canvas itself is clicked', async ({
    page,
  }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } });

    expect(await harness.postedOfType('select')).toEqual([
      { type: 'select', nodeId: null },
    ]);

    await harness.show(canvasInit());

    await expect(page.locator('.inspector .state')).toHaveText(
      inspectorStrings.nothingSelected,
    );
    await expect(page.locator('[data-field]')).toHaveCount(0);
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

  async function openPicker(page: Page) {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('slot_open') }));

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
    expect(await harness.postedOfType('assign')).toEqual([]);
  });

  test('says why there is nothing to pick from', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        manifest: undefined,
        inspector: showing('slot_open'),
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
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('slot_open') }));

    await expect(page.locator('[data-callout="branch"]')).toContainText(
      inspectorStrings.callouts.branch.title,
    );

    await harness.show(canvasInit({ inspector: showing('record_booking') }));

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
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        inspector: showing('slot_open', { handler: { export: 'tryAgain' } }),
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
    const harness = await mount(page, 'canvas');

    await harness.show(
      canvasInit({
        inspector: showing('slot_open', {
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
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

    await expect(page.locator('[data-field="handler"] .field-name')).toHaveText(
      'function',
    );
    await expect(page.locator('[data-field="logic"]')).toHaveCount(0);

    await harness.show(
      canvasInit({
        inspector: showing('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    await expect(page.locator('[data-field="logic"] .field-name')).toHaveText(
      'logic',
    );
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
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

    await expect(page.locator('[data-picker-value]')).toHaveText('findSlot ▾');

    await harness.show(canvasInit({ inspector: showing('slot_open') }));

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
    const harness = await mount(page, 'canvas');
    await harness.show(
      canvasInit({
        inspector: showing('slot_open', { handler: { export: 'tryAgain' } }),
      }),
    );

    const chosen = page.locator('[data-picker-fn="tryAgain"]');

    await expect(chosen).toHaveAttribute('data-state', 'assigned');
    await expect(chosen).toHaveCSS(
      'box-shadow',
      'color(srgb 0.32549 0.403922 1 / 0.3) 0px 0px 0px 1px inset',
    );
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
  async function lift(page: Page, row: Locator): Promise<void> {
    const transfer = await page.evaluateHandle(() => new DataTransfer());

    await row.dispatchEvent('dragstart', { dataTransfer: transfer });
  }

  test('marks the row the selected block already runs', async ({ page }) => {
    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

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
    await harness.show(canvasInit({ inspector: showing('slot_open') }));

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
   * Every wire offers a gap; one of them is the
   * offer. Filling all ten in would say the block
   * was about to go into all ten.
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
      'color(srgb 0.907843 0.915686 0.975294)',
    );
    await expect(page.locator('[data-splice-gap="e3"]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(
      page.locator('[data-splice-gap="e3"] .splice-title'),
    ).toHaveCount(0);

    await page.mouse.up();
  });

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
   * A block that has just arrived says nothing about
   * itself yet, and the column beside it is where
   * that gets said. The column is always drawn, so
   * nothing opens — what happens is that a person is
   * taken to it.
   *
   * Forced, rather than hoped for: the window is
   * made short enough that the column really
   * scrolls, and the spec says so before it scrolls
   * it away.
   */
  test('takes a person to what to say about the block next', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 240 });

    const harness = await mount(page, 'canvas');
    await harness.show(canvasInit({ inspector: showing('send_confirmation') }));

    const column = page.locator('.inspector');
    const heading = page.locator('[data-inspector-heading]');

    expect(
      await column.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);

    await column.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await inViewOf(heading, column)).toBe(false);

    await dragBlockOverPane(page, 'step');
    await page.mouse.up();

    expect(await inViewOf(heading, column)).toBe(true);
  });

  test('says how a drag starts and how to call it off', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('[data-drag-hint]')).toHaveText(
      'drag starts after 4 px of movement · esc cancels',
    );
  });
});

/**
 * The fixture's own layout, moved onto the grid.
 *
 * Core lays a graph out on a spacing of its own,
 * which is not this one, so every block on a
 * freshly-arranged graph starts a fraction of a
 * square off. That is the ordinary case and most of
 * the specs below want it — but the ones that turn
 * on whether the grid moved anything need a graph
 * that is already sitting on it.
 */
const onGrid: CanvasInit['boxes'] = Object.fromEntries(
  Object.entries(boxes).map(([id, box]) => [
    id,
    { ...box, x: snap(box.x), y: snap(box.y) },
  ]),
);

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

/** The ring, the softer ring around it, and the two
 *  the block was already sitting on. */
const SELECTED =
  'rgb(83, 103, 255) 0px 0px 0px 1.5px, ' +
  'color(srgb 0.32549 0.403922 1 / 0.3) 0px 0px 0px 5px, ' +
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
    await openAtRest(page, { boxes: onGrid });
    await holdNode(page, 'find_slot', { x: 70, y: 50 });

    const readout = page.locator('[data-readout]');
    const at = await flowPosition(page, 'find_slot');

    await expect(readout).toContainText(`x ${at.x} · y ${at.y}`);
    await expect(readout).toHaveCSS('color', 'rgb(83, 103, 255)');
    await expect(readout).toHaveCSS('font-size', '10px');

    await page.mouse.up();
    await expect(readout).toHaveCount(0);
  });

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
    await openAtRest(page, { boxes: onGrid });

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
    await openAtRest(page, { boxes: onGrid });

    const scale = await zoom(page);
    await holdNode(page, 'find_slot', { x: 60 * scale, y: 60 * scale });

    // The block really did travel, so the missing
    // line is a line that was not drawn rather than a
    // gesture that never got going.
    const at = await flowPosition(page, 'find_slot');
    expect(at.x).toBeGreaterThan(onGrid['find_slot']!.x + GRID);

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
    const harness = await openAtRest(page, { boxes: onGrid });

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
      x: onGrid['find_slot']!.x + GRID,
      y: onGrid['find_slot']!.y,
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
    const harness = await openAtRest(page, { boxes: onGrid });

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
      x: onGrid['find_slot']!.x + GRID * 3,
      y: onGrid['find_slot']!.y,
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
    await harness.show(canvasInit({ inspector: showing('find_slot') }));

    expect(await flowPosition(page, 'find_slot')).toEqual(moved);
  });
});

/**
 * The chrome follows the theme, which is the one
 * thing every VS Code user notices immediately. The
 * three appearances are checked for the ground
 * actually changing, not for a particular colour —
 * the colours are the user's.
 */
test.describe('every theme', () => {
  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`draws on the editor’s own ground in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      expect(ground).toBe(
        {
          light: 'rgb(255, 255, 255)',
          dark: 'rgb(31, 31, 31)',
          'high-contrast': 'rgb(0, 0, 0)',
        }[theme],
      );

      await expect(page.locator('[data-caption="graph"]')).toBeVisible();
    });
  }
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

    await expect(page.locator('.palette > .eyebrow')).toHaveText('BLOKKEN');
    await expect(page.locator('.drawer-empty')).toHaveText('NIETS GESCAND');
    await expect(page.locator('[data-view-toggle="canvas"]')).toHaveText(
      'DOEK',
    );
  });

  /**
   * The ten glyphs are paths written out in this
   * repository. An icon package pulled in beside
   * them would ship a thousand more to draw ten,
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

/** The one mono line under a block's title. */
function nodeLine(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('.node-line');
}

/** The tile a block's glyph sits in. */
function tile(page: Page, node: string): Locator {
  return nodeBody(page, node).locator('.node-icon');
}

function sourceHandle(page: Page, node: string, port: string): Locator {
  return page.locator(
    `.react-flow__node[data-id="${node}"] .react-flow__handle-bottom[data-handleid="${port}"]`,
  );
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
 * Clicks a wire on its own hit area.
 *
 * By the middle of the box rather than by the
 * element, because a straight vertical line has a
 * bounding box no wider than nothing and there is no
 * point in it Playwright will consent to click.
 */
async function clickWire(page: Page, edge: string): Promise<void> {
  const hit = page.locator(
    `.react-flow__edge[data-id="${edge}"] .react-flow__edge-interaction`,
  );
  const box = (await hit.boundingBox())!;

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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

/**
 * Whether the element is inside the part of its
 * column a person can actually see.
 *
 * By the boxes rather than by whether it is in the
 * page at all: a heading scrolled off the top of a
 * column is still in the DOM, still `toBeVisible`,
 * and still exactly what somebody cannot see.
 */
async function inViewOf(inner: Locator, outer: Locator): Promise<boolean> {
  const box = (await inner.boundingBox())!;
  const frame = (await outer.boundingBox())!;

  return (
    box.y + box.height > frame.y &&
    box.y < frame.y + frame.height &&
    box.x + box.width > frame.x &&
    box.x < frame.x + frame.width
  );
}

/**
 * Waits for the graph to stop moving itself.
 *
 * The canvas fits the graph to its pane once the
 * blocks have been measured, which is a frame or
 * two after the view opens. A coordinate read before
 * that is a coordinate the graph is about to change,
 * and a pointer aimed at it lands on nothing.
 */
async function graphAtRest(page: Page): Promise<void> {
  const transform = async (): Promise<string> =>
    await page
      .locator('.react-flow__viewport')
      .evaluate((viewport) => (viewport as HTMLElement).style.transform);

  let last = await transform();

  await expect
    .poll(async () => {
      const now = await transform();
      const still = now !== '' && now === last;

      last = now;

      return still;
    })
    .toBe(true);
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
