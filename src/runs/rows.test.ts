import { describe, expect, it } from 'vitest';

import {
  FIRST_DISPATCH,
  OUTPUT_KEPT,
  errorIn,
  hasRecovered,
  inputIn,
  outputIn,
  recoveriesOf,
  stepError,
  toCounts,
  toRun,
  toStep,
} from './rows.js';
import type {
  CountsRow,
  OperationOutputRow,
  WorkflowStatusRow,
} from './rows.js';

/**
 * The columns, as `node-postgres` actually hands
 * them over.
 *
 * Two column types arrive differently and the
 * difference is invisible until it is on screen.
 * `recovery_attempts`, `created_at`, `completed_at`
 * and the two epoch columns are `bigint`, and a
 * 64-bit integer does not always fit a JavaScript
 * number — so the driver hands them back as
 * **strings**. `function_id` is `int4` and arrives
 * as a real number. Putting `Number()` over
 * everything would work and would hide which is
 * which; leaving it off everything would put
 * `"1"` in the recovery count. Both directions are
 * asserted below.
 *
 * The other trap is `output`, `error` and `inputs`:
 * serialized JSON stored as *text*, in whichever
 * dialect the `serialization` column names. The
 * raw panel shows those bytes as they are, and the
 * one place anything is parsed guards the parse.
 */

const RUN: WorkflowStatusRow = {
  workflow_uuid: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recovery_attempts: '2',
  executor_id: 'local-dev',
  application_version: 'v0.4.1',
  created_at: '1739880131000',
  started_at_epoch_ms: '1739880131100',
  completed_at: '1739880139200',
  error: null,
  serialization: null,
};

const STEP: OperationOutputRow = {
  function_id: 3,
  function_name: 'book_appointment',
  started_at_epoch_ms: '1739880135000',
  completed_at_epoch_ms: '1739880136500',
  output: '{"confirmation":"AB-1209"}',
  error: null,
  child_workflow_id: null,
  serialization: null,
};

describe('a run row', () => {
  it('reads the bigint columns back as numbers', () => {
    const run = toRun(RUN);

    expect(run.recoveryAttempts).toBe(2);
    expect(run.createdAt).toBe(1739880131000);
    expect(run.startedAt).toBe(1739880131100);
    expect(run.completedAt).toBe(1739880139200);
  });

  it('keeps the strings that were always strings', () => {
    const run = toRun(RUN);

    expect(run.workflowId).toBe('wf_c9d2f3');
    expect(run.name).toBe('groom_booking');
    expect(run.status).toBe('SUCCESS');
    expect(run.executorId).toBe('local-dev');
    expect(run.applicationVersion).toBe('v0.4.1');
  });

  /**
   * A run that has not finished has no completion,
   * and a run that has not started has no start.
   * Zero would be a moment in 1970 and would draw
   * a bar a lifetime long.
   */
  it('leaves an unfinished run unfinished', () => {
    const run = toRun({
      ...RUN,
      status: 'PENDING',
      started_at_epoch_ms: null,
      completed_at: null,
    });

    expect(run.startedAt).toBeUndefined();
    expect(run.completedAt).toBeUndefined();
  });

  it('reads a column DBOS has not filled in as absent', () => {
    expect(
      toRun({ ...RUN, application_version: null }).applicationVersion,
    ).toBe(undefined);
  });

  /**
   * The row shows the failure inline, so the
   * sentence has to come out of a serialized error
   * object — and has to survive one that is not
   * shaped the way the default serializer writes
   * them.
   */
  it('finds the sentence inside a serialized error', () => {
    const failed = toRun({
      ...RUN,
      status: 'ERROR',
      error: '{"name":"Error","message":"login failed — CDC_PASS rotated"}',
    });

    expect(failed.error).toBe('login failed — CDC_PASS rotated');
  });

  it('finds it inside the wrapper a richer serializer adds', () => {
    const failed = toRun({
      ...RUN,
      status: 'ERROR',
      serialization: 'native',
      error: '{"json":{"name":"Error","message":"boom"},"meta":{}}',
    });

    expect(failed.error).toBe('boom');
  });

  /**
   * A serializer this extension has never heard of
   * writes bytes it cannot read, and the honest
   * answer to that is the bytes.
   */
  it('shows what was stored when it cannot read it', () => {
    const failed = toRun({
      ...RUN,
      status: 'ERROR',
      serialization: 'something-else',
      error: ' not json at all',
    });

    expect(failed.error).toBe(' not json at all');
  });

  it('leaves a run that did not fail without an error', () => {
    expect(toRun(RUN).error).toBeUndefined();
    expect(toRun({ ...RUN, error: '' }).error).toBeUndefined();
  });
});

