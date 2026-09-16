import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runStateOf } from '../canvas/graph.js';
import { inspectorWords } from '../canvas/words.js';
import {
  NodeSchema,
  WorkflowIRSchema,
  type QueuePolicy,
  type WorkflowIR,
} from '../core/rules.js';
import type { QueueEvidence } from '../runs/queueEvidence.js';
import { INLINE_LIMIT, stepError } from '../runs/rows.js';
import type { LiveStep, QueueCounts } from '../runs/watch.js';
import {
  TIMER_THEN_ANSWER,
  TIMER_WAKES_AT,
  liveRun,
  liveStep,
  timerThenAnswerRun,
} from '../test-support/runs.js';
import type { QueueRow, ShownRun } from '../webview/protocol.js';

import { blockEvidenceOf, type EvidenceInputs } from './blockEvidence.js';

/**
 * What one run recorded about one block, as the
 * pane is handed it.
 *
 * The rows are the whole of it. A block that ran
 * three times wrote three of them, a wait wrote the
 * two halves of parking, and a block the generated
 * code decided without asking anybody wrote none —
 * so what is asked here is that each of those reads
 * back as what it is, rather than as an absence.
 * Where the block got to is asked of the board's
 * own rule, so the head of the pane and the block
 * on the graph cannot disagree.
 */

const strings = inspectorWords();

const groomBooking = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../mboss-core/fixtures/ir/groom_booking.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

/**
 * The canonical document, with a block that fans
 * out, two loops and a queue block beside its own:
 * each is a kind whose evidence reads differently,
 * and no workflow anybody would write holds them
 * all.
 */
const DOCUMENT: WorkflowIR = {
  ...groomBooking,
  nodes: [
    ...groomBooking.nodes,
    NodeSchema.parse({
      id: 'pack',
      kind: 'step',
      title: 'Pack',
      handler: { export: 'pack' },
      config: {},
    }),
    NodeSchema.parse({
      id: 'each_slot',
      kind: 'loop',
      title: 'Each slot',
      config: { minRounds: 1, maxRounds: 5, body: ['find_slot'] },
    }),
    NodeSchema.parse({
      id: 'each_item',
      kind: 'loop',
      title: 'Each item',
      config: { minRounds: 1, maxRounds: 5, body: ['pack'] },
    }),
    NodeSchema.parse({
      id: 'index_pages',
      kind: 'queue',
      title: 'Index each page',
      handler: { export: 'indexPage' },
      config: {
        itemsPath: 'pages',
        queue: { name: 'document-index', globalConcurrency: 8 },
        enqueue: {},
      },
    }),
  ],
};

/** What the run recorded about one block of that
 *  document, nothing picked unless a case says. */
function evidence(
  run: ShownRun,
  nodeId: string,
  over: Partial<EvidenceInputs> = {},
) {
  return blockEvidenceOf(
    {
      run,
      document: DOCUMENT,
      nodeId,
      decided: {},
      functionId: undefined,
      ...over,
    },
    strings,
  );
}

/**
 * A run of a workflow with a fan-out, a loop and a
 * wait in it.
 *
 * The names are the ones the emitter writes and the
 * ledger keeps: a block's id, then the region it
 * ran in. `nodeId` beside each is what the reading
 * already worked out from that name, which is what
 * a surface is handed.
 */
const RUN = liveRun({
  workflowId: 'wf_c9d2f3',
  steps: [
    liveStep({ name: 'parse_request', nodeId: 'parse_request', functionId: 0 }),
    liveStep({ name: 'pack[0]', nodeId: 'pack', functionId: 1 }),
    liveStep({ name: 'pack[1]', nodeId: 'pack', functionId: 2 }),
    liveStep({ name: 'pack[2]', nodeId: 'pack', functionId: 3 }),
    liveStep({ name: 'find_slot.r1', nodeId: 'find_slot', functionId: 4 }),
    liveStep({ name: 'find_slot.r2', nodeId: 'find_slot', functionId: 5 }),
    liveStep({
      name: 'await_reply.ask',
      nodeId: 'await_reply',
      functionId: 6,
      startedAt: 8000,
      completedAt: 8100,
    }),
    liveStep({
      name: 'await_reply.register',
      nodeId: 'await_reply',
      functionId: 7,
      state: 'waiting',
      startedAt: 8200,
      completedAt: 8300,
    }),
  ],
});

