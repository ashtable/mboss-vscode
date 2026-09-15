import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { snap } from '../../../src/canvas/grid.js';
import { layoutKeyOf } from '../../../src/canvas/placement.js';
import {
  NODE_PALETTE,
  WorkflowIRSchema,
  nodeSize,
  starterNode,
  validateWorkflow,
  type LibManifest,
  type NodeKind,
  type WorkflowNode,
} from '../../../src/core/rules.js';
import type { QueueEvidence } from '../../../src/runs/queueEvidence.js';
import type { StepState } from '../../../src/runs/reading.js';
import type {
  LiveOutcome,
  LiveRun,
  LiveStep,
  QueueCounts,
} from '../../../src/runs/watch.js';
import { liveStep } from '../../../src/test-support/runs.js';
import type {
  CanvasInit,
  InspectorMode,
  ShownRun,
} from '../../../src/webview/protocol.js';

import { mount, type ThemeKind } from '../harness.js';
import { canvasWords, inspectorWords, paletteLabels } from '../words.js';

/**
 * The canvas, as the host would send it.
 *
 * More than one spec drives this view — the canvas's
 * own, and the shared-component one, which needs a
 * real surface to read a component off — and
 * Playwright refuses a spec that imports another, so
 * the message they both send lives here. Two copies
 * of it would drift, and a component spec reading a
 * canvas nobody else draws proves nothing about the
 * canvas.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../mboss-core/fixtures/${name}`, import.meta.url),
      ),
      'utf8',
    ),
  );
}

export const ir = WorkflowIRSchema.parse(
  fixture('ir/groom_booking.workflow.json'),
);

/**
 * The fixture's own layout, on the grid.
 *
 * The engine spaces a graph on numbers of its own,
 * none of them the canvas's, and the host rounds
 * what it computed onto this grid before sending it.
 * A graph arriving any other way is one this canvas
 * never sees — and a block half a square off the
 * grid moves diagonally the first time somebody
 * nudges it.
 */
export const boxes: CanvasInit['boxes'] = Object.fromEntries(
  Object.entries(
    fixture('golden/layout/groom_booking.layout.json') as CanvasInit['boxes'],
  ).map(([id, box]) => [id, { ...box, x: snap(box.x), y: snap(box.y) }]),
);

export const manifest = fixture(
  'golden/manifest/lib.manifest.json',
) as LibManifest;

export function canvasInit(over: Partial<CanvasInit> = {}): CanvasInit {
  const shown = { document: { ok: true, ir } as CanvasInit['document'], boxes };
  const drawn = { ...shown, ...over };

  return {
    type: 'init',
    view: 'canvas',
    strings: canvasWords,
    paletteLabels,
    kindWords: canvasWords.kinds,
    triggerPhrases: canvasWords.triggerPhrases,
    ...shown,

    // Worked out the way the host works it out, so a
    // spec that shows a different graph gets a
    // different key without having to say so.
    layoutKey: drawn.document.ok
      ? layoutKeyOf(drawn.document.ir, drawn.boxes)
      : '',
    // Editable exactly when the document parsed and
    // nothing is proposed, the way the host says it.
    editing:
      drawn.document.ok && over.preview === undefined
        ? { revision: drawn.document.ir.revision }
        : undefined,
    diagnostics: validateWorkflow(ir, { manifest }),
    manifest,
    inspector: {
      strings: inspectorWords,
      selected: undefined,
      mode: 'configure',
    },
    preview: undefined,
    run: undefined,
    decided: {},
    ...over,
  };
}

/** The graph, on a page, showing the canonical
 *  fixture. */
export async function openCanvas(page: Page, theme: ThemeKind = 'light') {
  const harness = await mount(page, 'canvas', theme);
  await harness.show(canvasInit());

  return harness;
}

/**
 * A block of every kind, in a column.
 *
 * The canonical fixture is a real workflow and so
 * uses six kinds. Seeing that each kind draws its
 * own glyph takes a document that holds them all,
 * which no workflow anybody would write does.
 */
export const everyKind = WorkflowIRSchema.parse({
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 1,
  name: 'every_kind',
  nodes: NODE_PALETTE.map((entry) =>
    starterNode(entry.kind, slugOf(entry.kind), entry.label),
  ),
  edges: [],
});

export const everyKindBoxes: CanvasInit['boxes'] = Object.fromEntries(
  everyKind.nodes.map((node, index) => {
    const { width, height } = nodeSize(node.kind);

    return [node.id, { x: 0, y: index * 90, w: width, h: height }];
  }),
);

