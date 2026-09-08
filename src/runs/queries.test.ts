import { describe, expect, it } from 'vitest';

import { SDK_OPERATIONS, queuedWorkflowName } from '../core/rules.js';

import {
  ALL_QUERIES,
  FAILED_STATUSES,
  MAX_RUNS,
  QUEUED_STATUSES,
  RUN_COLUMNS,
  RUN_FILTERS,
  countsQuery,
  forksQuery,
  latestRunQuery,
  queueCountsQuery,
  queueItemsQuery,
  queueRegisteredQuery,
  queueWindowQuery,
  runQuery,
  runsQuery,
  stepsQuery,
} from './queries.js';
import { FIRST_DISPATCH } from './rows.js';

/**
 * The statements, checked as text.
 *
 * They run against somebody else's database —
 * written by whichever DBOS version their app
 * pins — and this extension only ever reads it. So
 * two things have to hold of every one of them:
 * the values travel as parameters, and nothing but
 * a `SELECT` is ever composed.
 */

/** Epoch milliseconds, which is what
 *  `created_at` holds. */
const SOME_MOMENT = 1_767_268_800_000;

/** A run holding a queue block, and the name that
 *  block's children are registered under. */
const PARENT = 'wf_c9d2f3';

const QUEUED = queuedWorkflowName('index_pages', 'document_ingestion_queued');

describe('every statement', () => {
  it('only ever reads', () => {
    for (const query of ALL_QUERIES) {
      expect(query.text.trimStart().startsWith('SELECT')).toBe(true);
      expect(query.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP)\b/i);
    }
  });

  /**
   * The schema name is the one place a literal is
   * written into the text, and it is a constant —
   * nothing in this product line configures DBOS
   * away from its default.
   */
  it('reads DBOS own schema and nothing else', () => {
    for (const query of ALL_QUERIES) {
      expect(query.text).toMatch(
        /\bdbos\.(workflow_status|operation_outputs|queues)/,
      );
    }
  });

  /**
   * A run id comes from a row somebody clicked, and
   * a row came from a database this extension does
   * not own. Interpolating one would be an
   * injection with a very short path to it.
   */
  it('sends every value as a parameter', () => {
    const hostile = "wf'; DROP TABLE dbos.workflow_status; --";

    for (const query of [
      runQuery(hostile),
      stepsQuery(hostile),
      latestRunQuery(hostile, SOME_MOMENT),
    ]) {
      expect(query.text).not.toContain(hostile);
      expect(query.values).toContain(hostile);
    }
  });

  it('numbers its placeholders to match its values', () => {
    for (const query of ALL_QUERIES) {
      const used = new Set(
        [...query.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
      );

      expect([...used].sort()).toEqual(
        query.values.map((_value, index) => index + 1),
      );
    }
  });
});