describe('what a run recorded about one block', () => {
  it('names the run the rows are of', () => {
    expect(evidence(RUN, 'pack').workflowId).toBe('wf_c9d2f3');
  });

  it('groups a block’s rows under it', () => {
    expect(evidence(RUN, 'pack').rows.map((row) => row.functionId)).toEqual([
      1, 2, 3,
    ]);
    expect(evidence(RUN, 'parse_request').rows).toHaveLength(1);
  });

  it('lists a fan-out’s items', () => {
    expect(evidence(RUN, 'pack').rows.map((row) => row.part)).toEqual([
      '[0]',
      '[1]',
      '[2]',
    ]);
  });

  it('lists a loop’s rounds', () => {
    expect(evidence(RUN, 'find_slot').rows.map((row) => row.part)).toEqual([
      '.r1',
      '.r2',
    ]);
  });

  /**
   * The registration is the row that says the run
   * parked, so the moment it landed is the moment
   * the waiting started. Nothing counts up from it:
   * the fact is a time, and a panel that ticked
   * would be drawing a run nothing is reading any
   * more.
   */
  it('reads a wait’s since from the register row', () => {
    expect(evidence(RUN, 'await_reply').waitingSince).toBe(8300);
  });

  /**
   * A wait on the clock writes no row under its own
   * name, so the reading hands it the sleep the SDK
   * wrote — and the block has to count that row
   * among the wait's or be drawn as one that
   * recorded nothing. What the row returned is the
   * time it wakes, which the face says as when it
   * wakes, so there is no output beside it.
   */
  it('counts a wait on the clock’s sleep among its own rows, and says nothing of what it returned', () => {
    const found = blockEvidenceOf(
      {
        run: timerThenAnswerRun({ attributed: true }),
        document: TIMER_THEN_ANSWER,
        nodeId: 'let_it_wait',
        decided: {},
        functionId: undefined,
      },
      strings,
    );

    expect(found.rows.map((row) => row.functionId)).toEqual([0]);
    expect(found.drawn?.state).toBe('waiting');
    expect(found.drawn?.completedAt).toBe(TIMER_WAKES_AT);
    expect(found.output).toBeUndefined();
  });

  /**
   * A row's part is the region inside the block it
   * ran in, read by taking the block's own id off
   * the front of the name. The SDK's name does not
   * start with one, so there is no region to take.
   */
  it('gives a row the SDK named no part of the block', () => {
    const asleep = liveRun({
      steps: [
        liveStep({
          name: 'DBOS.sleep',
          nodeId: 'await_reply',
          state: 'waiting',
        }),
      ],
    });

    expect(evidence(asleep, 'await_reply').rows[0]?.part).toBeUndefined();
  });

  /** And says nothing about a block that is not
   *  parked, however many registrations it once
   *  wrote. */
  it('says nothing about a block the run is not parked on', () => {
    expect(evidence(RUN, 'pack').waitingSince).toBeUndefined();
  });

  it('gives a predicate branch no rows', () => {
    const found = evidence(RUN, 'reply_decision');

    expect(found.rows).toEqual([]);
    expect(found.drawn).toBeUndefined();
  });

  /**
   * DBOS stores the wrapper it threw over a step
   * that ran out of tries, and the wrapper's own
   * sentence names no cause. The reading already
   * takes the headline off the last try; what is
   * held here is that the block reads that headline
   * rather than the wrapper's.
   */
  it('takes an exhausted step’s headline from the last attempt', () => {
    const failed = liveRun({
      steps: [
        liveStep({
          name: 'find_slot',
          nodeId: 'find_slot',
          state: 'failed',
          error: stepError({
            name: 'DBOSMaxStepRetriesError',
            message: 'Step find_slot has exceeded its maximum of 3 retries',
            errors: [
              { name: 'StripeTimeoutError', message: 'timed out once' },
              { name: 'StripeTimeoutError', message: 'timed out again' },
            ],
          }),
        }),
      ],
    });

    const { drawn } = evidence(failed, 'find_slot');

    expect(drawn?.error?.message).toBe('timed out again');
    expect(drawn?.error?.retriesExhausted).toBe(true);
  });

  /**
   * A loop is generated as the control flow around
   * its body, so the ledger holds nothing under its
   * name. How far round the run went is read off the
   * rows the body wrote, which is the only evidence
   * there is — and which rows are the body's is the
   * document's answer.
   */
  it('says a loop has no row of its own', () => {
    const found = evidence(RUN, 'each_slot');

    expect(found.rows).toEqual([]);
    expect(found.rounds).toBe(2);
  });

  /**
   * Two loops in one workflow are two counts.
   *
   * A row carries the round it ran in and not the
   * loop that numbered it, so which rows belong to
   * which loop is a question only the document
   * answers — and the count is scoped to the loop's
   * own body rather than to every round in the run.
   */
  it('counts each loop’s rounds inside that loop', () => {
    const twice = liveRun({
      steps: [
        liveStep({ name: 'find_slot.r1', nodeId: 'find_slot', functionId: 0 }),
        liveStep({ name: 'find_slot.r2', nodeId: 'find_slot', functionId: 1 }),
        liveStep({ name: 'find_slot.r3', nodeId: 'find_slot', functionId: 2 }),
        liveStep({ name: 'pack.r1', nodeId: 'pack', functionId: 3 }),
        liveStep({ name: 'pack.r2', nodeId: 'pack', functionId: 4 }),
        liveStep({ name: 'pack.r3', nodeId: 'pack', functionId: 5 }),
        liveStep({ name: 'pack.r4', nodeId: 'pack', functionId: 6 }),
        liveStep({ name: 'pack.r5', nodeId: 'pack', functionId: 7 }),
      ],
    });

    expect(evidence(twice, 'each_slot').rounds).toBe(3);
    expect(evidence(twice, 'each_item').rounds).toBe(5);
  });

  /** A block that is not a loop encloses nothing to
   *  count in, and a number drawn from the whole run
   *  would be answering about somebody else's rows. */
  it('counts no rounds for a block that encloses none', () => {
    expect(evidence(RUN, 'find_slot').rounds).toBeUndefined();
  });

  /** The rows are still evidence about the block a
   *  document has lost since: they are what its id
   *  is known by. */
  it('reads the rows of a block the document no longer has', () => {
    const found = evidence(RUN, 'pack', {
      document: { ...DOCUMENT, nodes: groomBooking.nodes },
    });

    expect(found.rows).toHaveLength(3);
    expect(found.rounds).toBeUndefined();
  });
});

