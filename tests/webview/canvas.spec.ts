import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { configToForm } from '../../src/canvas/inspector/forms.js';
import {
  NODE_PALETTE,
  WorkflowIRSchema,
  nodeSize,
  starterNode,
  validateWorkflow,
  type LibManifest,
  type NodeKind,
  type WorkflowIR,
} from '../../src/core/rules.js';
import type {
  CanvasInit,
  CanvasInspector,
  CanvasStrings,
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
  groups: {
    start: 'Start',
    work: 'Work',
    control: 'Control',
    people: 'People',
  },
};

const paletteLabels = Object.fromEntries(
  NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
) as CanvasInit['paletteLabels'];

function canvasInit(over: Partial<CanvasInit> = {}): CanvasInit {
  return {
    type: 'init',
    view: 'canvas',
    strings: canvasStrings,
    paletteLabels,
    document: { ok: true, ir },
    boxes,
    diagnostics: validateWorkflow(ir, { manifest }),
    manifest,
    inspector: { strings: inspectorStrings, selected: undefined },
    preview: undefined,
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
  fields: Object.fromEntries(
    [
      'title',
      'in',
      'out',
      'handler',
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
  options: {},
};

/** What the host sends back once it has been told
 *  which block was clicked. */
function showing(nodeId: string): CanvasInspector {
  const node = ir.nodes.find((one) => one.id === nodeId)!;

  return {
    strings: inspectorStrings,
    selected: { node, form: configToForm(node), revision: ir.revision },
  };
}

/** The graph, on a page, showing the canonical
 *  fixture. */
async function openCanvas(page: Page, theme: ThemeKind = 'light') {
  const harness = await mount(page, 'canvas', theme);
  await harness.show(canvasInit());

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

  test('is plotted on a dot grid', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('.react-flow__background')).toBeVisible();
    await expect(
      page.locator('.react-flow__background pattern circle').first(),
    ).toBeAttached();
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

test.describe('drawing a wire', () => {
  test('refuses one the types forbid, in core’s own words', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    await dragBetween(
      page,
      sourceHandle(page, 'parse_request', 'out'),
      targetHandle(page, 'slot_open'),
    );

    const refusal = page.locator('[data-rejection]');

    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(canvasStrings.typedWiring);
    await expect(refusal).toContainText(
      whatCoreSays('parse_request', 'out', 'slot_open'),
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

/** What core says about the wire, computed here so
 *  the assertion cannot drift from the rule. */
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
