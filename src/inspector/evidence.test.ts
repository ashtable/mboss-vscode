import { describe, expect, it } from 'vitest';

import type { QueuePolicy } from '../core/rules.js';
import { INLINE_LIMIT, stepError } from '../runs/rows.js';
import type { LiveRun, LiveStep, QueueCounts } from '../runs/watch.js';
import {
  TIMER_WAKES_AT,
  liveRun,
  liveStep,
  timerThenAnswerRun,
} from '../test-support/runs.js';
import { inspectorWords } from '../canvas/words.js';

import {
  evidenceOf,
  headlineOf,
  outputOf,
  queueRowsOf,
  type QueueRow,
} from './evidence.js';

/**
 * What one run recorded about one block.
 *
 * The rows are the whole of it. A block that ran
 * three times wrote three of them, a wait wrote the
 * two halves of parking, and a block the generated
 * code decided without asking anybody wrote none —
 * so what is asked here is that each of those reads
 * back as what it is, rather than as an absence.
 */

/**
 * A run of a workflow with a fan-out, a loop and a
 * wait in it.
 *
 * The names are the ones the emitter writes and the
 * ledger keeps: a block's id, then the region it
 * ran in. `nodeId` beside each is what the reading
 * already worked out from that name, which is what
 * a canvas is handed.
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
  it('groups a block’s rows under it', () => {
    const found = evidenceOf(RUN, 'pack', undefined);

    expect(found.rows.map((row) => row.functionId)).toEqual([1, 2, 3]);
    expect(evidenceOf(RUN, 'parse_request', undefined).rows).toHaveLength(1);
  });

  it('lists a fan-out’s items', () => {
    expect(
      evidenceOf(RUN, 'pack', undefined).rows.map((row) => row.part),
    ).toEqual(['[0]', '[1]', '[2]']);
  });

  it('lists a loop’s rounds', () => {
    expect(
      evidenceOf(RUN, 'find_slot', undefined).rows.map((row) => row.part),
    ).toEqual(['.r1', '.r2']);
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
    expect(evidenceOf(RUN, 'await_reply', undefined).waitingSince).toBe(8300);
  });

  /**
   * A wait on the clock writes no row under its own
   * name, so the reading hands it the sleep the SDK
   * wrote — and the card has to count that row among
   * the wait's or draw a block the run is sitting at
   * as one that recorded nothing.
   */
  it('counts a wait on the clock’s sleep among its own rows', () => {
    const found = evidenceOf(
      timerThenAnswerRun({ attributed: true }),
      'let_it_wait',
      undefined,
    );

    expect(found.rows.map((row) => row.functionId)).toEqual([0]);
    expect(found.headline?.state).toBe('waiting');
    expect(found.headline?.completedAt).toBe(TIMER_WAKES_AT);
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
        liveStep({ name: 'DBOS.sleep', nodeId: 'wait', state: 'waiting' }),
      ],
    });

    expect(evidenceOf(asleep, 'wait', undefined).rows[0]?.part).toBeUndefined();
  });

  /** And says nothing about a block that is not
   *  parked, however many registrations it once
   *  wrote. */
  it('says nothing about a block the run is not parked on', () => {
    expect(evidenceOf(RUN, 'pack', undefined).waitingSince).toBeUndefined();
  });

  it('gives a predicate branch no rows', () => {
    const found = evidenceOf(RUN, 'reply_decision', undefined);

    expect(found.rows).toEqual([]);
    expect(found.headline).toBeUndefined();
  });

  /**
   * DBOS stores the wrapper it threw over a step
   * that ran out of tries, and the wrapper's own
   * sentence names no cause. The reading already
   * takes the headline off the last try; what is
   * held here is that the card reads that headline
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

    const headline = evidenceOf(failed, 'find_slot', undefined).headline;

    expect(headline?.error?.message).toBe('timed out again');
    expect(headline?.error?.retriesExhausted).toBe(true);
  });

  /**
   * A loop is generated as the control flow around
   * its body, so the ledger holds nothing under its
   * name. How far round the run went is read off the
   * rows the body wrote, which is the only evidence
   * there is.
   */
  it('says a loop has no row of its own', () => {
    const found = evidenceOf(RUN, 'each_slot', ['find_slot']);

    expect(found.rows).toEqual([]);
    expect(found.rounds).toBe(2);
  });

  /**
   * Two loops in one workflow are two counts.
   *
   * A row carries the round it ran in and not the
   * loop that numbered it, so which rows belong to
   * which loop is a question only the document
   * answers — and the card is handed that answer
   * rather than counting every round in the run.
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

    expect(evidenceOf(twice, 'each_slot', ['find_slot']).rounds).toBe(3);
    expect(evidenceOf(twice, 'each_item', ['pack']).rounds).toBe(5);
  });

  /** A block that is not a loop is told nothing to
   *  count in, and a card that drew a number from
   *  the whole run would be answering about
   *  somebody else's rows. */
  it('counts no rounds for a block that encloses none', () => {
    expect(evidenceOf(RUN, 'find_slot', undefined).rounds).toBeUndefined();
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
  function rowsOf(...steps: LiveStep[]) {
    return evidenceOf(liveRun({ steps }), 'find_slot', undefined).rows;
  }

  const row = (functionId: number, over: Partial<LiveStep> = {}) =>
    liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId, ...over });

  it('is the last failed row', () => {
    const rows = rowsOf(
      row(0, { state: 'failed' }),
      row(1, { state: 'failed' }),
      row(2),
    );

    expect(headlineOf(rows)?.functionId).toBe(1);
  });

  it('is the last row where none failed', () => {
    expect(headlineOf(rowsOf(row(0), row(1), row(2)))?.functionId).toBe(2);
  });

  it('is nothing for a block with no rows', () => {
    expect(headlineOf([])).toBeUndefined();
  });

  it('is never a row the SDK wrote for itself', () => {
    const rows = rowsOf(
      row(0),
      row(1, { name: 'DBOS.recv', state: 'failed', sdk: true }),
      row(2, { name: 'DBOS.sleep', sdk: true }),
    );

    expect(rows).toHaveLength(3);
    expect(headlineOf(rows)?.functionId).toBe(0);
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

    const found = evidenceOf(run, 'await_reply', undefined);

    expect(found.rows.map((one) => one.functionId)).toEqual([4, 5]);
    expect(found.headline?.functionId).toBe(4);
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

  it('is the row somebody picked', () => {
    const found = evidenceOf(run, 'pack', undefined, 2);

    expect(found.drawn?.functionId).toBe(2);
    expect(found.headline?.functionId).toBe(3);
  });

  it('is the headline where nothing was picked', () => {
    expect(evidenceOf(run, 'pack', undefined).drawn?.functionId).toBe(3);
  });

  it('is the headline where the pick is another block’s row', () => {
    expect(evidenceOf(run, 'pack', undefined, 4).drawn?.functionId).toBe(3);
  });
});