/**
 * The one row a block is headed by, where nobody
 * picked one.
 *
 * The latest failure where there is one, since a
 * block that failed on its third item is being
 * looked at because of that item; the latest row
 * otherwise. A row the SDK wrote for itself is
 * drawn when somebody picks it in the trace, and
 * is never what a block leads with: it is the
 * machinery under the block, not the block.
 */
describe('the row a block is headed by', () => {
  const row = (functionId: number, over: Partial<LiveStep> = {}) =>
    liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId, ...over });

  function headed(...steps: LiveStep[]) {
    return evidence(liveRun({ steps }), 'find_slot');
  }

  it('is the last failed row', () => {
    const found = headed(
      row(0, { state: 'failed' }),
      row(1, { state: 'failed' }),
      row(2),
    );

    expect(found.drawn?.functionId).toBe(1);
  });

  it('is the last row where none failed', () => {
    expect(headed(row(0), row(1), row(2)).drawn?.functionId).toBe(2);
  });

  it('is nothing for a block with no rows', () => {
    expect(headed().drawn).toBeUndefined();
  });

  it('is never a row the SDK wrote for itself', () => {
    const found = headed(
      row(0),
      row(1, { name: 'DBOS.recv', state: 'failed', sdk: true }),
      row(2, { name: 'DBOS.sleep', sdk: true }),
    );

    expect(found.rows).toHaveLength(3);
    expect(found.drawn?.functionId).toBe(0);
  });

  /**
   * On the run tab a block's run carries the rows
   * the SDK wrote under it, so a pick in the trace
   * can land on one. Both count among the block's
   * rows; the block is still headed by its own.
   */
  it('heads a run-tab block by its own row, not the SDK’s under it', () => {
    const run = liveRun({
      steps: [
        row(4, { name: 'await_reply.register', nodeId: 'await_reply' }),
        row(5, { name: 'DBOS.sleep', nodeId: 'await_reply', sdk: true }),
      ],
    });

    const found = evidence(run, 'await_reply');

    expect(found.rows.map((one) => one.functionId)).toEqual([4, 5]);
    expect(found.drawn?.functionId).toBe(4);
    expect(found.rows.map((one) => one.sdk)).toEqual([false, true]);
  });
});

