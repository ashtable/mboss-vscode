import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { layoutKeyOf } from '../../src/canvas/graph.js';
import {
  NODE_PALETTE,
  WorkflowIRSchema,
  type WorkflowIR,
} from '../../src/core/rules.js';
import type {
  CanvasInit,
  CanvasInspector,
  CanvasPreview,
  CanvasStrings,
  SidebarInit,
  SidebarPreview,
  SidebarStrings,
} from '../../src/webview/protocol.js';

import { mount, type Harness } from './harness.js';

/**
 * A proposal, on screen.
 *
 * Two surfaces and one situation. The canvas draws
 * the graph the agent asked for — dashed and
 * translucent, so it reads as pencil over the
 * drawing rather than as the drawing — and says
 * what it would change. The panel is where a person
 * answers: approve it, or go back to the chat and
 * ask for something else.
 *
 * Nothing here is editable, and that is the point
 * being checked as much as the chrome is. The graph
 * on screen is not the document on disk, so a wire
 * drawn on it would write content nobody approved.
 *
 * The words are the ones sent in, as everywhere in
 * these specs; that the extension resolves the
 * right ones is checked where the extension is.
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

const ir: WorkflowIR = WorkflowIRSchema.parse(
  fixture('ir/groom_booking.workflow.json'),
);
const boxes = fixture(
  'golden/layout/groom_booking.layout.json',
) as CanvasInit['boxes'];

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
  releaseToConnect: '{0} → {1} ✓ · release to connect',
  quickAdd: 'Put a block here',
  groups: {
    start: 'Start',
    work: 'Work',
    control: 'Control',
    people: 'People',
  },
  misfits: {
    'no-handler-kind': 'this block runs no code of its own',
    'too-many-params': 'takes {0} arguments, needs one',
    'input-mismatch': 'takes {0}, needs {1}',
    'output-mismatch': 'returns {0}, needs {1}',
    'not-a-decision': 'returns {0}, decides nothing',
  },
};

const HEADLINE = 'PREVIEW — proposed by claude code · not applied yet';

const BANNER =
  'PREVIEW CHANGES · +2 nodes +2 edges · deterministic layout — ' +
  'the agent sent semantics, never coordinates';

const WARNING =
  'The graph changed since this was proposed, so it cannot be applied. ' +
  'Ask the agent to propose it again.';

/** Two blocks arriving, out of the ten drawn. */
const PROPOSED = ['twilio_chat', 'await_reply'];

/**
 * The Inspector column, showing nothing.
 *
 * A proposal is not the document, so the host lets
 * go of the selection while one is outstanding —
 * there is nothing on screen an edit could be made
 * to. The column is still drawn; it is the canvas.
 */
const inspector: CanvasInspector = {
  strings: {
    heading: 'Node inspector',
    nothingSelected: 'Pick a block.',
    kinds: Object.fromEntries(
      NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
    ) as CanvasInit['paletteLabels'],
    fields: {},
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
      branch: { title: 'Branches own no code.', body: 'The function is it.' },
      transaction: { title: 'One commit.', body: 'Both land together.' },
    },
  },
  selected: undefined,
};

function preview(over: Partial<CanvasPreview> = {}): CanvasPreview {
  return {
    headline: HEADLINE,
    banner: BANNER,
    warning: undefined,
    proposed: PROPOSED,
    named: ['Twilio chat', 'Await reply'],
    more: undefined,
    ...over,
  };
}

function canvasInit(over: Partial<CanvasInit> = {}): CanvasInit {
  return {
    type: 'init',
    view: 'canvas',
    strings: canvasStrings,
    paletteLabels: Object.fromEntries(
      NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
    ) as CanvasInit['paletteLabels'],
    document: { ok: true, ir },
    boxes,
    layoutKey: layoutKeyOf(ir, boxes),
    diagnostics: [],
    manifest: undefined,
    inspector,
    preview: preview(),
    run: undefined,
    ...over,
  };
}

