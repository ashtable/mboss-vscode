import { expect, type Page } from '@playwright/test';

import type { QueueEvidence } from '../../../src/runs/queueEvidence.js';
import { liveRun, liveStep } from '../../../src/test-support/runs.js';
import type {
  SeeGraph,
  SeeInit,
  SeeLineageRun,
  SeeRun,
  TraceGroupView,
} from '../../../src/webview/protocol.js';

import { mount, type Harness, type ThemeKind } from '../harness.js';
import { canvasWords, inspectorWords, seeWords } from '../words.js';

/**
 * One run, as the host would send it to the run tab.
 *
 * More than one spec draws these runs — the run
 * tab's own, and the Inspector's, whose card about a
 * whole run says what the tab once said beside its
 * graph — and Playwright refuses a spec that imports
 * another, so the messages, the documents drawn
 * beside them and the traces live here. Two copies
 * would drift, and a card about a run the tab never
 * draws proves nothing about either.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */

export const STEP_NAMES = ['parse_request', 'find_slot', 'book_appointment'];

/** What the host says over a run whose workflow the
 *  project no longer has. */
export const NO_SAVED_WORKFLOW =
  'no saved workflow named groom_booking · trace only';

export function seeRun(over: Partial<SeeRun> = {}): SeeRun {
  return {
    workflowId: 'wf_c9d2f3',
    name: 'groom_booking',
    breadcrumb: 'mBoss › runs › groom_booking › wf_c9d2f3',
    headline: 'SUCCESS · 8.2 s total',
    word: 'done',
    span: 'started 14:02:11 · finished 14:02:19',
    recovered: {
      heading: 'Recovered — completed durable operations were not re-executed',
      body:
        'DBOS picked this run back up. Both figures are derived from the ' +
        'widest gap between recorded operations — the durable operations ' +
        'that finished before that gap were reused from ' +
        'dbos.operation_outputs rather than run again.',
      figures: {
        down: 'nothing ran for about 2.9 s',
        reused: '2 durable operations reused',
      },
    },
    chips: STEP_NAMES.map((name, index) => ({
      functionId: index,
      name,
      restored: index < 2,
      reused: false,
      failed: false,
      replayable: true,
      because: undefined,
    })),
    timeline: {
      bars: STEP_NAMES.map((name, index) => ({
        functionId: index,
        name,
        at: { from: index * 0.1, width: 0.08 },
        restored: index < 2,
        reused: false,
        failed: false,
      })),
      outage: {
        from: 0.2,
        width: 0.35,
        down: 'process down · 2.9 s',
        resumed: 'resumed by DBOS',
      },
      ticks: [
        { at: 0, label: '14:02:11' },
        { at: 0.2, label: '14:02:15' },
        { at: 0.55, label: '14:02:18' },
        { at: 1, label: '14:02:19' },
      ],
    },
    raw: STEP_NAMES.map((name, index) => ({
      stepId: index,
      fn: name,
      output: `{"n":${index}}`,
      committedAt: `14:02:1${index}`,
    })),
    rail: [
      { label: 'workflow_uuid', value: 'wf_c9d2f3' },
      { label: 'status', value: 'SUCCESS' },
      { label: 'recovery_attempts', value: '2' },
      { label: 'executor_id', value: 'local-dev' },
    ],
    controls: {
      cancel: false,
      resume: false,
      cancelled: undefined,
      lastRecorded: 'book_appointment · step 2',
    },
    selectedStep: 2,
    note: undefined,
    graph: undefined,
    // Set to match, the way the host sets it: the
    // sentence is there exactly where the picture
    // is not.
    noGraph: over.graph === undefined ? NO_SAVED_WORKFLOW : undefined,
    live: liveRun({
      workflowId: 'wf_c9d2f3',
      workflow: 'groom_booking',
      status: 'ERROR',
      outcome: 'failed',
      steps: [
        liveStep({ name: 'parse_request', nodeId: 'parse_request' }),
        liveStep({
          name: 'find_slot',
          nodeId: 'find_slot',
          state: 'failed',
          functionId: 1,
        }),
      ],
    }),
    groups: [],
    selected: { nodeId: undefined, functionId: 2 },
    showRaw: false,
    following: 'quiet',
    input: undefined,
    lineage: undefined,
    ...over,
  };
}

