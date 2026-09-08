/**
 * Everything this view asks a project's database.
 *
 * Raw parameterized `SELECT`s rather than DBOS's
 * own client, for the reason the vendored server
 * already wrote down: this extension is installed
 * once and pointed at whatever DBOS version a
 * project happens to pin, and a client that wants
 * to create its own schema is the wrong thing to
 * aim at a database you are only allowed to read.
 * The one write this view makes — a replay — does
 * go through the client, because hand-rolling that
 * is the risky half.
 *
 * The price is that the column names below are
 * knowledge kept by hand, and it is paid for by
 * the opt-in suite that runs these statements
 * against a schema DBOS itself created.
 */

import { SDK_OPERATIONS } from '../core/rules.js';

import { FIRST_DISPATCH } from './rows.js';

/** A statement and the values it is given. */
export type Query = { text: string; values: unknown[] };

/** Which runs the list is showing. */
export type RunFilter = (typeof RUN_FILTERS)[number];

export const RUN_FILTERS = ['all', 'failed', 'recovered'] as const;

/**
 * The most runs the list will hold.
 *
 * A development database accumulates runs nobody
 * will scroll to, and somebody opening this panel
 * means the run that just happened.
 */
export const MAX_RUNS = 50;

/**
 * What counts as failed.
 *
 * DBOS's own answer: `workflow_status` carries a
 * partial index for failed runs declared over
 * exactly these three statuses. Taking the same
 * set means the filter asks the question the
 * database was built to answer, and means nobody
 * has to arbitrate whether a cancelled run is a
 * failure — DBOS already did.
 *
 * `MAX_RECOVERY_ATTEMPTS_EXCEEDED` is one of them
 * rather than a fourth filter of its own: it is a
 * failure, and the row shows the status word, so a
 * run that gave up after recovering too often is
 * still one glance from being told apart.
 */
export const FAILED_STATUSES = [
  'ERROR',
  'CANCELLED',
  'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
] as const;

/**
 * What counts as still on the queue.
 *
 * A delayed child has not been claimed by
 * anything either — it is waiting out a delay
 * rather than waiting for a worker — so the
 * second number on a queue block counts both.
 * `delayed` counts it once more on its own,
 * because a block whose items are all sitting out
 * a delay is a different thing from one whose
 * items are all waiting for room.
 */
export const QUEUED_STATUSES = ['ENQUEUED', 'DELAYED'] as const;

/**
 * What every read of a run selects.
 *
 * An array rather than a joined string, because the
 * one-run read appends a column the list must not
 * ask for.
 */
export const RUN_COLUMNS: readonly string[] = [
  'workflow_uuid',
  'name',
  'status',
  'recovery_attempts',
  'executor_id',
  'application_version',
  'created_at',
  'started_at_epoch_ms',
  'completed_at',
  'error',
  'serialization',
  'forked_from',
  'was_forked_from',
];

/**
 * Every operation name DBOS writes for itself,
 * split the two ways it has to be matched.
 *
 * Almost all of them carry the `DBOS.` prefix and
 * go by a pattern, so a primitive a later SDK adds
 * is already excluded. `getStatus` is the odd one
 * out — recorded without the prefix, and read
 * syntactically a plausible block name — so it is
 * named. Taken from the compiler's own set rather
 * than written here, which is what makes a new
 * un-prefixed name a failing test rather than a row
 * quietly attributed to a block.
 */
const SDK_PREFIX_PATTERN = 'DBOS.%';

const SDK_UNPREFIXED = [...SDK_OPERATIONS].filter(
  (name) => !name.startsWith('DBOS.'),
);

/**
 * What one item of a queue block is drawn from.
 *
 * Qualified, because this is the only read that
 * joins two tables of DBOS's own and both of them
 * carry an `error` and a `serialization`.
 */
const QUEUE_ITEM_COLUMNS = [
  's.workflow_uuid',
  's.status',
  's.created_at',
  's.started_at_epoch_ms',
  's.completed_at',
  's.error',
  's.serialization',
  's.recovery_attempts',
  's.deduplication_id',
  's.queue_partition_key',
].join(', ');

