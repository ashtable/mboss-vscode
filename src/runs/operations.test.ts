import { describe, expect, it } from 'vitest';

import type { WorkflowIR } from '../core/rules.js';
import {
  TIMER_THEN_ANSWER,
  TIMER_WAKES_AT,
  timerThenAnswerRows,
} from '../test-support/runs.js';

import { decidedArms, wakeOf } from './operations.js';
import { readRun, type Operation } from './reading.js';
import { errorIn, type Run, type Step } from './rows.js';

/**
 * The moment a sleep row names, and the arms a run
 * is known to have taken.
 *
 * Both questions are asked of a reading, which is
 * where a row is attributed — so these cases go
 * through `readRun` rather than building operations
 * of their own, and a change to attribution shows up
 * here as well as in `reading.test.ts`.
 */

/** Later than anything these fixtures record, so
 *  the window closes at the last thing that
 *  happened. */
const NOW = 1_000_000;

/** The rows, read. */
function operationsOf(
  run: Run,
  steps: Step[],
  ir: WorkflowIR | undefined,
): Operation[] {
  return readRun(run, steps, ir ?? 'lost', false, NOW, ir).steps;
}

const RUN: Run = {
  workflowId: 'wf_1',
  name: 'expense_claim',
  status: 'PENDING',
  recoveryAttempts: 1,
  executorId: 'local-dev',
  applicationVersion: 'v0.1.0',
  createdAt: 1000,
  startedAt: 1000,
  completedAt: undefined,
  error: undefined,
  forkedFrom: undefined,
  wasForkedFrom: false,
};

/** A row as `toStep` would have built it, so a
 *  fixture carrying an error carries the read of it
 *  the way a real row does. */
function step(over: Partial<Step> & { name: string }): Step {
  const built: Step = {
    functionId: 0,
    startedAt: 1000,
    completedAt: 1100,
    output: '{}',
    error: undefined,
    childWorkflowId: undefined,
    ...over,
  };
  const failure = errorIn(built.error ?? null);

  return failure === undefined ? built : { ...built, failure };
}

/**
 * A return value as the SDK's own serializer stores
 * it: the value under `json`, beside the marker the
 * serializer stamps so a reader can tell its
 * envelope from an object that merely has a `json`
 * field.
 */
function serialized(value: unknown): string {
  return JSON.stringify({ json: value, __dbos_serializer: 'superjson' });
}

/**
 * A claim that asks a person, then branches on how
 * much it was for.
 */
const IR: WorkflowIR = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 3,
  name: 'expense_claim',
  nodes: [
    { id: 'parse_claim', kind: 'step', title: 'Parse', config: {} },
    {
      id: 'manager_ok',
      kind: 'approval',
      title: 'Manager approves',
      config: { to: 'requestingUser', subject: 'Approve?', timeoutDays: 3 },
    },
    {
      id: 'how_big',
      kind: 'branch',
      title: 'How big',
      config: {
        cases: [
          { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
        ],
        elsePort: 'small',
      },
    },
    { id: 'charge_each', kind: 'step', title: 'Charge', config: {} },
    { id: 'index_pages', kind: 'queue', title: 'Index each page', config: {} },
  ],
  edges: [],
} as unknown as WorkflowIR;

/**
 * When a sleep row says the run wakes, asked of the
 * row itself: the trace draws the moment on the row
 * that recorded it, whichever block it sits under.
 */