/** The trace by default: most of what this page
 *  draws is on that side, and the graph cases say
 *  so for themselves. */
export function seeInit(
  run: SeeRun = seeRun(),
  showing: 'graph' | 'trace' = 'trace',
): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeWords,
    inspector: inspectorWords,
    run,
    showing,
  };
}

/** Before a run has been picked. A separate helper
 *  rather than `seeInit(undefined)`, which a
 *  default argument would quietly turn back into a
 *  run. */
export function seeNothing(): SeeInit {
  return {
    type: 'init',
    view: 'see',
    strings: seeWords,
    inspector: inspectorWords,
    run: undefined,
    showing: 'graph',
  };
}

export async function showRun(
  page: Page,
  init: SeeInit,
  theme: ThemeKind = 'light',
): Promise<Harness> {
  const harness = await mount(page, 'see', theme);
  await harness.show(init);

  return harness;
}

/** The warn colour, as the light theme resolves it.
 *  Recovery is drawn in it wherever it is drawn. */
export const WARN = 'rgb(233, 162, 59)';

/** The tint of it a whole surface is washed in. */
export const WARN_TINT = 'color(srgb 0.966078 0.935451 0.89102)';

/** The blocks the graph fixture draws, laid out
 *  the way core would lay them out. */
export const GRAPH: SeeGraph = {
  ir: {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      // Every saved workflow has one, and it is the
      // block the page draws first.
      {
        id: 'booking_requested',
        kind: 'trigger',
        title: 'Booking requested',
        config: { mode: 'manual' },
      },
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      {
        id: 'find_slot',
        kind: 'step',
        title: 'Find a slot',
        config: {},
        // The one node with code behind it: the
        // card's way into it is offered where there
        // is something to open and nowhere else.
        handler: { export: 'findSlot' },
      },
    ],
    edges: [
      {
        id: 'e0',
        from: { node: 'booking_requested', port: 'out' },
        to: { node: 'parse_request' },
      },
      {
        id: 'e1',
        from: { node: 'parse_request', port: 'out' },
        to: { node: 'find_slot' },
      },
    ],
  } as unknown as SeeGraph['ir'],
  boxes: {
    booking_requested: { x: 0, y: -160, w: 230, h: 64 },
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 160, w: 230, h: 64 },
  },
  kindWords: canvasWords.kinds,
  triggerPhrases: canvasWords.triggerPhrases,
  unassigned: 'unassigned',
  queueCounts: '{0} running · {1} queued',
  caption: 'workflow as saved · revision 4',
  decided: {},
};

/**
 * The same run, still going, on a workflow that
 * branches.
 *
 * Five things are true of it at once and each is
 * drawn differently: the trigger fired, one block
 * finished, one threw, one is parked on a person,
 * and one is where the run is *now* — which the
 * ledger does not record and the page therefore
 * works out.
 */
export const RUNNING_GRAPH: SeeGraph = {
  ir: {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'groom_booking',
    nodes: [
      {
        id: 'booking_requested',
        kind: 'trigger',
        title: 'Booking requested',
        config: { mode: 'event', topic: 'booking.requested' },
      },
      { id: 'parse_request', kind: 'step', title: 'Parse', config: {} },
      { id: 'find_slot', kind: 'step', title: 'Find a slot', config: {} },
      {
        id: 'await_reply',
        kind: 'durableWait',
        title: 'Ask',
        config: {
          source: { kind: 'form', email: 'parse_request' },
          onTimeout: 'abort',
        },
      },
      {
        id: 'how_big',
        kind: 'branch',
        title: 'How big',
        config: {
          cases: [
            { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
          ],
          elsePort: 'small',
        },
      },
      { id: 'charge_it', kind: 'step', title: 'Charge it', config: {} },
      { id: 'refund_it', kind: 'step', title: 'Refund it', config: {} },
    ],
    edges: [
      {
        id: 'e0',
        from: { node: 'booking_requested', port: 'out' },
        to: { node: 'parse_request' },
      },
      {
        id: 'e1',
        from: { node: 'parse_request', port: 'out' },
        to: { node: 'find_slot' },
      },
      {
        id: 'e2',
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'await_reply' },
      },
      {
        id: 'e3',
        from: { node: 'await_reply', port: 'out' },
        to: { node: 'how_big' },
      },
      {
        id: 'e4',
        from: { node: 'how_big', port: 'large' },
        to: { node: 'charge_it' },
      },
      {
        id: 'e5',
        from: { node: 'how_big', port: 'small' },
        to: { node: 'refund_it' },
      },
    ],
  } as unknown as SeeGraph['ir'],
  boxes: {
    booking_requested: { x: 0, y: -160, w: 230, h: 64 },
    parse_request: { x: 0, y: 0, w: 230, h: 64 },
    find_slot: { x: 0, y: 160, w: 230, h: 64 },
    await_reply: { x: 0, y: 320, w: 230, h: 64 },
    how_big: { x: 0, y: 480, w: 230, h: 64 },
    charge_it: { x: -160, y: 640, w: 230, h: 64 },
    refund_it: { x: 160, y: 640, w: 230, h: 64 },
  },
  kindWords: canvasWords.kinds,
  triggerPhrases: canvasWords.triggerPhrases,
  unassigned: 'unassigned',
  queueCounts: '{0} running · {1} queued',
  caption: 'workflow as saved · revision 4',
  // The arm the run is recorded as having taken.
  // The other one is somewhere it demonstrably did
  // not go.
  decided: { how_big: 'large' },
};