/** A kind's id, written the way node ids are: a
 *  lower-case slug, so `apiCall` is `api_call`. */
export function slugOf(kind: NodeKind): string {
  return kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The column of every kind, on a page. */
export async function openEveryKind(
  page: Page,
  over: Partial<CanvasInit> = {},
) {
  const harness = await mount(page, 'canvas');
  await harness.show(
    canvasInit({
      document: { ok: true, ir: everyKind },
      boxes: everyKindBoxes,
      diagnostics: [],
      ...over,
    }),
  );

  return harness;
}

/** A queue holding one item back per partition, and
 *  deduplicating on it — which DBOS refuses. */
export const PARTITIONED = {
  itemsPath: 'pages',
  queue: { name: 'document-index', partitionConcurrency: 2 },
  enqueue: { deduplicationPath: 'documentId' },
};

/** The same block, unpartitioned and untroubled. */
export const INDEXING = {
  itemsPath: 'pages',
  queue: { name: 'document-index', globalConcurrency: 8 },
  enqueue: { deduplicationPath: 'documentId' },
};

type Finding = CanvasInit['diagnostics'][number];

/** Both of what core says about `PARTITIONED`, in
 *  the words the host would send. */
export const NO_PARTITION_KEY: Finding = {
  code: 'V17',
  severity: 'error',
  nodeId: 'queue',
  message:
    '`queue` limits its queue per partition, but does not say which ' +
    'partition an item belongs to. Set the partition path.',
};

export const DEDUPLICATES: Finding = {
  code: 'V17',
  severity: 'error',
  nodeId: 'queue',
  message:
    '`queue` deduplicates items on a partitioned queue, which DBOS does ' +
    'not support. Drop the deduplication path or the partition limits.',
};

/** The marker a folding header wears. Drawn rather
 *  than read — it is `aria-hidden` — but it is in
 *  the header's text all the same. */
export const MARK = '▾';

/**
 * The every-kind document with its queue block
 * configured, that block in the column, and
 * whatever core said about the document.
 *
 * The canonical fixture is a real workflow and holds
 * no queue, so the one form the column groups under
 * headers is reachable only from the document that
 * holds one of every kind.
 */
export function showingQueue(
  config: object,
  diagnostics: Finding[] = [],
): Partial<CanvasInit> {
  const nodes = everyKind.nodes.map((node) =>
    node.id === 'queue'
      ? ({ ...node, handler: { export: 'indexPage' }, config } as WorkflowNode)
      : node,
  );

  return {
    document: { ok: true, ir: { ...everyKind, nodes } },
    inspector: {
      strings: inspectorWords,
      selected: 'queue',
      mode: 'configure',
    },
    diagnostics,
  };
}

/**
 * A word the host resolved for a field or a group.
 *
 * The bags are keyed by id, so a missing one reads
 * as `undefined` and would quietly become the string
 * `"undefined"` in an expectation. Asked for here
 * instead, where a missing word is the failure.
 */
export function word(bag: Record<string, string>, id: string): string {
  const said = bag[id];
  if (said === undefined) throw new Error(`no word for ${id}`);

  return said;
}

/** How wide the column of field labels resolved to,
 *  in pixels. */
export async function labelTrack(page: Page): Promise<number> {
  const tracks = await page
    .locator('.field[data-control="text"]')
    .first()
    .evaluate((field) => getComputedStyle(field).gridTemplateColumns);

  return Number.parseFloat(tracks);
}

/**
 * The canvas with that block selected — and, where
 * a test needs the block to read differently, with
 * the document changed on the way in. The column
 * reads everything about a block off the document,
 * so that is the only place a variant can come
 * from.
 */
export function showing(
  nodeId: string,
  over: Partial<WorkflowNode> = {},
  mode: InspectorMode = 'configure',
): Partial<CanvasInit> {
  const nodes = ir.nodes.map((one) =>
    one.id === nodeId ? ({ ...one, ...over } as WorkflowNode) : one,
  );

  return {
    document: { ok: true, ir: { ...ir, nodes } },
    inspector: { strings: inspectorWords, selected: nodeId, mode },
  };
}

/**
 * A run of the fixture's workflow, as the watcher
 * reports one.
 *
 * The steps are in the order the ledger holds them,
 * which is the order they ran in — the last of them
 * is the one the block the run is at is worked out
 * from.
 */
export function runOf(
  steps: readonly (readonly [string, StepState])[],
  outcome: LiveOutcome = 'running',
): LiveRun {
  return {
    workflowId: 'wf_1',
    workflow: ir.name,
    status: outcome === 'running' ? 'PENDING' : 'SUCCESS',
    executorId: 'local-dev',
    steps: steps.map(([nodeId, state], index) =>
      liveStep({ name: nodeId, nodeId, state, functionId: index }),
    ),
    recovered: false,
    recoveryAttempts: 1,
    outcome,
    applicationVersion: 'v0.1.0',
    createdAt: 1000,
    startedAt: 1000,
    completedAt: undefined,
    input: undefined,
    recordedInput: undefined,
    forkedFrom: undefined,
  };
}

/**
 * A run of the column of every kind, with the queue
 * block's children part-way through it.
 *
 * No rows at all: the queue block records nothing
 * about the work its children do, so what its
 * children are doing is the only thing this run
 * says about anything.
 */
export function queuedRun(
  counts: Partial<QueueCounts>,
  evidence?: QueueEvidence,
): ShownRun {
  return {
    ...runOf([]),
    workflow: everyKind.name,
    queues: {
      queue: {
        queued: 0,
        delayed: 0,
        active: 0,
        done: 0,
        failed: 0,
        ...counts,
      },
    },
    ...(evidence === undefined ? {} : { queueEvidence: { queue: evidence } }),
  };
}

/**
 * What one read of the whole queue answered with.
 *
 * Per selection rather than per tick, so a run that
 * nobody has opened a queue card on carries none of
 * it — which is what the card's own case about
 * saying nothing yet is drawn from.
 */
export function queueEvidence(
  over: Partial<QueueEvidence> = {},
): QueueEvidence {
  return {
    window: {
      queued: 4,
      active: 2,
      started: 74,
      failedRecently: 2,
      windowSec: 60,
    },
    registered: 'matches',
    recent: [
      { workflowId: 'wf_child_1', label: 'doc_7', status: 'PENDING' },
      {
        workflowId: 'wf_child_2',
        label: '…b2c3d4e5',
        status: 'SUCCESS',
        completedAt: RECORDED_AT,
      },
    ],
    ...over,
  };
}

/** A run still going: two blocks behind it, and a
 *  branch ahead that records nothing, so both of
 *  the blocks past it are where the run might be. */
export const IN_FLIGHT = [
  ['parse_request', 'done'],
  ['find_slot', 'done'],
] as const;

/** The same run with its rows spelled out, for the
 *  column that draws one row in full rather than a
 *  graph of all of them. */
export function recording(
  steps: LiveStep[],
  over: Partial<LiveRun> = {},
): LiveRun {
  return { ...runOf([]), steps, ...over };
}

/**
 * A moment, in the zone the page runs in. The card
 * formats it in the browser's own clock, and this
 * tier pins that clock to UTC so the same fixture
 * is the same time on every machine.
 */
export const RECORDED_AT = Date.UTC(2026, 8, 7, 10, 31, 14, 218);

/** One step that worked, timed to the millisecond
 *  and carrying what it returned. */
export const DONE = liveStep({
  name: 'find_slot',
  nodeId: 'find_slot',
  functionId: 3,
  startedAt: RECORDED_AT,
  completedAt: RECORDED_AT + 48,
  output: '{"id":"ord_123","amount":1249}',
});

/** The same step, having thrown somewhere nobody
 *  in this project wrote — which is most of them. */
export const THREW = liveStep({
  ...DONE,
  state: 'failed',
  output: undefined,
  error: {
    name: 'StripeTimeoutError',
    message: 'Request timed out after 30 s',
    stack: [
      'StripeTimeoutError: Request timed out after 30 s',
      '    at post (/app/node_modules/stripe/lib/http.js:212:19)',
    ].join('\n'),
    retriesExhausted: false,
    frame: undefined,
  },
});

/** And having thrown on a line of the project's own
 *  code, which is the one case with a line to go
 *  to. */
export const THREW_IN_LIB = liveStep({
  ...THREW,
  error: {
    ...THREW.error!,
    stack: [
      'StripeTimeoutError: Request timed out after 30 s',
      '    at refundPayment (/app/lib/refund-payment.ts:18:11)',
    ].join('\n'),
    frame: { file: 'lib/refund-payment.ts', line: 18, column: 11 },
  },
});

/** And having thrown on every try DBOS allowed it,
 *  which is the one case that says so out loud. */
export const EXHAUSTED = liveStep({
  ...THREW,
  error: { ...THREW.error!, retriesExhausted: true },
});