const sidebarStrings: SidebarStrings = {
  heading: 'Agent',
  chooseAgent: 'Choose an agent',
  notTrusted: 'Trust this folder to run a coding agent.',
  noProject: 'Open a folder to run a coding agent in it.',
  noAgent: 'No coding agent chosen yet.',
  connecting: 'Starting the agent…',
  ready: 'Ready',
  thinking: 'Working…',
  send: 'Send',
  stop: 'Stop',
  placeholder: 'Edit the graph, scaffold a lib fn, or ask why…',
  newFile: 'new',
  permission: 'Permission needed',
  always: 'always',
  approve: 'Approve & apply',
  refine: 'Refine',
  undo: 'Undo',
  toolStatus: {
    pending: 'queued',
    in_progress: 'running',
    completed: 'done',
    failed: 'failed',
  },
  keepEdit: 'Keep',
  undoEdit: 'Undo',
  keepAllEdits: 'Keep all',
  undoAllEdits: 'Undo all',
  filesChanged: '{0} files changed',
  changedSince: 'changed since · nothing to undo',
  showLines: '{0} lines · show',
  planProgress: 'Plan · {0}/{1}',
};

function sidebarInit(card: SidebarPreview | undefined): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings: sidebarStrings,
    agent: 'claude code',
    status: 'ready',
    transcript: [],
    prompt: undefined,
    failure: undefined,
    preview: card,
  };
}

const outstanding: SidebarPreview = {
  at: 'proposed',
  id: 'prop_1_abcdef01',
  workflow: 'groom_booking',
  headline: HEADLINE,
  summary: BANNER,
};

async function openCanvas(
  page: Page,
  over: Partial<CanvasInit> = {},
): Promise<Harness> {
  const harness = await mount(page, 'canvas');
  await harness.show(canvasInit(over));

  return harness;
}

async function openPanel(
  page: Page,
  card: SidebarPreview | undefined,
): Promise<Harness> {
  const harness = await mount(page, 'sidebar');
  await harness.show(sidebarInit(card));

  return harness;
}

test.describe('the canvas in preview', () => {
  test('says whose proposal it is showing, above the graph', async ({
    page,
  }) => {
    await openCanvas(page);

    await expect(page.locator('[data-preview-headline]')).toHaveText(HEADLINE);
  });

  test('says what it would change, and that nobody placed it', async ({
    page,
  }) => {
    await openCanvas(page);

    await expect(page.locator('[data-preview-banner]')).toHaveText(BANNER);
  });

  test('draws the proposed blocks as proposed, and no others', async ({
    page,
  }) => {
    await openCanvas(page);

    for (const id of PROPOSED) {
      await expect(nodeBody(page, id)).toHaveAttribute(
        'data-state',
        'proposed',
      );
    }

    await expect(nodeBody(page, 'find_slot')).toHaveAttribute(
      'data-state',
      'dormant',
    );

    // Dashed and see-through: the plotting grid
    // shows faintly through a block that is not
    // there yet.
    const style = await nodeBody(page, 'twilio_chat').evaluate((block) => {
      const found = getComputedStyle(block);

      return {
        border: found.borderTopStyle,
        background: found.backgroundColor,
      };
    });

    expect(style.border).toBe('dashed');
    // However the browser chose to write the
    // colour, the alpha is the part that matters.
    expect(style.background).toContain('0.72');
  });

  test('names the first few blocks and counts the rest', async ({ page }) => {
    await openCanvas(page, {
      preview: preview({
        named: ['One', 'Two', 'Three', 'Four', 'Five'],
        more: '… 11 more proposed nodes',
      }),
    });

    await expect(page.locator('[data-preview-node]')).toHaveCount(5);
    await expect(page.locator('[data-preview-more]')).toHaveText(
      '… 11 more proposed nodes',
    );
  });

  test('warns instead of counting when the graph moved on', async ({
    page,
  }) => {
    await openCanvas(page, {
      preview: preview({ banner: undefined, warning: WARNING }),
    });

    await expect(page.locator('[data-preview-warning]')).toHaveText(WARNING);
    await expect(page.locator('[data-preview-banner]')).toHaveCount(0);
  });

  /**
   * The graph on screen is the proposal's, not the
   * document's. An edit made on it would be
   * proposed content written to a file nobody
   * approved it for, at a revision it was never
   * based on.
   */
  test('takes no edits while it is showing somebody else’s draft', async ({
    page,
  }) => {
    const harness = await openCanvas(page);

    // Forced, because the graph is inert enough
    // that the pointer does not reach a block at
    // all — which is the point, but a click that
    // never lands would prove nothing about the
    // handler behind it.
    await page
      .locator('.react-flow__node[data-id="find_slot"]')
      .click({ force: true });
    await page.locator('[data-view-toggle="json"]').click();

    await expect(page.locator('[data-json-editor]')).toHaveAttribute(
      'readonly',
      '',
    );
    expect(await harness.posted()).toEqual([{ type: 'ready' }]);
  });

  test('goes back to the document when the proposal goes', async ({ page }) => {
    const harness = await openCanvas(page);
    await harness.show(canvasInit({ preview: undefined }));

    await expect(page.locator('[data-preview-banner]')).toHaveCount(0);
    await expect(nodeBody(page, 'twilio_chat')).toHaveAttribute(
      'data-state',
      'dormant',
    );
  });
});

