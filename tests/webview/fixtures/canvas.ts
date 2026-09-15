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
  type WorkflowIR,
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
  BlockSubject,
  CanvasInit,
  InspectorInit,
  InspectorMode,
  InspectorSubject,
  RunInputView,
  ShownRun,
} from '../../../src/webview/protocol.js';

import { mount, type ThemeKind } from '../harness.js';
import { canvasWords, inspectorWords, paletteLabels } from '../words.js';

/**
 * The canvas, and the Inspector about a block on
 * it, as the host would send them.
 *
 * More than one spec drives these views — the
 * canvas's own, the Inspector's, and the
 * shared-component one, which needs a real surface
 * to read a component off — and Playwright refuses a
 * spec that imports another, so the messages they
 * send, and the documents and runs those messages
 * carry, live here. Two copies would drift, and a
 * block drawn in the Inspector off a document the
 * canvas never draws proves nothing about either.
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
    selected: undefined,
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

/** The Inspector's whole message about a subject. */
export function inspectorInit(subject: InspectorSubject): InspectorInit {
  return {
    type: 'init',
    view: 'inspector',
    strings: inspectorWords,
    subject,
  };
}

/** The Inspector about one block. */
export function blockInit(block: BlockSubject): InspectorInit {
  return inspectorInit({ at: 'block', block });
}

/**
 * A block selected on a canvas, as the Inspector is
 * sent it — and, where a test needs the block to
 * read differently, with the document changed on the
 * way in. The pane reads everything about a block
 * off the document, so that is the only place a
 * variant can come from.
 *
 * Everything else is what a canvas on that document
 * holds with no run in focus: editable at the
 * document's revision, with the scanned manifest and
 * what core makes of the document.
 */
export function blockSubject(
  nodeId: string,
  over: Partial<WorkflowNode> = {},
  face: InspectorMode = 'configure',
  document: WorkflowIR = ir,
): BlockSubject {
  const nodes = document.nodes.map((one) =>
    one.id === nodeId ? ({ ...one, ...over } as WorkflowNode) : one,
  );
  const node = nodes.find((one) => one.id === nodeId);

  return {
    source: 'canvas',
    file: `${document.name}.workflow.json`,
    path: `/work/project/.mboss/workflows/${document.name}.workflow.json`,
    workflow: document.name,
    ir: { ...document, nodes },
    revision: document.revision,
    nodeId,
    face,
    manifest,
    diagnostics: validateWorkflow(document, { manifest }),
    paletteLabels,
    kindWords: canvasWords.kinds,
    run: undefined,
    functionId: undefined,
    decided: {},
    // The host carries the Runs view's side on a
    // trigger and on nothing else: here, an empty
    // box, set to this workflow, saved as it reads.
    runInput:
      node?.kind === 'trigger'
        ? {
            text: '',
            selectedWorkflow: document.name,
            saved: { name: document.name, mode: node.config.mode },
            needsTopic: false,
            unsaved: false,
            trusted: true,
            problem: undefined,
          }
        : undefined,
    proposal: undefined,
  };
}

/** How a trigger starts. */
export type TriggerConfig = Extract<
  WorkflowNode,
  { kind: 'trigger' }
>['config'];

/**
 * The canonical document's trigger, set to start
 * the way a test needs, beside what the Runs view
 * holds for it.
 */
export function triggerSubject(
  config: TriggerConfig,
  runInput: Partial<RunInputView> = {},
  over: Partial<BlockSubject> = {},
): BlockSubject {
  const block = blockSubject('booking_requested', { config });

  return {
    ...block,
    runInput: { ...block.runInput!, ...runInput },
    ...over,
  };
}

/** Puts the Inspector on a page as wide as a docked
 *  pane, with nothing on it yet. */
export async function mountInspector(page: Page, theme: ThemeKind = 'light') {
  return mount(page, 'inspector', theme, { width: 300 });
}

/** The Inspector, on a page, showing that. */
export async function openInspector(
  page: Page,
  init: InspectorInit,
  theme: ThemeKind = 'light',
) {
  const harness = await mountInspector(page, theme);
  await harness.show(init);

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

const everyKindBoxes: CanvasInit['boxes'] = Object.fromEntries(
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

/** What core says about a partitioned queue with no
 *  partition path, in the words the host would
 *  send. */
export const NO_PARTITION_KEY: Finding = {
  code: 'V17',
  severity: 'error',
  nodeId: 'queue',
  message:
    '`queue` limits its queue per partition, but does not say which ' +
    'partition an item belongs to. Set the partition path.',
};

/** The other of core's two words about the same
 *  queue: deduplication on a partitioned one, which
 *  a form says on the block rather than on save. */
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
 * The every-kind document's queue block, configured,
 * in the Inspector, with whatever core said about
 * the document.
 *
 * The canonical fixture is a real workflow and holds
 * no queue, so the one form the Inspector groups
 * under headers is reachable only from the document
 * that holds one of every kind.
 */
export function queueSubject(
  config: object,
  diagnostics: Finding[] = [],
  face: InspectorMode = 'configure',
): BlockSubject {
  const queue = { handler: { export: 'indexPage' }, config };

  return {
    ...blockSubject('queue', queue as Partial<WorkflowNode>, face, everyKind),
    diagnostics,
  };
}

/**
 * The every-kind document's API call, set up the way
 * a real one is: a function behind it, a service to
 * call and a policy that tries five times — which is
 * the one form holding every group a block's recipe
 * can have.
 *
 * The canonical fixture calls no API, so this is
 * reached the way the queue is.
 */
export function apiCallSubject(
  over: Partial<WorkflowNode> = {},
  face: InspectorMode = 'configure',
): BlockSubject {
  const called = {
    handler: { export: 'chargeCard' },
    config: { service: 'Airtable' },
    retry: { maxAttempts: 5, intervalSeconds: 1, backoffRate: 2 },
    ...over,
  };

  return {
    ...blockSubject(
      'api_call',
      called as Partial<WorkflowNode>,
      face,
      everyKind,
    ),
    diagnostics: [],
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
 *  in pixels: the first track of the first property
 *  row on the page. */
export async function labelTrack(page: Page): Promise<number> {
  const tracks = await page
    .locator('[data-property]')
    .first()
    .evaluate((row) => getComputedStyle(row).gridTemplateColumns);

  return Number.parseFloat(tracks);
}

/**
 * The canvas with that block selected — and, where
 * a test needs the block to read differently, with
 * the document changed on the way in: the same
 * block `blockSubject` puts in the Inspector.
 */
export function showing(
  nodeId: string,
  over: Partial<WorkflowNode> = {},
): Pick<CanvasInit, 'document' | 'selected'> {
  const { ir: shown } = blockSubject(nodeId, over);

  return { document: { ok: true, ir: shown }, selected: nodeId };
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

      // Nothing names this one: DBOS clears a dedup
      // key when an item finishes.
      {
        workflowId: 'wf_child_2',
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
  shown: undefined,
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
 *  which is the one case that says so out loud. DBOS
 *  stores each try's error inside the one it throws
 *  once they run out, and the last of them is the
 *  one drawn. */
export const EXHAUSTED = liveStep({
  ...THREW,
  error: {
    ...THREW.error!,
    errors: [1, 2, 3].map(() => ({
      name: 'StripeTimeoutError',
      message: 'Request timed out after 30 s',
    })),
    retriesExhausted: true,
  },
});