describe('the run list', () => {
  it('offers the three the design names', () => {
    expect(RUN_FILTERS).toEqual(['all', 'failed', 'recovered']);
  });

  /**
   * Newest first and capped: somebody opening this
   * means the run that just happened, and a
   * development database accumulates runs nobody
   * will ever scroll to.
   */
  it('takes the most recent few, newest first', () => {
    const query = runsQuery('all', MAX_RUNS);

    expect(query.text).toContain('ORDER BY created_at DESC');
    expect(query.text).toContain(`LIMIT $${query.values.length}`);
    expect(query.values.at(-1)).toBe(MAX_RUNS);
  });

  /**
   * The set is DBOS's own: its `workflow_status`
   * index for failed runs is declared over exactly
   * these three statuses, so the filter agrees
   * with what the database was built to answer.
   */
  it('calls the three statuses DBOS calls failed failed', () => {
    expect(FAILED_STATUSES).toEqual([
      'ERROR',
      'CANCELLED',
      'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    ]);

    const query = runsQuery('failed', MAX_RUNS);

    // Third and fourth, not first and second: the
    // exclusion the summary columns bind sits in
    // the SELECT list, ahead of the WHERE clause.
    expect(query.text).toContain('WHERE status = ANY($3)');
    expect(query.values.slice(2)).toEqual([FAILED_STATUSES, MAX_RUNS]);
  });

  /**
   * A count, not a status: a run that recovered and
   * then succeeded is both recovered and a success,
   * and this filter is about the crash rather than
   * about the outcome.
   *
   * And greater than the *first dispatch*, never
   * greater than zero. The column counts dispatches,
   * so `> 0` selects every run in the database — a
   * mistake that looks right until there is more
   * than one row to look at.
   */
  it('discounts the dispatch every run already has', () => {
    const query = runsQuery('recovered', MAX_RUNS);

    expect(query.text).toContain('WHERE recovery_attempts > $3');
    expect(query.values.slice(2)).toEqual([FIRST_DISPATCH, MAX_RUNS]);
    expect(FIRST_DISPATCH).toBe(1);
  });

  it('selects the columns a row and its rail are drawn from', () => {
    for (const column of [
      'workflow_uuid',
      'name',
      'status',
      'recovery_attempts',
      'executor_id',
      'application_version',
      'created_at',
      'completed_at',
      'error',
      'serialization',
    ]) {
      expect(runsQuery('all', MAX_RUNS).text).toContain(column);
    }
  });
});

describe('the run an app started without saying so', () => {
  /**
   * Newest first and bounded by the moment the
   * request went, so a run of the same workflow
   * from last week is never mistaken for the one
   * that was just asked for.
   */
  it('takes the newest run of one workflow since a moment', () => {
    const query = latestRunQuery('counter', SOME_MOMENT);

    expect(query.text).toContain('WHERE name = $1 AND created_at >= $2');
    expect(query.text).toContain('ORDER BY created_at DESC LIMIT 1');
    expect(query.values).toEqual(['counter', SOME_MOMENT]);
  });
});

describe('the filter counts', () => {
  /**
   * One statement rather than three, because the
   * three numbers sit side by side on screen and
   * three round trips could show a set that never
   * existed at any one moment.
   */
  it('counts all three ways at once', () => {
    const query = countsQuery();

    expect(query.text.match(/count\(\*\)/g)).toHaveLength(3);
    expect(query.values).toEqual([FAILED_STATUSES, FIRST_DISPATCH]);
  });
});

describe('one run', () => {
  it('is found by its id', () => {
    expect(runQuery('wf_c9d2f3').values).toEqual(['wf_c9d2f3']);
  });

  /**
   * `function_id` is the order DBOS numbered the
   * steps in, which is the order they ran in — and
   * the only ordering the timeline can be drawn
   * from, since a restored step's timestamps are
   * the ones it was first written with.
   */
  it('reads its steps in the order they ran', () => {
    const query = stepsQuery('wf_c9d2f3');

    expect(query.text).toContain('ORDER BY function_id');
    expect(query.values).toEqual(['wf_c9d2f3']);
  });

  it('selects the columns the raw panel shows', () => {
    for (const column of [
      'function_id',
      'function_name',
      'started_at_epoch_ms',
      'completed_at_epoch_ms',
      'output',
      'error',
      'child_workflow_id',
      'serialization',
    ]) {
      expect(stepsQuery('wf_c9d2f3').text).toContain(column);
    }
  });
});

describe('the run list', () => {
  /**
   * A row says what the run last did of its own,
   * and that is a column of the other table. Asked
   * for as a correlated scalar rather than as a
   * join, because a join would multiply the run out
   * by its operations and the list would then have
   * to fold it back up.
   */
  it('names the last operation a run recorded of its own', () => {
    const text = runsQuery('all', MAX_RUNS).text;

    expect(text).toContain('last_operation');
    expect(text).toContain('last_operation_at');
    expect(text).toContain('operation_count');
    expect(text).toContain('dbos.operation_outputs');
  });

  /**
   * `of its own` is the whole point: every row DBOS
   * writes for itself is left out, so the summary
   * names a block rather than a primitive. The
   * prefixed ones go by a `LIKE`; the un-prefixed
   * ones are named, and this holds that list equal
   * to the compiler's own set rather than to a
   * literal written twice.
   */
  it('leaves out the bookkeeping DBOS records for itself', () => {
    const query = runsQuery('all', MAX_RUNS);
    const unprefixed = [...SDK_OPERATIONS].filter(
      (name) => !name.startsWith('DBOS.'),
    );

    expect(query.text).toContain('function_name NOT LIKE');
    expect(query.text).toContain('function_name <> ALL(');
    expect(query.values).toContain('DBOS.%');
    expect(query.values).toContainEqual(unprefixed);
    expect(unprefixed).toEqual(['getStatus']);
  });
});

describe('one run', () => {
  /**
   * The whole argument array a run was started
   * with, and only where one run is being read: on
   * the list it would be fifty of them for a column
   * no row draws.
   */
  it('reads the input only where a single run is being read', () => {
    expect(runQuery('wf_c9d2f3').text).toContain('inputs');
    expect(runsQuery('all', MAX_RUNS).text).not.toContain('inputs');
  });

  it('reads the columns that say where a run came from', () => {
    for (const column of ['forked_from', 'was_forked_from']) {
      expect(RUN_COLUMNS).toContain(column);
    }
  });
});

describe('the runs replayed from one run', () => {
  /**
   * Listed among the statements, so the rules that
   * hold of all of them — read-only, DBOS's own
   * schema, every value bound — are asked of this
   * one too.
   *
   * How much of the run a fork kept is a correlated
   * scalar over the other table rather than a second
   * read per fork: a run somebody replayed a dozen
   * times would otherwise be a dozen round trips for
   * one small tree.
   */
  it('lists forksQuery among the queries', () => {
    const query = forksQuery('wf_c9d2f3');

    expect(ALL_QUERIES.map((one) => one.text)).toContain(query.text);
    expect(query.values).toEqual(['wf_c9d2f3']);
    expect(query.text).toContain('dbos.workflow_status');
    expect(query.text).toContain('dbos.operation_outputs');
    expect(query.text).toContain('AS last_reused');
    expect(query.text).toContain('WHERE f.forked_from = $1');
  });
});

describe('the children one queue block started', () => {
  /**
   * Found through the starts the parent recorded
   * rather than through the child's own
   * `parent_workflow_id`. Where a colliding item
   * returns the run that already exists, the child
   * was started by an earlier run and its parent
   * column names that one — so a read by parent
   * would miss exactly the items deduplication is
   * for.
   */
  it('joins the child rows to the starts the parent recorded', () => {
    const query = queueItemsQuery(PARENT, QUEUED, 20);

    expect(query.text).toContain(
      'FROM dbos.operation_outputs o ' +
        'JOIN dbos.workflow_status s ' +
        'ON s.workflow_uuid = o.child_workflow_id',
    );
    expect(query.text).toContain(
      'WHERE o.workflow_uuid = $1 AND o.function_name = $2',
    );
    expect(query.text).not.toContain('parent_workflow_id');
    expect(query.values).toEqual([PARENT, QUEUED, 20]);
  });

  /**
   * Newest first, by the number the parent gave the
   * start and never by time: a restored row keeps
   * the timestamps it was first written with, which
   * is the same reason the step read is ordered
   * this way.
   */
  it('takes the newest items first, up to the limit asked for', () => {
    expect(queueItemsQuery(PARENT, QUEUED, 20).text).toContain(
      'ORDER BY o.function_id DESC LIMIT $3',
    );
  });

  it('selects the columns one item is drawn from', () => {
    for (const column of [
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
    ]) {
      expect(queueItemsQuery(PARENT, QUEUED, 20).text).toContain(column);
    }
  });
});

describe('what one queue block is doing', () => {
  it('counts the five states its children are in', () => {
    const query = queueCountsQuery(PARENT, QUEUED);

    expect(query.text.match(/count\(\*\)/g)).toHaveLength(5);

    for (const label of [
      'AS queued',
      'AS delayed',
      'AS active',
      'AS done',
      'AS failed',
    ]) {
      expect(query.text).toContain(label);
    }
  });

  /**
   * A delayed child is queued — nothing has claimed
   * it — and `delayed` counts it once more on its
   * own, because a block whose items are all
   * waiting out a delay is a different thing from
   * one whose items are waiting for a worker.
   */
  it('counts a delayed child as queued, and again on its own', () => {
    const query = queueCountsQuery(PARENT, QUEUED);

    expect(query.text).toContain(
      'count(*) FILTER (WHERE s.status = ANY($3)) AS queued',
    );
    expect(query.text).toContain(
      "count(*) FILTER (WHERE s.status = 'DELAYED') AS delayed",
    );
    expect(query.values[2]).toEqual(QUEUED_STATUSES);
    expect(QUEUED_STATUSES).toEqual(['ENQUEUED', 'DELAYED']);
  });

  /**
   * The name is the block's and the workflow's
   * together, which is what the emitter registers
   * the children under — so a second workflow with
   * a queue block of the same id is a different
   * name and a different count.
   */
  it('asks under the name a block children register with', () => {
    const query = queueCountsQuery(PARENT, QUEUED);

    expect(query.text).toContain('AND o.function_name = $2');
    expect(query.values[1]).toBe(QUEUED);
    expect(QUEUED).toBe('index_pages.queued.document_ingestion_queued');
  });
});

describe('what a whole queue is doing', () => {
  it('counts over the children still on the named queue', () => {
    const query = queueWindowQuery('document-index', SOME_MOMENT);

    expect(query.text).toContain('FROM dbos.workflow_status');
    expect(query.text).toContain('WHERE queue_name = $1');
    expect(query.text).toContain(
      'count(*) FILTER (WHERE started_at_epoch_ms >= $3) AS started',
    );
    expect(query.text).toContain(
      'count(*) FILTER (WHERE status = ANY($4) AND completed_at >= $3) ' +
        'AS failed_recently',
    );
    expect(query.values).toEqual([
      'document-index',
      QUEUED_STATUSES,
      SOME_MOMENT,
      ['ERROR'],
    ]);
  });

  /**
   * The two updates that clear `queue_name` are why
   * the two statements bind different failed sets.
   *
   * DBOS clears `queue_name` and
   * `started_at_epoch_ms` together on exactly the
   * two failures that are not `ERROR` — a cancel
   * and a dead-letter each do both — while a
   * success or an error leaves both alone. So this
   * window is over the children still on the queue:
   * it can count the errored ones and no others,
   * and binding the whole failed set here would
   * promise a coverage the column cannot give. The
   * block's own counts are immune, because they
   * find children through the parent's child-start
   * rows rather than through `queue_name`.
   */
  it('counts only errors where the clearing updates reach', () => {
    expect(queueWindowQuery('document-index', SOME_MOMENT).values[3]).toEqual([
      'ERROR',
    ]);
    expect(queueCountsQuery(PARENT, QUEUED).values[3]).toEqual(FAILED_STATUSES);
  });
});

describe('the queue as the app registered it', () => {
  it('reads one registration by name', () => {
    const query = queueRegisteredQuery('document-index');

    expect(query.text).toContain('FROM dbos.queues WHERE name = $1');
    expect(query.values).toEqual(['document-index']);
  });

  it('selects every limit a registration can carry', () => {
    for (const column of [
      'name',
      'concurrency',
      'worker_concurrency',
      'rate_limit_max',
      'rate_limit_period_sec',
      'partition_queue',
      'partition_concurrency',
      'partition_worker_concurrency',
      'partition_rate_limit_max',
      'partition_rate_limit_period_sec',
      'polling_interval_sec',
    ]) {
      expect(queueRegisteredQuery('document-index').text).toContain(column);
    }
  });
});

describe('the fence around the top-level runs', () => {
  /**
   * A queue block's children are runs of their own
   * in the same table, so a run of fifty items
   * would otherwise be fifty rows above the run
   * that started them. The list is the runs
   * somebody started; a child is reached from the
   * block that started it.
   */
  it('keeps a queued child off the list', () => {
    for (const query of [
      ...RUN_FILTERS.map((filter) => runsQuery(filter, MAX_RUNS)),
      countsQuery(),
      latestRunQuery('groom_booking', SOME_MOMENT),
    ]) {
      expect(query.text).toContain('parent_workflow_id IS NULL');
    }
  });

  /**
   * And never where one run is being opened by its
   * id: somebody following a child from the block
   * that started it is opening a run whose parent
   * column is set, and a fence there would answer
   * with nothing.
   */
  it('does not fence the reads that open one run', () => {
    for (const query of [
      runQuery('wf_c9d2f3'),
      stepsQuery('wf_c9d2f3'),
      forksQuery('wf_c9d2f3'),
    ]) {
      expect(query.text).not.toContain('parent_workflow_id');
    }
  });
});