describe('a step row', () => {
  /**
   * `function_id` is the one number in either table
   * that is not a `bigint`, so it is the one that
   * arrives already a number.
   */
  it('takes the step number as the number it arrives as', () => {
    const step = toStep(STEP);

    expect(step.functionId).toBe(3);
    expect(STEP.function_id).toBeTypeOf('number');
  });

  it('reads the epoch columns back as numbers', () => {
    const step = toStep(STEP);

    expect(step.startedAt).toBe(1739880135000);
    expect(step.completedAt).toBe(1739880136500);
  });

  /**
   * The raw panel is a picture of the table, so
   * what it shows is what the column holds — never
   * a reserialized version of what this extension
   * made of it.
   */
  it('carries the output through byte for byte', () => {
    expect(toStep(STEP).output).toBe('{"confirmation":"AB-1209"}');

    const odd = { ...STEP, serialization: 'portable', output: 'not json {' };
    expect(toStep(odd).output).toBe('not json {');
  });

  it('names the child a step started, when it started one', () => {
    expect(toStep(STEP).childWorkflowId).toBeUndefined();
    expect(
      toStep({ ...STEP, child_workflow_id: 'wf_child' }).childWorkflowId,
    ).toBe('wf_child');
  });

  it('finds the sentence inside a step failure too', () => {
    const failed = toStep({ ...STEP, error: '{"message":"429 from twilio"}' });

    expect(failed.error).toBe('429 from twilio');
  });

  it('leaves a step that has not finished unfinished', () => {
    const running = toStep({
      ...STEP,
      completed_at_epoch_ms: null,
      output: null,
    });

    expect(running.completedAt).toBeUndefined();
    expect(running.output).toBeUndefined();
  });
});

describe('the filter counts', () => {
  /**
   * `count(*)` is a `bigint` too, so all three
   * arrive as strings and all three would show as
   * strings on the segmented control if nobody
   * looked.
   */
  it('reads all three back as numbers', () => {
    const row: CountsRow = {
      all_runs: '6',
      failed_runs: '1',
      recovered_runs: '1',
    };

    expect(toCounts(row)).toEqual({ all: 6, failed: 1, recovered: 1 });
  });

  it('reads an empty database as three zeroes', () => {
    expect(toCounts(undefined)).toEqual({ all: 0, failed: 0, recovered: 0 });
  });
});

/**
 * The column's meaning, which its name gets wrong.
 *
 * DBOS writes `1` into `recovery_attempts` when a
 * workflow starts, and `0` when one is enqueued —
 * then adds one the moment a worker claims it. So
 * every run in the database has at least one
 * "attempt" and none of them is a crash, and a
 * filter written as `> 0` marks the whole table
 * recovered. DBOS makes the same adjustment itself
 * when it decides a run has been restarted too
 * often.
 */
describe('what recovery_attempts counts', () => {
  const run = (recoveryAttempts: number) =>
    toRun({ ...RUN, recovery_attempts: String(recoveryAttempts) });

  it('counts the first dispatch, which is not a crash', () => {
    expect(FIRST_DISPATCH).toBe(1);
    expect(hasRecovered(run(1))).toBe(false);
    expect(recoveriesOf(run(1))).toBe(0);
  });

  it('calls anything past that a recovery', () => {
    expect(hasRecovered(run(2))).toBe(true);
    expect(recoveriesOf(run(2))).toBe(1);
    expect(recoveriesOf(run(4))).toBe(3);
  });

  /** A run enqueued and never claimed reads zero,
   *  and has certainly not recovered. */
  it('reads a run nothing has picked up yet as not recovered', () => {
    expect(hasRecovered(run(0))).toBe(false);
    expect(recoveriesOf(run(0))).toBe(0);
  });
});

/**
 * What DBOS actually wrote where a step failed.
 *
 * Two serializers are in play. The default wraps
 * everything superjson does, so the error sits
 * under `json` with the dialect named beside it;
 * the portable one writes the fields flat and
 * carries no stack at all. Both are read here
 * because either can be the one a project chose,
 * and a panel that only understood one would be
 * blank against the other.
 */
describe('what a stored error says', () => {
  it('reads a plain serialized error', () => {
    expect(
      errorIn(JSON.stringify({ name: 'SlotTaken', message: 'no slot left' })),
    ).toEqual({ name: 'SlotTaken', message: 'no slot left' });
  });

  it('reads one inside the wrapper a richer serializer adds', () => {
    expect(
      errorIn(
        JSON.stringify({
          json: {
            name: 'SlotTaken',
            message: 'no slot left',
            stack: 'SlotTaken: no slot left\n    at findSlot',
          },
          meta: { values: ['Error'] },
          __dbos_serializer: 'superjson',
        }),
      ),
    ).toEqual({
      name: 'SlotTaken',
      message: 'no slot left',
      stack: 'SlotTaken: no slot left\n    at findSlot',
    });
  });

  /**
   * A step that ran out of retries stores one error
   * whose message is DBOS's own sentence about the
   * retries, with every attempt underneath it. The
   * attempts are what a person is looking for, so
   * they are kept rather than flattened into that
   * sentence.
   */
  it('keeps every attempt when the step ran out of retries', () => {
    const stored = errorIn(
      JSON.stringify({
        json: {
          dbosErrorCode: 23,
          name: 'Error',
          message:
            'Step find_slot has exceeded its maximum of 2 retries. ' +
            'Previous errors: Error 1: first. Error 2: second',
          errors: [
            { name: 'SlotTaken', message: 'first', stack: 'a' },
            { name: 'SlotTaken', message: 'second', stack: 'b' },
          ],
        },
        __dbos_serializer: 'superjson',
      }),
    );

    expect(stored?.errors).toEqual([
      { name: 'SlotTaken', message: 'first', stack: 'a' },
      { name: 'SlotTaken', message: 'second', stack: 'b' },
    ]);
    expect(stored?.message).toContain('exceeded its maximum');
  });

  it('shows the bytes when it cannot read them', () => {
    expect(errorIn('not json at all')).toEqual({
      message: 'not json at all',
    });
    expect(errorIn(null)).toBeUndefined();
  });
});