/**
 * The row the face draws in full: the one picked
 * on the run tab, where it is one of the block's,
 * and the headline otherwise — so a pick that
 * belongs to another block, or none at all, still
 * shows the block rather than nothing.
 */
describe('the row the face draws', () => {
  const run = liveRun({
    steps: [
      liveStep({ name: 'pack[0]', nodeId: 'pack', functionId: 1 }),
      liveStep({ name: 'pack[1]', nodeId: 'pack', functionId: 2 }),
      liveStep({
        name: 'pack[2]',
        nodeId: 'pack',
        functionId: 3,
        state: 'failed',
      }),
      liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId: 4 }),
    ],
  });

  it('is the row somebody picked, and says so', () => {
    const found = evidence(run, 'pack', { functionId: 2 });

    expect(found.drawn?.functionId).toBe(2);
    expect(found.picked).toBe(true);
  });

  it('is the headline where nothing was picked', () => {
    const found = evidence(run, 'pack');

    expect(found.drawn?.functionId).toBe(3);
    expect(found.picked).toBe(false);
  });

  it('is the headline where the pick is another block’s row', () => {
    const found = evidence(run, 'pack', { functionId: 4 });

    expect(found.drawn?.functionId).toBe(3);
    expect(found.picked).toBe(false);
  });
});

/**
 * Where the block got to, for the head of the pane.
 *
 * Read off the drawn row where there is one. Where
 * there is none it is worked out — a trigger fired
 * because the run exists, and a block with no row
 * is where the run may be — by the rule the board
 * draws every block with, asked of the same document
 * and the same arms, so the head and the graph
 * cannot say two things about one block.
 */
describe('where the block got to', () => {
  /** The run part-way through the canonical
   *  workflow: one block done, the next not yet
   *  written. */
  const partWay = liveRun({
    steps: [
      liveStep({
        name: 'parse_request',
        nodeId: 'parse_request',
        functionId: 0,
      }),
    ],
  });

  const walked = (run: ShownRun, nodeId: string) =>
    runStateOf(DOCUMENT, run, nodeId, new Map());

  it('is the drawn row’s state and number', () => {
    expect(evidence(RUN, 'await_reply', { functionId: 7 }).state).toEqual({
      word: 'waiting',
      read: 'row',
      functionId: 7,
    });
    expect(evidence(RUN, 'pack').state).toEqual({
      word: 'done',
      read: 'row',
      functionId: 3,
    });
  });

  it('is worked out for a trigger by the board’s rule, and says so', () => {
    const { state } = evidence(partWay, 'booking_requested');

    expect(walked(partWay, 'booking_requested')).toBeDefined();
    expect(state).toEqual({
      word: walked(partWay, 'booking_requested'),
      read: 'derived',
      derived: 'trigger',
    });
  });

  it('is worked out for a block the run has not reached, and says so', () => {
    expect(evidence(partWay, 'find_slot').state).toEqual({
      word: 'running',
      read: 'derived',
      derived: 'running',
    });
    expect(walked(partWay, 'find_slot')).toBe('running');
  });

  it('is nothing for a block the run says nothing about', () => {
    expect(evidence(partWay, 'book_appointment').state).toBeUndefined();
  });

  /** A queue block's state is its children's, and
   *  they are seldom all at one. */
  it('is nothing for a queue block', () => {
    const queued = liveRun({
      steps: [],
      queues: {
        index_pages: { queued: 4, delayed: 0, active: 2, done: 1, failed: 0 },
      },
    });

    expect(evidence(queued, 'index_pages').state).toBeUndefined();
  });

  /** A block the document has lost is still headed
   *  by the row it wrote; with none, nothing can be
   *  worked out about it. */
  it('is the row’s, and otherwise nothing, for a block the document lost', () => {
    const lost = { ...DOCUMENT, nodes: groomBooking.nodes };

    expect(evidence(RUN, 'pack', { document: lost }).state).toEqual({
      word: 'done',
      read: 'row',
      functionId: 3,
    });
    expect(evidence(partWay, 'pack', { document: lost }).state).toBeUndefined();
  });
});

