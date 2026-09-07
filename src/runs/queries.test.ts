import { describe, expect, it } from 'vitest';

import { SDK_OPERATIONS } from '../core/rules.js';

import {
  ALL_QUERIES,
  FAILED_STATUSES,
  MAX_RUNS,
  RUN_COLUMNS,
  RUN_FILTERS,
  countsQuery,
  forksQuery,
  latestRunQuery,
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
      expect(query.text).toMatch(/\bdbos\.(workflow_status|operation_outputs)/);
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