const STEP_COLUMNS = [
  'function_id',
  'function_name',
  'started_at_epoch_ms',
  'completed_at_epoch_ms',
  'output',
  'error',
  'child_workflow_id',
  'serialization',
].join(', ');

/**
 * The fence that keeps the list to the runs
 * somebody started.
 *
 * A queue block's children are runs of their own
 * in the same table, so a run of fifty items would
 * otherwise be fifty rows above the run that
 * started them, and the counts over the segmented
 * control would say the same. A child is reached
 * from the block that started it, and the reads
 * that open one run by id do not carry this.
 */
const TOP_LEVEL = 'parent_workflow_id IS NULL';

/**
 * The runs one filter shows, newest first.
 *
 * Filtered in the database rather than in the
 * panel, so that FAILED shows the last few
 * failures rather than the failures among the last
 * few runs — which on a project that mostly works
 * is an empty list beside a count that says
 * otherwise.
 */
export function runsQuery(filter: RunFilter, limit: number): Query {
  // The two exclusion binds are $1 and $2 because
  // they are in the SELECT list, which comes before
  // the WHERE clause — so the filter and the limit
  // shift along behind them.
  const where = whereFor(filter, 3);
  const limitAt = 3 + where.values.length;

  return {
    text:
      `SELECT ${RUN_COLUMNS.join(', ')}, ` +
      `${ownOperation('function_name')} AS last_operation, ` +
      `${ownOperation('completed_at_epoch_ms')} AS last_operation_at, ` +
      `${ownOperationCount()} AS operation_count ` +
      'FROM dbos.workflow_status s ' +
      `${where.text}ORDER BY created_at DESC LIMIT $${limitAt}`,
    values: [SDK_PREFIX_PATTERN, SDK_UNPREFIXED, ...where.values, limit],
  };
}

/**
 * One column of the last row this run recorded of
 * its own.
 *
 * A correlated scalar rather than a join: a join
 * would multiply each run out by its operations and
 * the list would have to fold it back up. Ordered
 * by `function_id` and never by time, for the same
 * reason the step read is — a restored row keeps
 * the timestamps it was first written with.
 */
function ownOperation(column: string): string {
  return (
    `(SELECT o.${column} FROM dbos.operation_outputs o ` +
    `WHERE ${OWN_ROWS} ORDER BY o.function_id DESC LIMIT 1)`
  );
}

function ownOperationCount(): string {
  return `(SELECT count(*) FROM dbos.operation_outputs o WHERE ${OWN_ROWS})`;
}

/** This run's rows, minus everything DBOS records
 *  for itself. */
const OWN_ROWS =
  'o.workflow_uuid = s.workflow_uuid ' +
  'AND o.function_name NOT LIKE $1 ' +
  'AND o.function_name <> ALL($2)';

/**
 * All three numbers over the segmented control, in
 * one statement.
 *
 * Together rather than one call per filter: they
 * sit side by side on screen, and three round
 * trips could show a set of numbers that was never
 * true at any one moment.
 */
export function countsQuery(): Query {
  return {
    text:
      'SELECT count(*) AS all_runs, ' +
      'count(*) FILTER (WHERE status = ANY($1)) AS failed_runs, ' +
      'count(*) FILTER (WHERE recovery_attempts > $2) AS recovered_runs ' +
      `FROM dbos.workflow_status WHERE ${TOP_LEVEL}`,
    values: [FAILED_STATUSES, FIRST_DISPATCH],
  };
}

/**
 * One run, by the id on its row.
 *
 * The only read that asks for `inputs`. On the list
 * it would be fifty runs' whole argument arrays for
 * a column no row draws.
 */
export function runQuery(workflowId: string): Query {
  return {
    text:
      `SELECT ${[...RUN_COLUMNS, 'inputs'].join(', ')} ` +
      'FROM dbos.workflow_status WHERE workflow_uuid = $1',
    values: [workflowId],
  };
}

