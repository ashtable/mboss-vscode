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

const RUN_COLUMNS = [
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
  const where = whereFor(filter);

  return {
    text:
      `SELECT ${RUN_COLUMNS} FROM dbos.workflow_status ` +
      `${where.text}ORDER BY created_at DESC LIMIT $${where.values.length + 1}`,
    values: [...where.values, limit],
  };
}

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
      'FROM dbos.workflow_status',
    values: [FAILED_STATUSES, FIRST_DISPATCH],
  };
}

/** One run, by the id on its row. */
export function runQuery(workflowId: string): Query {
  return {
    text:
      `SELECT ${RUN_COLUMNS} FROM dbos.workflow_status ` +
      'WHERE workflow_uuid = $1',
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
      'WHERE name = $1 AND created_at >= $2 ' +
      'ORDER BY created_at DESC LIMIT 1',
    values: [workflow, since],
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

/** The clause one filter adds, and what it binds. */
function whereFor(filter: RunFilter): { text: string; values: unknown[] } {
  if (filter === 'failed') {
    return { text: 'WHERE status = ANY($1) ', values: [FAILED_STATUSES] };
  }

  // Greater than the first dispatch, not greater
  // than zero: the column counts dispatches, so
  // every run in the database has at least one.
  if (filter === 'recovered') {
    return {
      text: 'WHERE recovery_attempts > $1 ',
      values: [FIRST_DISPATCH],
    };
  }

  return { text: '', values: [] };
}
