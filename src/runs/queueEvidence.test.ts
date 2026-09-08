import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeSchema } from '../core/rules.js';

import type { Database, OpenDatabase } from './db.js';
import {
  DEFAULT_POLLING_MS,
  DEFAULT_WINDOW_SEC,
  queueEvidenceOf,
  type QueueBlock,
} from './queueEvidence.js';

/**
 * What one queue block is doing, read once because
 * somebody selected it.
 *
 * Three statements on one connection, against a
 * database written by hand here. What is worth
 * asserting is the arithmetic either side of them:
 * how wide the window is, whether the row the app
 * registered says the same thing the document does,
 * and what each item in flight is called.
 */

const URL = 'postgres://app@localhost:5432/sys';

const RUN = { workflowId: 'wf_c9d2f3', workflow: 'document_ingestion_queued' };

/** A moment to read `since` against, since the
 *  window is measured back from now. */
const NOW = new Date(2026, 8, 7, 10, 31, 14, 218).getTime();

type Row = Record<string, unknown>;

type Ledger = {
  open: OpenDatabase;

  /** What the whole queue is doing. */
  window: Row;

  /** The row `dbos.queues` holds, or nothing where
   *  the app has registered no queue of that name. */
  registered: Row | undefined;

  /** The children the block started, newest first. */
  items: Row[];

  /** Every statement read, with what it bound. */
  asked: { text: string; values: unknown[] }[];

  closed: number;

  /** What every read fails with, while it is set. */
  fail: string | undefined;
};

function ledger(over: Partial<Ledger> = {}): Ledger {
  const state: Ledger = {
    window: windowRow(),
    registered: undefined,
    items: [],
    asked: [],
    closed: 0,
    fail: undefined,
    open: async () => connection,
    ...over,
  };

  const connection: Database = {
    query: async <Value>(text: string, values: unknown[]) => {
      state.asked.push({ text, values });

      if (state.fail !== undefined) throw new Error(state.fail);

      if (text.includes('dbos.queues')) {
        return (
          state.registered === undefined ? [] : [state.registered]
        ) as Value[];
      }

      if (text.includes('queue_name = $1')) return [state.window] as Value[];

      return state.items as Value[];
    },
    close: async () => {
      state.closed += 1;
    },
  };

  return state;
}

function windowRow(over: Row = {}): Row {
  return {
    queued: '4',
    active: '2',
    started: '74',
    failed_recently: '1',
    ...over,
  };
}

/** A row of `dbos.queues`, with every limit unset
 *  and the polling interval the SDK writes for a
 *  queue nobody gave one. */
function queuesRow(over: Row = {}): Row {
  return {
    name: 'document-index',
    concurrency: null,
    worker_concurrency: null,
    rate_limit_max: null,
    rate_limit_period_sec: null,
    partition_queue: false,
    partition_concurrency: null,
    partition_worker_concurrency: null,
    partition_rate_limit_max: null,
    partition_rate_limit_period_sec: null,
    polling_interval_sec: 1,
    ...over,
  };
}

/** One child of the block, as the two joined tables
 *  hand it over. */
function itemRow(over: Row = {}): Row {
  return {
    workflow_uuid: 'wf_1700000000000_a1b2c3d4',
    status: 'PENDING',
    created_at: '1000',
    started_at_epoch_ms: '1000',
    completed_at: null,
    error: null,
    serialization: null,
    recovery_attempts: '1',
    deduplication_id: null,
    queue_partition_key: null,
    ...over,
  };
}

/** The document's queue block, parsed the way a
 *  saved document is rather than asserted into
 *  shape. */
function block(queue: Row, enqueue: Row = {}): QueueBlock {
  const node = NodeSchema.parse({
    id: 'index_pages',
    title: 'Index pages',
    kind: 'queue',
    handler: { export: 'indexPage' },
    config: { itemsPath: 'pages', queue, enqueue },
  });

  if (node.kind !== 'queue') throw new Error('not a queue block');

  return node;
}

