import { libFrameOf, type SourceFrame } from './frames.js';

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

// Declared beside the parse that produces one and
// handed on from here, because a frame reaches
// every reader as a field of a failure rather than
// on its own.
export type { SourceFrame } from './frames.js';

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
export type BigIntColumn = string | number;

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

  forked_from?: string | null;

  was_forked_from?: boolean | null;

  /** Selected only where a single run is being
   *  read: the list would carry every run's whole
   *  argument array for a column nothing on it
   *  draws. */
  inputs?: string | null;

  /** The three the list read for itself, out of
   *  `dbos.operation_outputs`, and which the
   *  one-run read does not ask for. */
  last_operation?: string | null;

  last_operation_at?: BigIntColumn | null;

  operation_count?: BigIntColumn | null;

  /** Selected only by the read that lists the runs
   *  forked from another: the highest operation this
   *  one carried over. `null` where it carried
   *  none. */
  last_reused?: BigIntColumn | null;
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

  /**
   * The same failure, whole — the name, the stack
   * and every attempt, where the row carried them.
   * `error` stays the sentence, so nothing that
   * already draws it has to change.
   */
  failure?: StoredError;

  /** The run this one was forked from, and whether
   *  anything was ever forked from it. */
  forkedFrom: string | undefined;

  wasForkedFrom: boolean;

  /**
   * Filled by the one-run read only. The list does
   * not select `inputs`: it would carry every run's
   * whole argument array for a column no row draws.
   */
  input?: RunInput;

  /**
   * Filled by the list read only, out of the three
   * correlated columns it asks
   * `dbos.operation_outputs` for. The one-run read
   * has every operation in hand and needs no
   * summary of them.
   */
  lastOperation?: string;

  lastOperationAt?: number;

  operationCount?: number;

  /**
   * Filled by the read that lists the runs forked
   * from another: the first step this one ran for
   * itself, which is the step above the last row it
   * carried over.
   */
  startStep?: number;
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

  /** The same failure, whole. `error` stays the
   *  sentence. */
  failure?: StoredError;

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

/**
 * A run, from whichever read produced the row.
 *
 * The optional fields follow the columns: a list
 * row carries the three correlated summaries and no
 * `inputs`, a one-run row carries `inputs` and none
 * of the three. Nothing here decides which — the
 * statement did, and this reads what arrived.
 */
export function toRun(row: WorkflowStatusRow): Run {
  const failure = errorIn(row.error);

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
    ...(failure === undefined ? {} : { failure }),
    forkedFrom: text(row.forked_from ?? null),
    wasForkedFrom: row.was_forked_from === true,
    ...(row.inputs === undefined
      ? {}
      : { input: inputIn(row.inputs, row.serialization) }),
    ...(text(row.last_operation ?? null) === undefined
      ? {}
      : { lastOperation: text(row.last_operation ?? null) }),
    ...(row.last_operation_at === undefined || row.last_operation_at === null
      ? {}
      : { lastOperationAt: Number(row.last_operation_at) }),
    ...(row.operation_count === undefined || row.operation_count === null
      ? {}
      : { operationCount: Number(row.operation_count) }),
    ...(row.last_reused === undefined
      ? {}
      : { startStep: startStepIn(row.last_reused) }),
  };
}

/**
 * The first step a fork ran for itself.
 *
 * One past the last row it carried over — and zero
 * where it carried none, which is a replay from the
 * very beginning. `null` is that case rather than a
 * missing column: the column is a `max` over no
 * rows.
 */
function startStepIn(last: BigIntColumn | null): number {
  return last === null ? 0 : Number(last) + 1;
}

export function toStep(row: OperationOutputRow): Step {
  const failure = errorIn(row.error);

  return {
    functionId: row.function_id,
    name: row.function_name,
    startedAt: epoch(row.started_at_epoch_ms),
    completedAt: epoch(row.completed_at_epoch_ms),
    output: text(row.output),
    error: messageIn(row.error),
    ...(failure === undefined ? {} : { failure }),
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
 * An error as DBOS stored it.
 *
 * Two serializers write two shapes. The default one
 * runs the error through `serialize-error` first,
 * so the stack and every own property survive under
 * a `json` wrapper; the portable one writes name,
 * message and nothing else, which is why the stack
 * is optional. `errors` is what a step that ran out
 * of retries carries: one entry per attempt, each
 * the same shape.
 */
export type StoredError = {
  name?: string;
  message: string;
  stack?: string;
  errors?: StoredError[];
};

/**
 * The error a row holds, read as far as it can be.
 *
 * Tolerant in exactly the way `messageIn` beside it
 * is, and for the same reason: a project may
 * register a serializer this build has never seen.
 * The `serialization` column is not consulted — the
 * reader tries the wrapper and the flat shape
 * either way, which is right about a dialect it has
 * never heard of and about a column that lies.
 */
export function errorIn(stored: string | null): StoredError | undefined {
  const raw = text(stored);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: raw };
  }

  return (
    storedError(parsed) ??
    storedError(fieldOf(parsed, 'json')) ?? { message: raw }
  );
}

/** One error object, or nothing where the value is
 *  not one. */
