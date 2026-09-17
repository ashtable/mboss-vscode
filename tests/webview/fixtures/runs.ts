import { expect, type Page } from '@playwright/test';

import type { QueueEvidence } from '../../../src/runs/queueEvidence.js';
import { liveRun, liveStep } from '../../../src/test-support/runs.js';
import { shortRunId } from '../../../src/webview/ids.js';
import type {
  RunLevel,
  RunLineage,
  SeeGraph,
  SeeInit,
  SeeRun,
  TraceRowView,
} from '../../../src/webview/protocol.js';

import {
  mount,
  type Harness,
  type MountOptions,
  type ThemeKind,
} from '../harness.js';
import { canvasWords, seeWords } from '../words.js';

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

/** What the host says over a run whose workflow the
 *  project no longer has. */
export const NO_SAVED_WORKFLOW =
  'no saved workflow named groom_booking · trace only';

/** The canonical run, with whatever a case needs
 *  changed about it: a spec says the one fact it is
 *  about and nothing else. */
export function seeRun(over: Partial<SeeRun> = {}): SeeRun {
  return {
    workflowId: 'wf_c9d2f3',
    short: shortRunId('wf_c9d2f3'),
    name: 'groom_booking',
    state: 'done',
    line: 'groom_booking · done · 8.2 s',
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
    trace: [],
    unattributed: [],
    selected: { nodeId: undefined, functionId: 2 },
    following: 'quiet',
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
    run: undefined,
    showing: 'graph',
  };
}

/** The run tab on a page, already showing that: the
 *  mount and the first message are one step, since
 *  no case is about the moment between them. */
export async function showRun(
  page: Page,
  init: SeeInit,
  theme: ThemeKind = 'light',
  options: MountOptions = {},
): Promise<Harness> {
  const harness = await mount(page, 'see', theme, options);
  await harness.show(init);

  return harness;
}

/** The warn colour, as the light theme resolves it.
 *  Recovery is drawn in it wherever it is drawn. */
export const WARN = 'rgb(233, 162, 59)';

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
 *  for the Inspector's card about that block. */
export const QUEUE_READ: QueueEvidence = {
  window: {
    queued: 42,
    active: 8,
    started: 74,
    failedRecently: 0,
    windowSec: 60,
  },
  registered: 'matches',
  recent: [{ workflowId: 'wf_child_9f21', status: 'PENDING' }],
};

/** Why a row the SDK wrote is no place to start a
 *  replay, as the host says it on the row. */
export const SDK_OWNED =
  'DBOS wrote this row for itself. A replay starts from a step the ' +
  'workflow recorded.';

/** One recorded operation, with whatever a row
 *  needs changed about it. */
function traceRow(over: Partial<TraceRowView>): TraceRowView {
  return {
    functionId: 0,
    name: 'parse_request',
    owner: 'node',
    state: 'done',
    reused: false,
    replayable: true,
    because: undefined,
    childWorkflowId: undefined,
    nodeId: 'parse_request',
    duration: undefined,
    detail: { derived: undefined, plain: undefined, verbatim: undefined },
    detailTone: 'faint',
    sdkLabel: undefined,
    sdk: [],
    ...over,
  };
}

/**
 * The canonical run's trace, as the host sends it:
 * a row that returned something, a round that
 * threw, a round with the SDK's two rows beside it,
 * and the wait the run is parked on now. In the
 * order DBOS numbered them, with the SDK's rows
 * under the row they ran beside.
 */
export const TRACE: TraceRowView[] = [
  traceRow({
    duration: '12 ms',
    detail: {
      derived: undefined,
      plain: undefined,
      verbatim: '{ "slots": 3 }',
    },
  }),
  traceRow({
    functionId: 1,
    name: 'find_slot.r2',
    state: 'failed',
    nodeId: 'find_slot',
    duration: '1.2 s',
    detail: {
      derived: undefined,
      plain: 'TypeError',
      verbatim: 'no slot left',
    },
    detailTone: 'fail',
  }),
  traceRow({
    functionId: 2,
    name: 'find_slot.r3',
    nodeId: 'find_slot',
    duration: '2 m 14 s',
    detail: {
      derived: undefined,
      plain: undefined,
      verbatim: '{ "slot": "14:30" }',
    },
    sdkLabel: 'findSlot · 2 durable operations',
    sdk: [
      traceRow({
        functionId: 3,
        name: 'DBOS.recv',
        owner: 'sdk',
        nodeId: 'find_slot',
        replayable: false,
        because: SDK_OWNED,
        duration: '1 h 3 m',
        detail: {
          derived: undefined,
          plain: undefined,
          verbatim: '{ "approved": true }',
        },
      }),
      traceRow({
        functionId: 4,
        name: 'DBOS.sleep',
        owner: 'sdk',
        nodeId: 'find_slot',
        replayable: false,
        because: SDK_OWNED,
        detail: {
          derived: 'times out 14:04:11.000',
          plain: undefined,
          verbatim: undefined,
        },
      }),
    ],
  }),
  traceRow({
    functionId: 5,
    name: 'await_reply.register',
    state: 'waiting',
    nodeId: 'await_reply',
    replayable: false,
    because: 'The run is sitting here now.',
    duration: '3 ms',
    detail: {
      derived: 'waiting since 14:02:16.000 · timeout 3 d',
      plain: undefined,
      verbatim: undefined,
    },
  }),
];