/**
 * What a row returned, drawn the way its size
 * allows: whole up to the inline limit, and past it
 * as something to open, with its size. A step that
 * returned nothing at all has no output to draw.
 */
describe('what a row returned, as the face draws it', () => {
  function outputOfStep(output: string | undefined) {
    return evidence(liveRun({ steps: [liveStep({ output })] }), 'parse_request')
      .output;
  }

  it('draws a value as long as the limit inline', () => {
    const text = JSON.stringify('x'.repeat(INLINE_LIMIT - 2));

    expect(outputOfStep(text)).toEqual({ kind: 'inline', text });
  });

  it('draws a longer one as something to open, with its size', () => {
    const text = JSON.stringify('x'.repeat(INLINE_LIMIT - 1));

    expect(outputOfStep(text)).toEqual({
      kind: 'artifact',
      preview: text,
      size: '121 B',
    });
  });

  it('draws text that is not JSON by the same rule', () => {
    expect(outputOfStep('y'.repeat(INLINE_LIMIT + 1))).toMatchObject({
      kind: 'artifact',
      size: '121 B',
    });
  });

  it('draws nothing for a step that returned nothing', () => {
    const nothing = JSON.stringify({
      json: null,
      meta: { values: ['undefined'] },
      __dbos_serializer: 'superjson',
    });

    expect(outputOfStep(undefined)).toBeUndefined();
    expect(outputOfStep(nothing)).toBeUndefined();
  });

  it('draws nothing where the block wrote no row', () => {
    expect(evidence(RUN, 'reply_decision').output).toBeUndefined();
  });
});

/**
 * A row a replay carried over.
 *
 * The face says it was reused rather than drawing
 * the block differently: what the earlier run
 * recorded is this run's evidence too, and the
 * block did what it did.
 */
describe('a row a replay carried over', () => {
  it('carries whether the row was reused', () => {
    const replayed = liveRun({
      forkedFrom: 'wf_a1b4e7',
      steps: [
        liveStep({
          name: 'parse_request',
          nodeId: 'parse_request',
          reused: true,
        }),
        liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId: 1 }),
      ],
    });

    expect(evidence(replayed, 'parse_request').drawn?.reused).toBe(true);
    expect(evidence(replayed, 'find_slot').drawn?.reused).toBe(false);
  });
});

/**
 * What a queue block's card says.
 *
 * Three provenances, and each row says its own: the
 * counts a tick already read, the two limits the
 * document sets beside them, and — where somebody
 * opened the card and the whole queue was read —
 * what the window and the registration said. Every
 * other block has no card here, since it writes
 * rows.
 */
