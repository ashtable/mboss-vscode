import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { configToForm } from '../../src/canvas/inspector/forms.js';
import {
  NODE_PALETTE,
  WorkflowIRSchema,
  validateWorkflow,
  type LibManifest,
  type WorkflowIR,
} from '../../src/core/rules.js';
import type {
  CanvasInit,
  CanvasStrings,
  InspectorInit,
  InspectorStrings,
} from '../../src/webview/protocol.js';

import { mount, type ThemeKind } from './harness.js';

/**
 * The canvas and the Node Inspector, driven.
 *
 * These two are one feature and two bundles: a
 * webview cannot host a webview view, so selecting
 * a block reveals the Inspector beside the agent
 * rather than inside the canvas. What the canvas
 * owes the Inspector is a selection message, and
 * what the Inspector owes the document is an edit,
 * so both halves are checked here.
 *
 * The words the views draw are the ones sent in
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
    selected: undefined,
    preview: undefined,
    ...over,
  };
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

function inspectorInit(nodeId: string): InspectorInit {
  const node = ir.nodes.find((one) => one.id === nodeId)!;

  return {
    type: 'init',
    view: 'inspector',
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

  test('marks the one kind that lands whole or not at all', async ({
    page,
  }) => {
    await openCanvas(page);

    const transaction = page.locator('[data-node-kind="transaction"]');

    await expect(transaction).toHaveClass(/blueprint/);
    await expect(transaction.locator('.corner')).toHaveCount(4);

    await expect(
      page.locator('[data-node-kind="step"]').first().locator('.corner'),
    ).toHaveCount(0);
  });

  test('captions itself with the document’s own revision', async ({ page }) => {
    await openCanvas(page);

    await expect(page.locator('[data-caption="graph"]')).toHaveText(
      `groom_booking · graph v${ir.revision}`,
    );
  });

  test('labels each wire with the type flowing along it', async ({ page }) => {
    await openCanvas(page);

    for (const edge of ir.edges) {
      await expect(page.locator(`[data-edge-label="${edge.id}"]`)).toHaveText(
        edge.type!,
      );
    }
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
    await harness.show(canvasInit({ selected: 'find_slot' }));

    await expect(
      page.locator('.react-flow__node[data-id="find_slot"] .block'),
    ).toHaveAttribute('data-selected', 'true');
  });
});

test.describe('the Node Inspector', () => {
  test('names the kind it is showing', async ({ page }) => {
    const harness = await mount(page, 'inspector');
    await harness.show(inspectorInit('reply_decision'));

    await expect(page.locator('[data-inspector-heading]')).toHaveText(
      'Node inspector · Branch',
    );
  });

  test('offers a field per thing the kind carries', async ({ page }) => {
    const harness = await mount(page, 'inspector');
    await harness.show(inspectorInit('reply_decision'));

    await expect(page.locator('[data-field="elsePort"] input')).toHaveValue(
      'stop',
    );
    await expect(page.locator('[data-field="cases"] .row')).toHaveCount(2);
  });

  test('sends an edit once the field is finished with', async ({ page }) => {
    const harness = await mount(page, 'inspector');
    await harness.show(inspectorInit('find_slot'));

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
    const harness = await mount(page, 'inspector');
    await harness.show(inspectorInit('find_slot'));

    const title = page.locator('[data-field="title"] input');

    await title.fill('Something else entirely');
    await title.press('Escape');

    await expect(title).toHaveValue('Find open slot');
    expect(await harness.postedOfType('edit')).toEqual([]);
  });

  test('says so when nothing is selected', async ({ page }) => {
    const harness = await mount(page, 'inspector');
    await harness.show({
      type: 'init',
      view: 'inspector',
      strings: inspectorStrings,
      selected: undefined,
    });

    await expect(page.locator('.state')).toHaveText(
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