const PLAIN = { name: 'document-index' };

afterEach(() => {
  vi.useRealTimers();
});

/** Reads with the clock stopped, so that the moment
 *  the window is measured back from is one this
 *  spec chose. */
async function read(ledgerAt: Ledger, node: QueueBlock) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  return await queueEvidenceOf(ledgerAt.open, URL, RUN, node);
}

describe('the window a queue block is read over', () => {
  /**
   * The period the queue is limited over, where it
   * is limited: a rate limit is the one number the
   * document holds about how long "recently" is,
   * and reading a five-second budget over a minute
   * would answer about twelve of them.
   */
  it('takes the window from the queue’s own rate limit period', async () => {
    const held = ledger();
    const found = await read(
      held,
      block({ ...PLAIN, rateLimit: { limitPerPeriod: 5, periodSec: 10 } }),
    );

    expect(found.window.windowSec).toBe(10);

    const asked = held.asked.find((one) =>
      one.text.includes('queue_name = $1'),
    );

    expect(asked?.values[2]).toBe(NOW - 10_000);
  });

  it('reads a minute where the queue holds no rate limit', async () => {
    const held = ledger();
    const found = await read(held, block(PLAIN));

    expect(found.window.windowSec).toBe(DEFAULT_WINDOW_SEC);

    const asked = held.asked.find((one) =>
      one.text.includes('queue_name = $1'),
    );

    expect(asked?.values[2]).toBe(NOW - DEFAULT_WINDOW_SEC * 1000);
  });

  it('reads the four counts the window answers with', async () => {
    const found = await read(ledger(), block(PLAIN));

    expect(found.window).toEqual({
      queued: 4,
      active: 2,
      started: 74,
      failedRecently: 1,
      windowSec: DEFAULT_WINDOW_SEC,
    });
  });
});

/**
 * What the app registered against what the document
 * asks for.
 *
 * Field by field, over what the table stores and the
 * document owns — never a deep compare of the two
 * objects. Three of the columns are not the
 * document's to set and one of the document's fields
 * has no column at all, so a literal comparison
 * would answer "differs" for a queue nobody has
 * touched.
 */
describe('what the running app registered', () => {
  it('calls a row that says what the document says a match', async () => {
    const found = await read(
      ledger({ registered: queuesRow({ concurrency: 8 }) }),
      block({ ...PLAIN, globalConcurrency: 8 }),
    );

    expect(found.registered).toBe('matches');
  });

  /**
   * The SDK fills the polling interval from the
   * document's own default, so the column is never
   * null and a document that set nothing still reads
   * back as one second.
   */
  it('reads a polling interval the document left alone as its default', async () => {
    const found = await read(
      ledger({ registered: queuesRow({ polling_interval_sec: 1 }) }),
      block(PLAIN),
    );

    expect(DEFAULT_POLLING_MS).toBe(1000);
    expect(found.registered).toBe('matches');
  });

  /** And still says so where the document asked for
   *  a different one: the default is a stand-in for
   *  an absent field, not a value that swallows
   *  every reading. */
  it('says a polling interval the document did set and the app did not differs', async () => {
    const found = await read(
      ledger({ registered: queuesRow({ polling_interval_sec: 1 }) }),
      block({ ...PLAIN, minPollingIntervalMs: 5000 }),
    );

    expect(found.registered).not.toBe('matches');
  });

  it('reads the polling interval as whole milliseconds', async () => {
    const found = await read(
      ledger({ registered: queuesRow({ polling_interval_sec: 1.001 }) }),
      block({ ...PLAIN, minPollingIntervalMs: 1001 }),
    );

    expect(found.registered).toBe('matches');
  });

  /** `partition_queue` is the SDK's own reading of
   *  the partition limits beside it, so comparing it
   *  would be comparing one of them twice. */
  it('ignores the flag the SDK derives from the partition limits', async () => {
    const found = await read(
      ledger({
        registered: queuesRow({
          partition_queue: true,
          partition_concurrency: 2,
        }),
      }),
      block({ ...PLAIN, partitionConcurrency: 2 }),
    );

    expect(found.registered).toBe('matches');
  });

  /** And `onConflict` has no column in the table at
   *  all: it says what registering does about a
   *  queue already there, and is gone by the time
   *  the row is written. */
  it('ignores a registration behaviour the table does not store', async () => {
    const found = await read(
      ledger({ registered: queuesRow() }),
      block({ ...PLAIN, onConflict: 'never_update' }),
    );

    expect(found.registered).toBe('matches');
  });

  it('gives back what the app registered where a limit differs', async () => {
    const found = await read(
      ledger({ registered: queuesRow({ concurrency: 4 }) }),
      block({ ...PLAIN, globalConcurrency: 8 }),
    );

    expect(found.registered).toEqual({
      registered: {
        name: 'document-index',
        globalConcurrency: 4,
        minPollingIntervalMs: DEFAULT_POLLING_MS,
      },
    });
  });

  it('says nothing is registered where the table holds no row', async () => {
    const found = await read(ledger(), block(PLAIN));

    expect(found.registered).toBe('absent');
  });
});