/** A row naming a block the saved workflow no
 *  longer has. */
export const UNATTRIBUTED: TraceRowView[] = [
  traceRow({
    functionId: 6,
    name: 'gone_away',
    owner: 'unmapped',
    nodeId: undefined,
    replayable: false,
    because: 'That row is not a point a replay can start from.',
    duration: '40 ms',
    detail: { derived: undefined, plain: undefined, verbatim: '{}' },
  }),
];

/** The row a queue block wrote as it handed a page
 *  over, carrying the id of the run that took it.
 *  One clock read is both of its ends, so it has no
 *  length. */
export const QUEUED_TRACE: TraceRowView[] = [
  traceRow({
    name: 'index_pages.queued.document_ingestion',
    nodeId: 'index_pages',
    childWorkflowId: 'wf_child_9f21',
    detail: {
      derived: undefined,
      plain: 'Index each page',
      verbatim: undefined,
    },
  }),
];

/**
 * The same trace after a replay: the first row was
 * carried over from the run this one came out of,
 * and every later row is this run's own work.
 */
export const REPLAYED_TRACE: TraceRowView[] = TRACE.map((row) =>
  row.functionId === 0
    ? {
        ...row,
        reused: true,
        detail: { ...row.detail, derived: 'reused · ' },
      }
    : row,
);

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

/** The viewport's transform as it stands, for a
 *  case that watches it stop moving or holds it to
 *  what it was. */
export function transformOf(page: Page): Promise<string> {
  return page
    .locator('.react-flow__viewport')
    .evaluate((viewport) => (viewport as HTMLElement).style.transform);
}

/** The run the Inspector's card about a whole run
 *  is drawn from. A UUID, as DBOS mints them, so it
 *  has the short id a person reads it by. */
export const RUN_ID = '7089cd29-881b-4319-a16d-1af70cc1e9a7';

/** The run it was replayed from, so its lineage has
 *  a line above it. */
export const PARENT_ID = 'a5461ea0-3c1b-4b6e-9a55-0f8e2d7c4b10';

/** The replay made from it, so its lineage has a
 *  line below it too. */
export const FORK_ID = '3f2b9c1d-7e44-4d0a-8b6f-2a9d1c5e7f30';

/**
 * A whole run, as the Inspector is sent one with
 * nothing of it picked: finished, read on the run
 * tab, started with one small payload, and never
 * recovered, replayed or cancelled.
 */
export function runLevel(over: Partial<RunLevel> = {}): RunLevel {
  return {
    source: 'run',
    workflowId: RUN_ID,
    short: shortRunId(RUN_ID),
    workflow: 'airtable_etl',
    state: 'done',
    line: 'done · 1.6 s',
    input: { kind: 'inline', text: '{ "requestId": "airtable-etl-006" }' },
    ledger: [
      { label: 'workflow_uuid', value: RUN_ID },
      { label: 'status', value: 'SUCCESS' },
      { label: 'recovery_attempts', value: '1' },
      { label: 'executor_id', value: 'local' },
      { label: 'application_version', value: '1' },
    ],
    recovery: undefined,
    lineage: [],
    controls: {
      cancel: false,
      resume: false,
      cancelledAt: undefined,
      gaveUp: false,
    },
    replayStart: true,
    replayRefused: undefined,
    note: undefined,
    ...over,
  };
}

/** Where that run came from and what came out of
 *  it: replayed from step 3 of a run that failed,
 *  and replayed itself from step 2. */
export const RUN_LINEAGE: RunLineage[] = [
  {
    direction: 'of',
    workflowId: PARENT_ID,
    short: shortRunId(PARENT_ID),
    startStep: 3,
  },
  {
    direction: 'to',
    workflowId: FORK_ID,
    short: shortRunId(FORK_ID),
    startStep: 2,
    word: 'done',
  },
];