/**
 * What a row returned, drawn the way its size
 * allows: whole up to the inline limit, and past it
 * as something to open, with its size. A step that
 * returned nothing at all has no output to draw.
 */
describe('what a row returned, as the face draws it', () => {
  const sizes = inspectorWords().sizes;

  function outputOfStep(output: string | undefined) {
    const found = evidenceOf(
      liveRun({ steps: [liveStep({ output })] }),
      'parse_request',
      undefined,
    );

    return outputOf(found.drawn!, sizes);
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
});

/**
 * A row a replay carried over.
 *
 * The face says it was reused rather than
 * drawing the block differently: what the earlier
 * run recorded is this run's evidence too, and the
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

    expect(
      evidenceOf(replayed, 'parse_request', undefined).headline?.reused,
    ).toBe(true);
    expect(evidenceOf(replayed, 'find_slot', undefined).headline?.reused).toBe(
      false,
    );
  });
});

/**
 * What a queue block's card says about this run's
 * share of the queue.
 *
 * The counts a tick already read, plus the two
 * limits the document sets — and nothing else. What
 * the whole queue is doing, and whether the app
 * registered the queue the way the document asks
 * for it, are one read apiece and belong to
 * whatever made that read.
 */
describe('what a queue block’s card says', () => {
  const strings = inspectorWords();

  const INDEXING: QueuePolicy = {
    name: 'document-index',
    globalConcurrency: 8,
  };

  /** A run of a workflow with one queue block in it,
   *  and that block's children part-way through. */
  function queued(counts: Partial<QueueCounts> = {}): LiveRun {
    return liveRun({
      steps: [],
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
    });
  }

  function valueOf(rows: readonly QueueRow[], id: string): string | undefined {
    return rows.find((row) => row.id === id)?.value;
  }

  it('draws the counts, the name and where each of them came from', () => {
    const rows = queueRowsOf(
      queued({ active: 3, queued: 12, failed: 1 }),
      'index_pages',
      INDEXING,
      strings,
    );

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
    const rows = queueRowsOf(
      queued({ active: 3 }),
      'index_pages',
      { name: 'document-index' },
      strings,
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
      valueOf(
        queueRowsOf(
          queued({ queued: 12, delayed: 4 }),
          'index_pages',
          INDEXING,
          strings,
        ),
        'queued',
      ),
    ).toBe('12 · 4 delayed');

    expect(
      valueOf(
        queueRowsOf(queued({ queued: 12 }), 'index_pages', INDEXING, strings),
        'queued',
      ),
    ).toBe('12');
  });

  it('draws a rate limit as the pair it is', () => {
    const rows = queueRowsOf(
      queued(),
      'index_pages',
      {
        name: 'document-index',
        rateLimit: { limitPerPeriod: 5, periodSec: 10 },
      },
      strings,
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
   * at all — `liveRunOf` never fills them and only a
   * watch does — so the card draws what the document
   * says and claims nothing about the work.
   */
  it('says nothing about counts no tick has read', () => {
    const rows = queueRowsOf(
      liveRun({ steps: [] }),
      'index_pages',
      INDEXING,
      strings,
    );

    expect(rows.map((row) => row.id)).toEqual(['queue', 'globalConcurrency']);
  });

  /** And nothing at all about the whole queue: those
   *  rows cost a read of their own, and this is the
   *  half that costs nothing. */
  it('leaves every row that costs a read to whoever made one', () => {
    const rows = queueRowsOf(
      queued({ active: 3 }),
      'index_pages',
      INDEXING,
      strings,
    );

    expect(rows.map((row) => row.id)).not.toContain('observedStarts');
    expect(rows.map((row) => row.id)).not.toContain('registered');
    expect(rows.map((row) => row.id)).not.toContain('recentWork');
  });
});