describe('what a queue block’s card says', () => {
  /** A run of the document with its queue block's
   *  children part-way through — or, with no counts,
   *  opened from a cold read — and the one read a
   *  pick costs where a case made it. */
  function queued(
    counts?: Partial<QueueCounts>,
    read?: QueueEvidence,
  ): ShownRun {
    return {
      ...liveRun({ steps: [] }),
      ...(counts === undefined
        ? {}
        : {
            queues: {
              index_pages: {
                queued: 0,
                delayed: 0,
                active: 0,
                done: 0,
                failed: 0,
                ...counts,
              },
            },
          }),
      ...(read === undefined ? {} : { queueEvidence: { index_pages: read } }),
    };
  }

  /** The document with its queue block's policy
   *  changed. */
  function withQueue(queue: QueuePolicy): WorkflowIR {
    return {
      ...DOCUMENT,
      nodes: DOCUMENT.nodes.map((node) =>
        node.kind === 'queue' && node.id === 'index_pages'
          ? { ...node, config: { ...node.config, queue } }
          : node,
      ),
    };
  }

  const READ: QueueEvidence = {
    window: {
      queued: 4,
      active: 2,
      started: 74,
      failedRecently: 2,
      windowSec: 60,
    },
    registered: 'matches',
    recent: [{ workflowId: 'wf_child_1', label: 'doc_7', status: 'PENDING' }],
  };

  function card(run: ShownRun, document: WorkflowIR = DOCUMENT) {
    const found = evidence(run, 'index_pages', { document }).queue;

    expect(found).toBeDefined();

    return found!;
  }

  function valueOf(rows: readonly QueueRow[], id: string): string | undefined {
    return rows.find((row) => row.id === id)?.value;
  }

  it('is nothing for a block that writes rows', () => {
    expect(evidence(RUN, 'pack').queue).toBeUndefined();
    expect(evidence(RUN, 'booking_requested').queue).toBeUndefined();
  });

  it('draws the counts, the name and where each of them came from', () => {
    const { rows } = card(queued({ active: 3, queued: 12, failed: 1 }));

    expect(rows.map((row) => [row.id, row.value, row.provenance])).toEqual([
      ['queue', 'document-index', 'configured'],
      ['active', '3 of 8 queue-wide', 'derived'],
      ['queued', '12', 'derived'],
      ['failed', '1', 'derived'],
      ['globalConcurrency', '8', 'configured'],
    ]);
    expect(rows[0]?.label).toBe(strings.queueRows.queue);
  });

  /** The ceiling is the document's, so a queue
   *  nobody gave one is a queue with no ceiling to
   *  measure this run against. */
  it('measures this run against the whole queue only where there is a ceiling', () => {
    const { rows } = card(
      queued({ active: 3 }),
      withQueue({ name: 'document-index' }),
    );

    expect(valueOf(rows, 'active')).toBe('3');
    expect(rows.some((row) => row.id === 'globalConcurrency')).toBe(false);
  });

  /** A block whose items are all sitting out a delay
   *  is a different thing from one whose items are
   *  all waiting for room — and a block with no
   *  delayed items is neither. */
  it('counts delayed items again only where there are any', () => {
    expect(
      valueOf(card(queued({ queued: 12, delayed: 4 })).rows, 'queued'),
    ).toBe('12 · 4 delayed');
    expect(valueOf(card(queued({ queued: 12 })).rows, 'queued')).toBe('12');
  });

  it('draws a rate limit as the pair it is', () => {
    const { rows } = card(
      queued(),
      withQueue({
        name: 'document-index',
        rateLimit: { limitPerPeriod: 5, periodSec: 10 },
      }),
    );

    expect(rows.find((row) => row.id === 'rateLimit')).toEqual({
      id: 'rateLimit',
      label: strings.queueRows.rateLimit,
      value: '5 per 10 s',
      provenance: 'configured',
    });
  });

  /**
   * A run opened from a cold read carries no counts
   * at all — only a watch fills them — so the card
   * draws what the document says and claims nothing
   * about the work.
   */
  it('says nothing about counts no tick has read', () => {
    const { rows } = card(queued());

    expect(rows.map((row) => row.id)).toEqual(['queue', 'globalConcurrency']);
  });

  /** The rows that cost a read of their own are
   *  there only once somebody made it, and so are
   *  the items. */
  it('leaves every row that costs a read until one was made', () => {
    const unread = card(queued({ active: 3 }));

    expect(unread.rows.map((row) => row.id)).not.toContain('observedStarts');
    expect(unread.rows.map((row) => row.id)).not.toContain('registered');
    expect(unread.recent).toEqual([]);

    const read = card(queued({ active: 3 }, READ));

    expect(read.rows.map((row) => row.id).slice(-2)).toEqual([
      'observedStarts',
      'registered',
    ]);
    expect(valueOf(read.rows, 'observedStarts')).toBe('74 in the last 60 s');
    expect(valueOf(read.rows, 'registered')).toBe(strings.queueMatches);
    expect(read.recent).toEqual(READ.recent);
  });

  /** The window's own failures go on the run's
   *  failed row rather than on a row of their own:
   *  one fact at two scales, and two rows would read
   *  as two failures. */
  it('says the window’s failures on the run’s failed row', () => {
    const { rows } = card(queued({ active: 3, failed: 1 }, READ));

    expect(valueOf(rows, 'failed')).toBe(
      '1 · 2 errored queue-wide in the window',
    );
  });

  it('says what the app registered where it differs from the document', () => {
    const { rows } = card(
      queued(
        { active: 3 },
        {
          ...READ,
          registered: {
            registered: { name: 'document-index', globalConcurrency: 4 },
          },
        },
      ),
    );

    expect(valueOf(rows, 'registered')).toBe(
      `${strings.queueDiffers.replace('{0}', `${strings.queueLimits.globalConcurrency} 4`)}`,
    );
    expect(
      valueOf(
        card(queued({ active: 3 }, { ...READ, registered: 'absent' })).rows,
        'registered',
      ),
    ).toBe(strings.queueUnregistered);
  });
});
