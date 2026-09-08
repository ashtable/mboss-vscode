import {
  queuedWorkflowName,
  type QueuePolicy,
  type WorkflowNode,
} from '../core/rules.js';

import type { OpenDatabase } from './db.js';
import {
  queueItemsQuery,
  queueRegisteredQuery,
  queueWindowQuery,
} from './queries.js';
import { errorIn, type BigIntColumn } from './rows.js';

/**
 * What one queue block is doing, read because
 * somebody selected it.
 *
 * The watch already spends a query per queue block
 * per tick on the five numbers a block's line and
 * its card are drawn from. This is the other half —
 * the whole queue rather than this run's share of
 * it, what the running app registered, and the
 * items themselves — and it is read once, when a
 * person opens the card, because none of it changes
 * fast enough to be worth a poll and all of it
 * costs three statements.
 *
 * Open, read, close, on one connection. A card is
 * opened occasionally and a connection held for as
 * long as a panel is showing would keep a slot on
 * somebody's development database all day.
 */

/** The document's queue block, which is the only
 *  kind there is anything here to read about. */
export type QueueBlock = Extract<WorkflowNode, { kind: 'queue' }>;

/**
 * The run the block belongs to: its id, and the
 * workflow it is a run of.
 *
 * The name is not decoration — a block's children
 * register under the block's id and the workflow's
 * name together, which is what the parent recorded
 * each start of them as. A `LiveRun` is one of
 * these.
 */
export type QueuedRun = { workflowId: string; workflow: string };

/** How long "recently" is for a queue that is not
 *  rate limited: long enough that a slow queue has
 *  started something, short enough to be about now
 *  rather than about this morning. */
export const DEFAULT_WINDOW_SEC = 60;

/**
 * What the SDK polls at where the document says
 * nothing.
 *
 * The column is never null, because the SDK writes
 * this number for a queue nobody gave one — so a
 * document that set no interval still has to be
 * read against it rather than against an absence.
 */
export const DEFAULT_POLLING_MS = 1000;

/** How many of a block's items the card lists. */
export const RECENT_ITEMS = 20;

export type QueueEvidence = {
  /** What the whole queue did over the window,
   *  across every workflow that enqueues onto it. */
  window: {
    queued: number;

    active: number;

    /** How many items started inside the window,
     *  which is the closest thing to a rate this
     *  card will say. */
    started: number;

    failedRecently: number;

    windowSec: number;
  };

  /**
   * Whether the running app registered this queue
   * the way the document asks for it.
   *
   * `absent` is a queue the app has not registered
   * at all — the usual reason being that the stack
   * is running code from before the block existed.
   * The third case carries what it did register, so
   * the card can say what is actually in force
   * rather than only that something is not.
   */
  registered: 'matches' | 'absent' | { registered: QueuePolicy };

  /** The most recent items the block started,
   *  newest first. */
  recent: QueueItem[];
};

export type QueueItem = {
  workflowId: string;

  /** What to call it: the partition it belongs to,
   *  the key it was deduplicated on, or the end of
   *  its own id. */
  label: string;

  /** DBOS's own word, passed through rather than
   *  translated. */
  status: string;

  completedAt?: number;

  error?: string;
};

export async function queueEvidenceOf(
  open: OpenDatabase,
  url: string,
  run: QueuedRun,
  node: QueueBlock,
): Promise<QueueEvidence> {
  const wanted = node.config.queue;
  const windowSec = wanted.rateLimit?.periodSec ?? DEFAULT_WINDOW_SEC;
  const since = Date.now() - windowSec * 1000;
  const queuedName = queuedWorkflowName(node.id, run.workflow);

  const database = await open(url);

  try {
    const window = queueWindowQuery(wanted.name, since);
    const counted = (
      await database.query<WindowRow>(window.text, window.values)
    )[0];

    const registered = queueRegisteredQuery(wanted.name);
    const row = (
      await database.query<QueuesRow>(registered.text, registered.values)
    )[0];

    const items = queueItemsQuery(run.workflowId, queuedName, RECENT_ITEMS);
    const started = await database.query<ItemRow>(items.text, items.values);

    return {
      window: {
        queued: Number(counted?.queued ?? 0),
        active: Number(counted?.active ?? 0),
        started: Number(counted?.started ?? 0),
        failedRecently: Number(counted?.failed_recently ?? 0),
        windowSec,
      },
      registered: registeredIn(row, wanted),
      recent: started.map(itemOf),
    };
  } finally {
    await database.close().catch(() => undefined);
  }
}

/** A row of the window statement, as selected. */
type WindowRow = {
  queued: BigIntColumn;
  active: BigIntColumn;
  started: BigIntColumn;
  failed_recently: BigIntColumn;
};

/** A row of `dbos.queues`, in the columns the read
 *  asks for. */
type QueuesRow = {
  name: string;
  concurrency: BigIntColumn | null;
  worker_concurrency: BigIntColumn | null;
  rate_limit_max: BigIntColumn | null;
  rate_limit_period_sec: BigIntColumn | null;
  partition_queue: boolean;
  partition_concurrency: BigIntColumn | null;
  partition_worker_concurrency: BigIntColumn | null;
  partition_rate_limit_max: BigIntColumn | null;
  partition_rate_limit_period_sec: BigIntColumn | null;
  polling_interval_sec: BigIntColumn;
};

/** One child of the block, from the two joined
 *  tables. */
