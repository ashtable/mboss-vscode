import { describe, expect, it } from 'vitest';

import {
  FAILED_STATUSES,
  MAX_RUNS,
  RUN_FILTERS,
  countsQuery,
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

const ALL_QUERIES = [
  ...RUN_FILTERS.map((filter) => runsQuery(filter, MAX_RUNS)),
  countsQuery(),
  runQuery('wf_c9d2f3'),
  stepsQuery('wf_c9d2f3'),
];

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

    for (const query of [runQuery(hostile), stepsQuery(hostile)]) {
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
    expect(query.text).toContain('LIMIT $1');
    expect(query.values).toEqual([MAX_RUNS]);
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

    expect(query.text).toContain('WHERE status = ANY($1)');
    expect(query.values).toEqual([FAILED_STATUSES, MAX_RUNS]);
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

    expect(query.text).toContain('WHERE recovery_attempts > $1');
    expect(query.values).toEqual([FIRST_DISPATCH, MAX_RUNS]);
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