/** What the ledger holds for that run: the last row
 *  is the block it parked on, which is where the
 *  walk to the frontier starts. */
export const RUNNING = liveRun({
  workflowId: 'wf_c9d2f3',
  workflow: 'groom_booking',
  status: 'PENDING',
  outcome: 'running',
  steps: [
    liveStep({ name: 'parse_request', nodeId: 'parse_request' }),
    liveStep({
      name: 'find_slot',
      nodeId: 'find_slot',
      state: 'failed',
      functionId: 1,
    }),
    liveStep({
      name: 'await_reply.register',
      nodeId: 'await_reply',
      state: 'waiting',
      functionId: 2,
    }),
  ],
});

/**
 * A workflow that hands its work to a queue, so the
 * run page has children to count.
 *
 * Two blocks: what started the run, and the block
 * whose children do the work.
 */
export const QUEUED_GRAPH: SeeGraph = {
  ir: {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 4,
    name: 'document_ingestion',
    nodes: [
      {
        id: 'document_arrived',
        kind: 'trigger',
        title: 'Document arrived',
        config: { mode: 'manual' },
      },
      {
        id: 'index_pages',
        kind: 'queue',
        title: 'Index each page',
        handler: { export: 'indexPage' },
        config: {
          itemsPath: 'pages',
          itemType: 'Page',
          queue: { name: 'document-index' },
          enqueue: {},
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'document_arrived', port: 'out' },
        to: { node: 'index_pages' },
      },
    ],
  } as unknown as SeeGraph['ir'],
  boxes: {
    document_arrived: { x: 0, y: 0, w: 230, h: 64 },
    index_pages: { x: 0, y: 160, w: 230, h: 64 },
  },
  kindWords: canvasWords.kinds,
  triggerPhrases: canvasWords.triggerPhrases,
  unassigned: 'unassigned',
  queueCounts: '{0} running · {1} queued',
  caption: 'workflow as saved · revision 4',
  decided: {},
};

/**
 * That run part-way through: eight pages being
 * indexed, forty-two still to start, six done.
 *
 * No rows of its own. The parent's row for a queue
 * block is written as each child is handed over and
 * says nothing about what the child did, so the
 * counts are the whole of what this page knows.
 */
export const QUEUED = liveRun({
  workflowId: 'wf_c9d2f3',
  workflow: 'document_ingestion',
  status: 'PENDING',
  outcome: 'running',
  steps: [],
  queues: {
    index_pages: { queued: 42, delayed: 0, active: 8, done: 6, failed: 0 },
  },
});

/** What one read of the whole queue answered with,
 *  for the card the rail draws about that block. */
export const QUEUE_READ: QueueEvidence = {
  window: {
    queued: 42,
    active: 8,
    started: 74,
    failedRecently: 0,
    windowSec: 60,
  },
  registered: 'matches',
  recent: [
    { workflowId: 'wf_child_9f21', label: '…ld_9f21', status: 'PENDING' },
  ],
};