/**
 * The newest run of one workflow started since a
 * moment.
 *
 * The fallback for an app whose ingress does not
 * echo the id it started. An event run's id is the
 * app's to mint, so where it is not said out loud
 * the ledger is the only place to learn it — and
 * the bound is the moment the request went, which
 * is what keeps last week's run of the same
 * workflow from answering for this one.
 */
export function latestRunQuery(workflow: string, since: number): Query {
  return {
    text:
      'SELECT workflow_uuid FROM dbos.workflow_status ' +
      `WHERE name = $1 AND created_at >= $2 AND ${TOP_LEVEL} ` +
      'ORDER BY created_at DESC LIMIT 1',
    values: [workflow, since],
  };
}

/**
 * The runs somebody replayed from this one, and how
 * much of each one it did not have to run again.
 *
 * `last_reused` is the highest row a fork carried
 * over. A fork copies every operation the run it
 * came from had already finished, timestamps and
 * all, so the rows completed before the fork was
 * created are exactly the copied ones — and the
 * step above the last of them is where the replay
 * actually began.
 *
 * A correlated scalar rather than a read per fork,
 * for the reason the list's summary columns are
 * one: a run somebody replayed a dozen times would
 * otherwise be a dozen round trips for one small
 * tree.
 */
export function forksQuery(workflowId: string): Query {
  return {
    text:
      `SELECT ${RUN_COLUMNS.join(', ')}, ` +
      '(SELECT max(o.function_id) FROM dbos.operation_outputs o ' +
      'WHERE o.workflow_uuid = f.workflow_uuid ' +
      'AND o.completed_at_epoch_ms < f.created_at) AS last_reused ' +
      'FROM dbos.workflow_status f ' +
      'WHERE f.forked_from = $1 ORDER BY f.created_at',
    values: [workflowId],
  };
}

/**
 * One run's steps, in the order DBOS numbered
 * them, which is the order they ran in.
 *
 * Never ordered by time: a step restored from the
 * ledger keeps the timestamps it was first written
 * with, so sorting on them would interleave a
 * recovered run's steps with each other.
 */
export function stepsQuery(workflowId: string): Query {
  return {
    text:
      `SELECT ${STEP_COLUMNS} FROM dbos.operation_outputs ` +
      'WHERE workflow_uuid = $1 ORDER BY function_id',
    values: [workflowId],
  };
}

/**
 * The children one queue block started, found
 * through the starts the parent recorded.
 *
 * Never through the child's own
 * `parent_workflow_id`: where a colliding item
 * returns the run that already exists, that child
 * was started by an earlier run and its parent
 * column names that one — so a read by parent
 * would miss exactly the items deduplication is
 * for.
 *
 * `$2` is the name the block's children are
 * registered under, which is what the parent
 * recorded its start of each of them as.
 */
const BLOCK_CHILDREN =
  'FROM dbos.operation_outputs o ' +
  'JOIN dbos.workflow_status s ' +
  'ON s.workflow_uuid = o.child_workflow_id ' +
  'WHERE o.workflow_uuid = $1 AND o.function_name = $2';

/**
 * The most recent items one queue block started.
 *
 * Ordered by the number the parent gave the start
 * and never by time, for the reason the step read
 * is: a row restored from the ledger keeps the
 * timestamps it was first written with.
 */
export function queueItemsQuery(
  parentId: string,
  queuedName: string,
  limit: number,
): Query {
  return {
    text:
      `SELECT ${QUEUE_ITEM_COLUMNS} ${BLOCK_CHILDREN} ` +
      'ORDER BY o.function_id DESC LIMIT $3',
    values: [parentId, queuedName, limit],
  };
}

/** What one queue block is doing, in the five
 *  numbers its line and its card are drawn from. */
export function queueCountsQuery(parentId: string, queuedName: string): Query {
  return {
    text:
      'SELECT count(*) FILTER (WHERE s.status = ANY($3)) AS queued, ' +
      "count(*) FILTER (WHERE s.status = 'DELAYED') AS delayed, " +
      "count(*) FILTER (WHERE s.status = 'PENDING') AS active, " +
      "count(*) FILTER (WHERE s.status = 'SUCCESS') AS done, " +
      'count(*) FILTER (WHERE s.status = ANY($4)) AS failed ' +
      BLOCK_CHILDREN,
    values: [parentId, queuedName, QUEUED_STATUSES, FAILED_STATUSES],
  };
}