type ItemRow = {
  workflow_uuid: string;
  status: string;
  completed_at: BigIntColumn | null;
  error: string | null;
  deduplication_id: string | null;
  queue_partition_key: string | null;
};

function registeredIn(
  row: QueuesRow | undefined,
  wanted: QueuePolicy,
): QueueEvidence['registered'] {
  if (row === undefined) return 'absent';

  const registered = policyIn(row);

  return sameLimits(registered, wanted) ? 'matches' : { registered };
}

/**
 * Whether the app registered the limits the
 * document asks for.
 *
 * Field by field over what the table stores and the
 * document owns, never a comparison of the two
 * objects. Two of the document's fields are left
 * out of it on purpose:
 *
 * `partition_queue` is the SDK's own reading of the
 * partition limits beside it, so comparing it would
 * be comparing one of those twice — and would call
 * a partitioned queue different from itself.
 *
 * `onConflict` says what registering does about a
 * queue already in the table, and has no column
 * there at all: it is gone by the time the row is
 * written, so there is nothing to read it back
 * from.
 *
 * The polling interval is compared through the
 * default, because the SDK writes that number for a
 * queue nobody gave one — a comparison against an
 * absent field would call every ordinary document
 * different from the app running it.
 */
function sameLimits(registered: QueuePolicy, wanted: QueuePolicy): boolean {
  return (
    registered.globalConcurrency === wanted.globalConcurrency &&
    registered.workerConcurrency === wanted.workerConcurrency &&
    sameLimit(registered.rateLimit, wanted.rateLimit) &&
    registered.partitionConcurrency === wanted.partitionConcurrency &&
    registered.partitionWorkerConcurrency ===
      wanted.partitionWorkerConcurrency &&
    sameLimit(registered.partitionRateLimit, wanted.partitionRateLimit) &&
    registered.minPollingIntervalMs ===
      (wanted.minPollingIntervalMs ?? DEFAULT_POLLING_MS)
  );
}

function sameLimit(
  registered: QueuePolicy['rateLimit'],
  wanted: QueuePolicy['rateLimit'],
): boolean {
  return (
    registered?.limitPerPeriod === wanted?.limitPerPeriod &&
    registered?.periodSec === wanted?.periodSec
  );
}

/**
 * The queue as the table holds it, in the
 * document's own vocabulary.
 *
 * A null column is a limit nobody set. The polling
 * interval is the exception and is always there:
 * the SDK writes it for every queue, so it is read
 * back as a number rather than as an absence.
 */
function policyIn(row: QueuesRow): QueuePolicy {
  return {
    name: row.name,
    ...(row.concurrency === null
      ? {}
      : { globalConcurrency: Number(row.concurrency) }),
    ...(row.worker_concurrency === null
      ? {}
      : { workerConcurrency: Number(row.worker_concurrency) }),
    ...pairIn('rateLimit', row.rate_limit_max, row.rate_limit_period_sec),
    ...(row.partition_concurrency === null
      ? {}
      : { partitionConcurrency: Number(row.partition_concurrency) }),
    ...(row.partition_worker_concurrency === null
      ? {}
      : {
          partitionWorkerConcurrency: Number(row.partition_worker_concurrency),
        }),
    ...pairIn(
      'partitionRateLimit',
      row.partition_rate_limit_max,
      row.partition_rate_limit_period_sec,
    ),
    // The column is a double; the document stores
    // this policy in whole milliseconds.
    minPollingIntervalMs: Math.round(Number(row.polling_interval_sec) * 1000),
  };
}

/** Both halves or neither: a rate limit is a count
 *  over a period, and half of one is not a limit. */
function pairIn(
  name: 'rateLimit' | 'partitionRateLimit',
  max: BigIntColumn | null,
  periodSec: BigIntColumn | null,
): Pick<QueuePolicy, 'rateLimit' | 'partitionRateLimit'> {
  return max === null || periodSec === null
    ? {}
    : {
        [name]: {
          limitPerPeriod: Number(max),
          periodSec: Number(periodSec),
        },
      };
}

function itemOf(row: ItemRow): QueueItem {
  const completedAt = row.completed_at;
  const failure = errorIn(row.error);

  return {
    workflowId: row.workflow_uuid,
    label: labelOf(row),
    status: row.status,
    ...(completedAt === null ? {} : { completedAt: Number(completedAt) }),
    ...(failure === undefined ? {} : { error: failure.message }),
  };
}

/**
 * What to call one item.
 *
 * The partition key first, then the deduplication
 * id, then the end of the item's own id — which is
 * the reverse of the order those two read in. DBOS
 * clears `deduplication_id` on every terminal
 * transition while `queue_partition_key` survives
 * all of them, so only an item still in flight ever
 * carries a dedup id. On a queue that deduplicates
 * and does not partition, every finished item is
 * therefore labelled by its id and there is nothing
 * else left to label it by.
 */
function labelOf(row: ItemRow): string {
  return (
    row.queue_partition_key ??
    row.deduplication_id ??
    shortId(row.workflow_uuid)
  );
}

/**
 * How much of a child's id is worth showing.
 *
 * Its end rather than its head, the way the canvas'
 * run chip shows one: the ids DBOS mints open with
 * a timestamp, so two items enqueued together share
 * their first fifteen characters.
 */
const ID_SHOWN = 8;

function shortId(workflowId: string): string {
  return workflowId.length <= ID_SHOWN
    ? workflowId
    : `…${workflowId.slice(-ID_SHOWN)}`;
}
