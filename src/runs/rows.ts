/**
 * DBOS's columns, and the fields this view draws
 * from them.
 *
 * The mapping is small and the tests around it are
 * not, because two of the traps here are invisible
 * until a number is on screen as a string, or a
 * panel is blank because a serializer this build
 * has never heard of wrote the bytes.
 */

/**
 * A `bigint` column as `node-postgres` hands it
 * over.
 *
 * The driver returns `int8` as text, because a
 * 64-bit integer does not always fit a JavaScript
 * number. Every one of these holds epoch
 * milliseconds or a count, which do fit — and the
 * union also covers a caller that installed a type
 * parser of its own.
 */
type BigIntColumn = string | number;

/** A row of `dbos.workflow_status`, as selected. */
export type WorkflowStatusRow = {
  workflow_uuid: string;

  name: string;

  status: string;

  recovery_attempts: BigIntColumn;

  executor_id: string;

  application_version: string | null;

  created_at: BigIntColumn;

  started_at_epoch_ms: BigIntColumn | null;

  completed_at: BigIntColumn | null;

  error: string | null;

  serialization: string | null;
};

/** A row of `dbos.operation_outputs`, as selected. */
export type OperationOutputRow = {
  /** `int4`, so it arrives already a number — the
   *  one column here that does. */
  function_id: number;

  function_name: string;

  started_at_epoch_ms: BigIntColumn | null;

  completed_at_epoch_ms: BigIntColumn | null;

  output: string | null;

  error: string | null;

  child_workflow_id: string | null;

  serialization: string | null;
};

/** The three numbers over the segmented control. */
export type CountsRow = {
  all_runs: BigIntColumn;

  failed_runs: BigIntColumn;

  recovered_runs: BigIntColumn;
};

/** One run of a workflow. */
export type Run = {
  workflowId: string;

  /** The name it was registered under, which is the
   *  only display identifier a generated workflow
   *  has. */
  name: string;

  /** DBOS's own word, shown as it is. */
  status: string;

  /**
   * The raw `recovery_attempts` column, which
   * counts *dispatches* and not crashes — see
   * `FIRST_DISPATCH`.
   *
   * A count for the whole run. DBOS records nothing
   * per step, so there is no per-step attempt
   * number anywhere to draw.
   */
  recoveryAttempts: number;

  /** Which process owns it, which changes across a
   *  crash and a restart. */
  executorId: string;

  applicationVersion: string | undefined;

  createdAt: number;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** What it failed with, in as many words as could
   *  be read out of the stored error. */
  error: string | undefined;
};

/** One step of a run. */
export type Step = {
  functionId: number;

  name: string;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** Exactly the bytes the column holds. */
  output: string | undefined;

  error: string | undefined;

  childWorkflowId: string | undefined;
};

export type RunCounts = { all: number; failed: number; recovered: number };

/**
 * What `recovery_attempts` reads for a run that
 * never crashed.
 *
 * The column counts **dispatches, not recoveries**.
 * DBOS writes `1` into it when a workflow starts
 * directly, and `0` when one is enqueued — then
 * adds one the moment a worker claims it. So an
 * ordinary run that worked first time already
 * carries `1`, and `> 0` would mark every run in
 * the database as recovered.
 *
 * DBOS compensates for the same offset itself: it
 * dead-letters a run when its attempts exceed the
 * allowed maximum *plus one*.
 *
 * Named rather than written as a `1` in four places,
 * because the number means something and the thing
 * it means is not obvious from the column's name.
 */
export const FIRST_DISPATCH = 1;

/** Whether DBOS ever picked this run back up. */
export function hasRecovered(run: Run): boolean {
  return run.recoveryAttempts > FIRST_DISPATCH;
}

/** How many times it did — which is one fewer than
 *  the column says. */
export function recoveriesOf(run: Run): number {
  return Math.max(run.recoveryAttempts - FIRST_DISPATCH, 0);
}

export function toRun(row: WorkflowStatusRow): Run {
  return {
    workflowId: row.workflow_uuid,
    name: row.name,
    status: row.status,
    recoveryAttempts: Number(row.recovery_attempts),
    executorId: row.executor_id,
    applicationVersion: text(row.application_version),
    createdAt: Number(row.created_at),
    startedAt: epoch(row.started_at_epoch_ms),
    completedAt: epoch(row.completed_at),
    error: messageIn(row.error),
  };
}

export function toStep(row: OperationOutputRow): Step {
  return {
    functionId: row.function_id,
    name: row.function_name,
    startedAt: epoch(row.started_at_epoch_ms),
    completedAt: epoch(row.completed_at_epoch_ms),
    output: text(row.output),
    error: messageIn(row.error),
    childWorkflowId: text(row.child_workflow_id),
  };
}

export function toCounts(row: CountsRow | undefined): RunCounts {
  if (row === undefined) return { all: 0, failed: 0, recovered: 0 };

  return {
    all: Number(row.all_runs),
    failed: Number(row.failed_runs),
    recovered: Number(row.recovered_runs),
  };
}

/**
 * The sentence inside a stored error, or the
 * stored bytes.
 *
 * An error is serialized JSON as text, in whichever
 * dialect the row's `serialization` column names —
 * and a project may register a serializer this
 * build has never seen. So the parse is attempted
 * and never relied on: anything that does not come
 * back as an object with a message is shown as it
 * was stored, which is at least true.
 *
 * The nested `json` case is the richer serializer's
 * wrapper, which puts the value under one key and
 * its type notes under another.
 */
function messageIn(stored: string | null): string | undefined {
  const raw = text(stored);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  return messageOf(parsed) ?? messageOf(fieldOf(parsed, 'json')) ?? raw;
}

function messageOf(value: unknown): string | undefined {
  const message = fieldOf(value, 'message');

  return typeof message === 'string' && message !== '' ? message : undefined;
}

function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;

  return (value as Record<string, unknown>)[name];
}

/** A nullable text column, with the empty string
 *  counted as nothing — which is how DBOS spells
 *  "no error" on a step that worked. */
function text(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value;
}

function epoch(value: BigIntColumn | null): number | undefined {
  return value === null ? undefined : Number(value);
}