/**
 * What a whole queue is doing, across every
 * workflow that enqueues onto it.
 *
 * The failed set bound here is `ERROR` alone,
 * where the block's own counts bind all three.
 * DBOS clears `queue_name` and
 * `started_at_epoch_ms` together on exactly the
 * two failures that are not `ERROR` — a cancel and
 * a dead-letter each do both — while a success or
 * an error leaves both alone. So this window is
 * over the children still on the queue: it counts
 * the errored ones and no others, and its
 * `started` count loses a child later cancelled or
 * dead-lettered. Binding the whole failed set here
 * would promise a coverage the column cannot give.
 * The block's own counts are immune, because they
 * find their children through the parent's
 * child-start rows rather than through
 * `queue_name`.
 */
export function queueWindowQuery(
  queueName: string,
  sinceEpochMs: number,
): Query {
  return {
    text:
      'SELECT count(*) FILTER (WHERE status = ANY($2)) AS queued, ' +
      "count(*) FILTER (WHERE status = 'PENDING') AS active, " +
      'count(*) FILTER (WHERE started_at_epoch_ms >= $3) AS started, ' +
      'count(*) FILTER (WHERE status = ANY($4) AND completed_at >= $3) ' +
      'AS failed_recently ' +
      'FROM dbos.workflow_status WHERE queue_name = $1',
    values: [queueName, QUEUED_STATUSES, sinceEpochMs, ['ERROR']],
  };
}

/**
 * One queue as the app actually registered it.
 *
 * The document says what the limits were meant to
 * be; this says what the running app registered,
 * which is the only place the two can be told
 * apart.
 */
export function queueRegisteredQuery(queueName: string): Query {
  return {
    text:
      'SELECT name, concurrency, worker_concurrency, rate_limit_max, ' +
      'rate_limit_period_sec, partition_queue, partition_concurrency, ' +
      'partition_worker_concurrency, partition_rate_limit_max, ' +
      'partition_rate_limit_period_sec, polling_interval_sec ' +
      'FROM dbos.queues WHERE name = $1',
    values: [queueName],
  };
}

/** The clause one filter adds, what it binds, and
 *  the placeholder it starts numbering from. */
function whereFor(
  filter: RunFilter,
  from: number,
): { text: string; values: unknown[] } {
  if (filter === 'failed') {
    return {
      text: `WHERE status = ANY($${from}) AND ${TOP_LEVEL} `,
      values: [FAILED_STATUSES],
    };
  }

  // Greater than the first dispatch, not greater
  // than zero: the column counts dispatches, so
  // every run in the database has at least one.
  if (filter === 'recovered') {
    return {
      text: `WHERE recovery_attempts > $${from} AND ${TOP_LEVEL} `,
      values: [FIRST_DISPATCH],
    };
  }

  return { text: `WHERE ${TOP_LEVEL} `, values: [] };
}

/**
 * Every statement this module composes.
 *
 * Written out by hand and exported, so the rules
 * that hold of all of them — read-only, DBOS's own
 * schema, every value bound, placeholders matching
 * values — are checked over a list a new statement
 * has to be added to rather than over whatever a
 * spec happened to remember.
 */
export const ALL_QUERIES: readonly Query[] = [
  ...RUN_FILTERS.map((filter) => runsQuery(filter, MAX_RUNS)),
  countsQuery(),
  runQuery('wf_c9d2f3'),
  forksQuery('wf_c9d2f3'),
  stepsQuery('wf_c9d2f3'),
  latestRunQuery('groom_booking', 0),
  queueItemsQuery('wf_c9d2f3', 'index_pages.queued.ingest', 20),
  queueCountsQuery('wf_c9d2f3', 'index_pages.queued.ingest'),
  queueWindowQuery('document-index', 0),
  queueRegisteredQuery('document-index'),
];