function storedError(value: unknown): StoredError | undefined {
  const message = fieldOf(value, 'message');
  if (typeof message !== 'string' || message === '') return undefined;

  const name = fieldOf(value, 'name');
  const stack = fieldOf(value, 'stack');
  const attempts = fieldOf(value, 'errors');

  return {
    ...(typeof name === 'string' ? { name } : {}),
    message,
    ...(typeof stack === 'string' ? { stack } : {}),
    ...(Array.isArray(attempts)
      ? { errors: attempts.flatMap((one) => storedError(one) ?? []) }
      : {}),
  };
}

/**
 * A failure as a person needs it, rather than as it
 * was stored.
 *
 * The headline is the stored error's own, except
 * where DBOS stored a max-retries error — then it is
 * the last attempt's, because the sentence DBOS
 * writes about the retries names no cause and the
 * attempt does. Every attempt is kept, and
 * `retriesExhausted` is what says which case this
 * is.
 *
 * Stated here, once, beside the reader that produced
 * the stored shape — everything that draws a failure
 * asks this rather than deciding for itself.
 */
export type StepError = StoredError & {
  retriesExhausted: boolean;

  /**
   * Where in the project's own code the failure
   * came from, where the stack names it.
   *
   * Absent far more often than not, and that is the
   * point: a stack is mostly the SDK, the generated
   * workflow and Node's internals, and a frame
   * offered to somebody has to be one they wrote.
   */
  frame: SourceFrame | undefined;
};

export function stepError(
  stored: StoredError | undefined,
): StepError | undefined {
  if (stored === undefined) return undefined;

  const attempts = stored.errors;
  const headline = attempts?.at(-1) ?? stored;

  return {
    ...(headline.name === undefined ? {} : { name: headline.name }),
    message: headline.message,
    ...(headline.stack === undefined ? {} : { stack: headline.stack }),
    ...(attempts === undefined ? {} : { errors: attempts }),
    retriesExhausted: attempts !== undefined && attempts.length > 0,

    // The headline's stack, so the frame and the
    // sentence beside it come from the same try.
    frame: libFrameOf(headline.stack),
  };
}

/**
 * What a run was started with.
 *
 * `dbos.workflow_status.inputs` holds the whole
 * *argument array*, serialized. A generated workflow
 * takes exactly one argument, so an array of one is
 * the payload a person meant; anything else came
 * from a workflow this compiler did not write and
 * is shown as the text it was stored as rather than
 * guessed at.
 *
 * There is no per-step equivalent. The schema has
 * no such column, and inventing one would be a
 * panel making something up.
 */
export type RunInput =
  | { shape: 'payload'; value: unknown }
  | { shape: 'raw'; text: string; serialization?: string }
  | { shape: 'none' };

export function inputIn(
  stored: string | null,
  serialization: string | null,
): RunInput {
  const raw = text(stored);
  if (raw === undefined) return { shape: 'none' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return asRaw(raw, serialization);
  }

  const args = Array.isArray(parsed) ? parsed : fieldOf(parsed, 'json');

  return Array.isArray(args) && args.length === 1
    ? { shape: 'payload', value: args[0] }
    : asRaw(raw, serialization);
}

function asRaw(raw: string, serialization: string | null): RunInput {
  const dialect = text(serialization);

  return {
    shape: 'raw',
    text: raw,
    ...(dialect === undefined ? {} : { serialization: dialect }),
  };
}

/**
 * How much of a step's output a panel will hold.
 *
 * A step may return a megabyte, and a cell that
 * quietly showed the first part of one would be
 * lying about what the step returned. Cut, said out
 * loud, with the size before the cut kept.
 */
export const OUTPUT_KEPT = 2000;

export function outputIn(stored: string | null): {
  text: string;
  cut: boolean;
  bytes: number;
} {
  const raw = text(stored) ?? '';

  // `TextEncoder` rather than `Buffer`, because this
  // module is in the browser bundles as well as the
  // host and a Node global there is `undefined`
  // rather than a build failure.
  return {
    text: raw.slice(0, OUTPUT_KEPT),
    cut: raw.length > OUTPUT_KEPT,
    bytes: new TextEncoder().encode(raw).length,
  };
}

/**
 * The marker DBOS's richer serializer stamps on its
 * own envelope, and the value it stamps.
 *
 * Named rather than written inline because the pair
 * is the SDK's published contract for telling its
 * wrapper apart from data that merely looks like
 * one, and a reader that guessed instead would hand
 * back half of what a step returned.
 */
const SERIALIZER_MARKER = '__dbos_serializer';

const SERIALIZER_MARKED = 'superjson';

/**
 * What a step returned, out of the bytes the column
 * holds.
 *
 * The richer serializer wraps every value it writes
 * — `{"json":<value>,"__dbos_serializer":"superjson"}`
 * — while the portable one writes the value itself,
 * so a reader that only parsed would be looking at
 * an envelope half the time and find nothing inside
 * whatever it was asked for.
 *
 * The marker decides, and nothing else: the
 * `serialization` column is not consulted, for the
 * same reason `errorIn` does not consult it, and a
 * step that returns a `json` field of its own keeps
 * it. Anything that will not parse is nothing rather
 * than a guess.
 */
export function valueIn(stored: string | undefined): unknown {
  if (stored === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }

  return enveloped(parsed) ? fieldOf(parsed, 'json') : parsed;
}

function enveloped(value: unknown): boolean {
  return (
    fieldOf(value, SERIALIZER_MARKER) === SERIALIZER_MARKED &&
    fieldOf(value, 'json') !== undefined
  );
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