describe('the moment a sleep row names', () => {
  /** The wake off one of the rows a case read. */
  function wakeIn(row: Operation | undefined) {
    if (row === undefined) throw new Error('no such row');

    return wakeOf(row);
  }

  it('is when a sleeping block wakes', () => {
    const [, sleep] = operationsOf(
      RUN,
      [
        step({ functionId: 0, name: 'charge_each' }),
        step({
          functionId: 1,
          name: 'DBOS.sleep',
          startedAt: 1000,
          completedAt: 90_000,
          output: '90000',
        }),
      ],
      IR,
    );

    expect(wakeIn(sleep)).toEqual({
      at: 90_000,
      kind: 'sleep',
    });
  });

  /**
   * A wait on the clock owns its sleep row, so the
   * row is no longer one the SDK wrote for itself —
   * and the moment it names is still the moment the
   * block wakes. Reading the wake off who owns the
   * row rather than off what it is called would
   * lose it exactly where the block is drawn.
   */
  it('is read off a row a wait on the clock owns', () => {
    const [sleep] = operationsOf(RUN, timerThenAnswerRows(), TIMER_THEN_ANSWER);

    expect(sleep?.nodeId).toBe('let_it_wait');
    expect(wakeIn(sleep)).toEqual({
      at: TIMER_WAKES_AT,
      kind: 'sleep',
    });
  });

  /**
   * A zero-width sleep is the marker a timeout
   * leaves: its deadline may never be reached,
   * because the run wakes when somebody answers.
   */
  it('tells a timeout marker from a sleep by its width', () => {
    const [, sleep] = operationsOf(
      RUN,
      [
        step({ functionId: 0, name: 'manager_ok.register' }),
        step({
          functionId: 1,
          name: 'DBOS.sleep',
          startedAt: 1000,
          completedAt: 1000,
          output: '90000',
        }),
      ],
      IR,
    );

    expect(wakeIn(sleep)).toEqual({
      at: 90_000,
      kind: 'timeout',
    });
  });

  it('is nothing for any other row, or a deadline that is no number', () => {
    const [own, sleep] = operationsOf(
      RUN,
      [
        step({ functionId: 0, name: 'charge_each', output: '90000' }),
        step({ functionId: 1, name: 'DBOS.sleep', output: 'soon' }),
      ],
      IR,
    );

    expect(own?.name).toBe('charge_each');
    expect(sleep?.name).toBe('DBOS.sleep');
    expect(wakeIn(own)).toBeUndefined();
    expect(wakeIn(sleep)).toBeUndefined();
  });
});

describe('which arm a decision took', () => {
  it('reads the arm from the round the run is on', () => {
    const arms = decidedArms(
      operationsOf(
        RUN,
        [
          step({ functionId: 0, name: 'parse_claim' }),
          step({
            functionId: 1,
            name: 'how_big.r1',
            output: serialized({ amount: 900 }),
          }),
        ],
        IR,
      ),
      IR,
    );

    expect(arms.get('how_big')).toBe('large');
  });

  it('takes the fall-through where no case matches', () => {
    const arms = decidedArms(
      operationsOf(
        RUN,
        [step({ name: 'how_big', output: serialized({ amount: 12 }) })],
        IR,
      ),
      IR,
    );

    expect(arms.get('how_big')).toBe('small');
  });

  /**
   * A project may configure the portable serializer,
   * or register one this build has never seen, and
   * either writes the value with nothing around it.
   */
  it('reads the arm from a value stored with no envelope', () => {
    const arms = decidedArms(
      operationsOf(
        RUN,
        [step({ name: 'how_big', output: '{"amount":900}' })],
        IR,
      ),
      IR,
    );

    expect(arms.get('how_big')).toBe('large');
  });

  it('reads the arm a person approved', () => {
    const arms = decidedArms(
      operationsOf(
        RUN,
        [
          step({ functionId: 0, name: 'manager_ok.register' }),
          step({
            functionId: 1,
            name: 'DBOS.recv',
            output: serialized([true]),
          }),
          step({ functionId: 2, name: 'manager_ok.clear' }),
        ],
        IR,
      ),
      IR,
    );

    expect(arms.get('manager_ok')).toBe('approved');
  });

  /**
   * The whole reason this is scoped to one round. A
   * loop that decided one way on its first pass and
   * has not decided yet on its second must light
   * both arms again, not the arm it took last time.
   */
  it('says nothing about a decision from an earlier round', () => {
    const arms = decidedArms(
      operationsOf(
        RUN,
        [
          step({
            functionId: 0,
            name: 'charge_each.r1',
            output: serialized({ ok: true }),
          }),
          step({
            functionId: 1,
            name: 'how_big.r1',
            output: serialized({ amount: 900 }),
          }),
          step({ functionId: 2, name: 'charge_each.r2' }),
        ],
        IR,
      ),
      IR,
    );

    expect(arms.has('how_big')).toBe(false);
  });
});