/**
 * A stack is written by whatever threw, and most
 * of what it names is not code anybody in this
 * project wrote: the SDK's own frames, the
 * generated workflow, Node's internals. A frame
 * offered to somebody has to be one they can act
 * on, so a stack that names none of theirs carries
 * no frame at all rather than its first line.
 */
describe('a failure as a person needs it', () => {
  it('carries the lib frame a failure came from', () => {
    expect(
      stepError({
        name: 'Error',
        message: 'boom from lib',
        stack:
          'Error: boom from lib\n' +
          '    at boom (/app/lib/boom.ts:7:11)\n' +
          '    at DBOS.runStep.name ' +
          '(/app/src/workflows/boom.workflow.ts:17:52)',
      })?.frame,
    ).toEqual({ file: 'lib/boom.ts', line: 7, column: 11 });
  });

  /**
   * DBOS's own wrapper over an exhausted step names
   * only the SDK, and the try underneath it names
   * the handler — so the frame follows the headline
   * to the last try rather than being read off the
   * wrapper.
   */
  it('takes the frame from the try the headline came from', () => {
    expect(
      stepError({
        name: 'Error',
        message: 'Step go_boom has exceeded its maximum of 3 retries.',
        stack:
          'Error: Step go_boom has exceeded its maximum of 3 retries.\n' +
          '    at DBOSExecutor.callStepFunction ' +
          '(/app/node_modules/@dbos-inc/dbos-sdk/src/dbos-executor.ts:1198:32)',
        errors: [
          {
            name: 'Error',
            message: 'boom from lib',
            stack: 'Error: boom from lib\n    at boom (/app/lib/boom.ts:7:11)',
          },
        ],
      })?.frame,
    ).toEqual({ file: 'lib/boom.ts', line: 7, column: 11 });
  });

  it('carries no frame for a stack outside lib', () => {
    expect(
      stepError({
        message: 'timed out',
        stack:
          'Error: timed out\n' +
          '    at runStep ' +
          '(/app/node_modules/@dbos-inc/dbos-sdk/lib/step.js:412:19)\n' +
          '    at process.processTicksAndRejections ' +
          '(node:internal/process/task_queues:105:5)',
      })?.frame,
    ).toBeUndefined();

    expect(
      stepError({
        message: 'timed out',
        stack:
          'Error: timed out\n' +
          '    at refund (/app/src/workflows/refund.workflow.ts:31:9)',
      })?.frame,
    ).toBeUndefined();
  });
});

/**
 * `dbos.workflow_status.inputs` holds the argument
 * *array* a run was started with, serialized. A
 * generated workflow takes exactly one argument, so
 * an array of one is the payload and anything else
 * is somebody else's workflow — kept as the text it
 * was stored as rather than guessed at.
 */
describe('what a run was started with', () => {
  it('unwraps the one argument a generated workflow takes', () => {
    expect(
      inputIn(JSON.stringify([{ email: 'ada@example.com' }]), null),
    ).toEqual({ shape: 'payload', value: { email: 'ada@example.com' } });
  });

  it('keeps anything else as the text it was stored as', () => {
    expect(inputIn('[1,2]', 'superjson')).toEqual({
      shape: 'raw',
      text: '[1,2]',
      serialization: 'superjson',
    });
    expect(inputIn('"a string"', null)).toEqual({
      shape: 'raw',
      text: '"a string"',
    });
  });

  it('says nothing for a run with no recorded input', () => {
    expect(inputIn(null, null)).toEqual({ shape: 'none' });
    expect(inputIn('', null)).toEqual({ shape: 'none' });
  });
});

/**
 * A step's output goes on screen whole where it is
 * small and cut where it is not. The cut is said
 * out loud, and the size before the cut is kept —
 * a panel showing two thousand characters of a
 * megabyte with no sign of it is lying about what
 * the step returned.
 */
describe('what a step returned', () => {
  it('carries a short output through whole', () => {
    expect(outputIn('{"confirmation":"AB-1209"}')).toEqual({
      text: '{"confirmation":"AB-1209"}',
      cut: false,
      bytes: 26,
    });
  });

  it('cuts a long one and says it cut it', () => {
    const long = `"${'x'.repeat(OUTPUT_KEPT + 500)}"`;
    const read = outputIn(long);

    expect(read.text).toHaveLength(OUTPUT_KEPT);
    expect(read.cut).toBe(true);
    expect(read.bytes).toBe(OUTPUT_KEPT + 502);
  });
});