/**
 * What each item in flight is called.
 *
 * The partition key first and the deduplication id
 * second, which is the reverse of the order the
 * words suggest: DBOS clears `deduplication_id` on
 * every terminal transition while the partition key
 * survives all of them, so a completed item that
 * once had a dedup id no longer has one.
 */
describe('the items a queue block started', () => {
  it('labels an item by its partition key whatever its status', async () => {
    const found = await read(
      ledger({
        items: [
          itemRow({
            status: 'SUCCESS',
            queue_partition_key: 'tenant_42',
            deduplication_id: 'doc_7',
          }),
        ],
      }),
      block(PLAIN),
    );

    expect(found.recent[0]?.label).toBe('tenant_42');
  });

  it('labels an item still in flight by its deduplication id', async () => {
    const found = await read(
      ledger({ items: [itemRow({ deduplication_id: 'doc_7' })] }),
      block(PLAIN),
    );

    expect(found.recent[0]?.label).toBe('doc_7');
  });

  /** Which is what a queue that deduplicates and
   *  does not partition shows for every item it has
   *  finished: DBOS cleared the only name it had. */
  it('labels a finished item by the end of its own id', async () => {
    const found = await read(
      ledger({
        items: [
          itemRow({
            status: 'SUCCESS',
            completed_at: '9000',
            deduplication_id: null,
          }),
        ],
      }),
      block(PLAIN),
    );

    expect(found.recent[0]).toEqual({
      workflowId: 'wf_1700000000000_a1b2c3d4',
      label: '…a1b2c3d4',
      status: 'SUCCESS',
      completedAt: 9000,
    });
  });

  it('reads what a failed item failed with', async () => {
    const found = await read(
      ledger({
        items: [
          itemRow({
            status: 'ERROR',
            error: JSON.stringify({ name: 'Error', message: 'no such page' }),
          }),
        ],
      }),
      block(PLAIN),
    );

    expect(found.recent[0]?.error).toBe('no such page');
  });
});

describe('the connection it opens', () => {
  it('closes it once the three statements have answered', async () => {
    const held = ledger();
    await read(held, block(PLAIN));

    expect(held.closed).toBe(1);
    expect(held.asked).toHaveLength(3);
  });

  /** The path a database that went away takes. A
   *  connection left open by a read that threw is a
   *  slot on somebody's development database that
   *  nothing will ever close. */
  it('closes it when a statement throws', async () => {
    const held = ledger({ fail: 'connection terminated' });

    await expect(read(held, block(PLAIN))).rejects.toThrow(
      'connection terminated',
    );
    expect(held.closed).toBe(1);
  });
});