/** The block itself, inside the wrapper the graph
 *  library positions. */
function nodeBody(page: Page, node: string): Locator {
  return page.locator(`.react-flow__node[data-id="${node}"] .node`);
}

test.describe('the panel, with a proposal outstanding', () => {
  test('offers to apply it, and to ask for something else', async ({
    page,
  }) => {
    await openPanel(page, outstanding);

    await expect(page.locator('[data-approve]')).toHaveText('Approve & apply');
    await expect(page.locator('[data-refine]')).toHaveText('Refine');

    // Approving is the primary action; refining is
    // the way back to the conversation.
    await expect(page.locator('[data-approve]')).toHaveClass(/primary/);
    await expect(page.locator('[data-refine]')).not.toHaveClass(/primary/);
  });

  test('says what it would change, and to which workflow', async ({ page }) => {
    await openPanel(page, outstanding);

    await expect(page.locator('[data-preview-card]')).toContainText(BANNER);
    await expect(page.locator('[data-preview-card]')).toContainText(
      'groom_booking',
    );
  });

  test('tells the extension which proposal was approved', async ({ page }) => {
    const harness = await openPanel(page, outstanding);

    await page.locator('[data-approve]').click();

    expect(await harness.postedOfType('approve')).toEqual([
      { type: 'approve', proposalId: outstanding.id },
    ]);
  });

  /**
   * Refine is a person going back to the chat box.
   * Nothing is written, nothing is told to the
   * extension, and the proposal stays outstanding
   * until the agent replaces it — so the only thing
   * that should have happened is the cursor moving.
   */
  test('puts the cursor back in the composer, and says nothing', async ({
    page,
  }) => {
    const harness = await openPanel(page, outstanding);

    await page.locator('[data-refine]').click();

    await expect(page.locator('.composer textarea')).toBeFocused();
    expect(await harness.posted()).toEqual([{ type: 'ready' }]);
    await expect(page.locator('[data-preview-card]')).toBeVisible();
  });
});

test.describe('the panel, with a proposal the graph moved past', () => {
  test('offers only the way back to the agent', async ({ page }) => {
    await openPanel(page, {
      at: 'stale',
      id: outstanding.id,
      workflow: 'groom_booking',
      headline: HEADLINE,
      warning: WARNING,
    });

    await expect(page.locator('[data-preview-card]')).toContainText(WARNING);
    await expect(page.locator('[data-refine]')).toBeVisible();
    await expect(page.locator('[data-approve]')).toHaveCount(0);
  });
});

test.describe('the panel, after an approval', () => {
  test('offers to take it back', async ({ page }) => {
    const harness = await openPanel(page, {
      at: 'applied',
      workflow: 'groom_booking',
      summary: BANNER,
      undoable: true,
    });

    await expect(page.locator('[data-undo]')).toHaveText('Undo');

    await page.locator('[data-undo]').click();

    expect(await harness.postedOfType('undo')).toEqual([{ type: 'undo' }]);
  });

  test('stops offering it once there is nothing left to take back', async ({
    page,
  }) => {
    await openPanel(page, {
      at: 'applied',
      workflow: 'groom_booking',
      summary: BANNER,
      undoable: false,
    });

    await expect(page.locator('[data-undo]')).toBeDisabled();
  });
});

test.describe('the panel, with nothing proposed', () => {
  test('shows no card at all', async ({ page }) => {
    await openPanel(page, undefined);

    await expect(page.locator('[data-preview-card]')).toHaveCount(0);
  });
});