/**
 * One turn of that block, as the trace draws it:
 * the row the parent wrote as it handed a page
 * over, carrying the id of the run that took it.
 */
export const QUEUED_GROUPS: TraceGroupView[] = [
  {
    nodeId: 'index_pages',
    title: 'Index each page',
    qualifier: undefined,
    wakes: undefined,
    open: true,
    failed: false,
    operations: [
      {
        functionId: 0,
        name: 'index_pages.queued.document_ingestion',
        owner: 'node',
        state: 'done',
        at: '14:02:11.100',
        output: '{}',
        outputCut: false,
        error: undefined,
        restored: false,
        reused: false,
        replayable: true,
        because: undefined,
        childWorkflowId: 'wf_child_9f21',
      },
    ],
  },
];

export const GROUPS: TraceGroupView[] = [
  {
    nodeId: 'parse_request',
    title: 'Parse',
    qualifier: undefined,
    wakes: undefined,
    open: false,
    failed: false,
    operations: [
      {
        functionId: 0,
        name: 'parse_request',
        owner: 'node',
        state: 'done',
        at: '14:02:11.100',
        output: '{}',
        outputCut: false,
        error: undefined,
        restored: false,
        reused: false,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
    ],
  },
  {
    nodeId: 'find_slot',
    title: 'Find a slot',
    qualifier: '· round 2',
    wakes: 'times out 14:04:11.000',
    open: true,
    failed: true,
    operations: [
      {
        functionId: 1,
        name: 'find_slot.r2',
        owner: 'node',
        state: 'failed',
        at: '14:02:14.900',
        output: undefined,
        outputCut: false,
        error: 'no slot left',
        restored: false,
        reused: false,
        replayable: true,
        because: undefined,
        childWorkflowId: undefined,
      },
      {
        functionId: 2,
        name: 'DBOS.sleep',
        owner: 'sdk',
        state: 'done',
        at: '14:02:15.000',
        output: '1739880139200',
        outputCut: false,
        error: undefined,
        restored: false,
        reused: false,
        replayable: false,
        because:
          'DBOS wrote this row for itself. A replay starts from a step ' +
          'the workflow recorded.',
        childWorkflowId: undefined,
      },
    ],
  },
  {
    nodeId: undefined,
    title: '',
    qualifier: undefined,
    wakes: undefined,
    open: false,
    failed: false,
    operations: [
      {
        functionId: 3,
        name: 'gone_away',
        owner: 'unmapped',
        state: 'done',
        at: '14:02:16.000',
        output: '{}',
        outputCut: false,
        error: undefined,
        restored: true,
        reused: false,
        replayable: false,
        because: 'The run is sitting here now.',
        childWorkflowId: undefined,
      },
    ],
  },
];

/** The graph's viewport transform, once nothing is
 *  moving. A spec against the built bundle has no
 *  `useReactFlow`, so the DOM string is the only
 *  way to read it. */
export async function graphAtRest(page: Page): Promise<void> {
  let last = await transformOf(page);

  await expect
    .poll(async () => {
      const now = await transformOf(page);
      const still = now !== '' && now === last;

      last = now;

      return still;
    })
    .toBe(true);
}

export function transformOf(page: Page): Promise<string> {
  return page
    .locator('.react-flow__viewport')
    .evaluate((viewport) => (viewport as HTMLElement).style.transform);
}

/**
 * The same trace, after a replay: the first row was
 * carried over from the run this one came out of,
 * and every later row is this run's own work.
 */
export const REPLAYED: TraceGroupView[] = GROUPS.map((group, at) => ({
  ...group,
  open: true,
  operations: group.operations.map((one, index) => ({
    ...one,
    reused: at === 0 && index === 0,
  })),
}));

/**
 * A run that came out of another, drawn from the top
 * of the tree: the run that failed, the fork point,
 * and the replay under it.
 */
export const LINEAGE: SeeLineageRun = {
  workflowId: 'wf_a1b4e7',
  status: 'ERROR',
  word: 'failed',
  startStep: undefined,
  from: undefined,
  here: false,
  forks: [
    {
      workflowId: 'wf_c9d2f3',
      status: 'SUCCESS',
      word: 'done',
      startStep: 3,
      from: 'replay from Refund payment',
      here: true,
      forks: [],
    },
  ],
};
