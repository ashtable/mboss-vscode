import { describe, expect, it } from 'vitest';

import { queuedWorkflowName, type WorkflowIR } from '../core/rules.js';

import { decidedArms, groupsOf } from './operations.js';
import { readRun, type Operation } from './reading.js';
import { errorIn, type Run, type Step } from './rows.js';

/**
 * A run's rows, grouped the way they happened, and
 * the arms it is known to have taken.
 *
 * The grouping is in ledger order and never
 * reordered. A block that ran twice gets two
 * groups; folding them into one would say the run
 * did something it did not do.
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
  return readRun(run, steps, ir ?? 'lost', false, NOW).steps;
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

/** Rows in the order DBOS numbered them, which is
 *  the order they ran in. */
function ledger(...names: (string | Partial<Step>)[]): Step[] {
  return names.map((one, index) =>
    step({
      functionId: index,
      ...(typeof one === 'string' ? { name: one } : { name: '', ...one }),
    }),
  );
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

/** The name a queue block's own rows are recorded
 *  under, which is the name its children register
 *  as. */
const QUEUED = queuedWorkflowName('index_pages', RUN.name);

describe('how the rows group', () => {
  /**
   * An SDK row is attributed by position: it fell
   * inside what a block was doing, which is all the
   * ledger says about it. The raw view says so out
   * loud rather than pretending it is the block's.
   */
  it('keeps a DBOS-owned row in the group it fell inside', () => {
    const groups = groupsOf(
      operationsOf(
        RUN,
        ledger('manager_ok.register', 'DBOS.recv', 'manager_ok.clear'),
        IR,
      ),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.nodeId).toBe('manager_ok');
    expect(groups[0]?.operations.map((one) => one.owner)).toEqual([
      'node',
      'sdk',
      'node',
    ]);
  });

  it('counts getStatus as DBOS own', () => {
    const groups = groupsOf(
      operationsOf(RUN, ledger('parse_claim', 'getStatus'), IR),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.operations[1]?.owner).toBe('sdk');
  });

  it('opens a group of its own for an SDK row nothing precedes', () => {
    const groups = groupsOf(
      operationsOf(RUN, ledger('DBOS.getEvent', 'parse_claim'), IR),
    );

    expect(groups.map((group) => group.nodeId)).toEqual([
      undefined,
      'parse_claim',
    ]);
    expect(groups[0]?.owner).toBe('sdk');
  });

  /**
   * A block a loop went round twice did two
   * different things, in order, with other blocks
   * between. One group would say it did one.
   */
  it('gives a block a group per round it went', () => {
    const groups = groupsOf(
      operationsOf(
        RUN,
        ledger('charge_each.r1', 'how_big.r1', 'charge_each.r2'),
        IR,
      ),
    );

    expect(groups.map((group) => group.nodeId)).toEqual([
      'charge_each',
      'how_big',
      'charge_each',
    ]);
    expect(groups.map((group) => group.round)).toEqual([1, 1, 2]);
  });

  /**
   * A fan-out is one thing the block did, however
   * many items it did it to — so one group, with the
   * count.
   */
  it('gives a fan-out one group and an item count', () => {
    const groups = groupsOf(
      operationsOf(
        RUN,
        ledger('charge_each[0]', 'charge_each[1]', 'charge_each[2]'),
        IR,
      ),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toBe(3);
    expect(groups[0]?.operations).toHaveLength(3);
  });

  /**
   * A queue block hands every item over in one turn,
   * however many items there are, and waits for all
   * of them there. One group, then — and it holds
   * both the ids of the runs it started and the
   * SDK's own rows for the waiting.
   */
  it('gives a queue block one group, however many it handed over', () => {
    const groups = groupsOf(
      operationsOf(
        RUN,
        ledger(
          { name: QUEUED, childWorkflowId: 'wf_c1' },
          { name: QUEUED, childWorkflowId: 'wf_c2' },
          { name: QUEUED, childWorkflowId: 'wf_c3' },
          'DBOS.getResult',
          'DBOS.getResult',
          'DBOS.getResult',
        ),
        IR,
      ),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.nodeId).toBe('index_pages');
    expect(
      groups[0]?.operations.flatMap((one) =>
        one.childWorkflowId === undefined ? [] : [one.childWorkflowId],
      ),
    ).toEqual(['wf_c1', 'wf_c2', 'wf_c3']);
    expect(
      groups[0]?.operations.filter((one) => one.owner === 'sdk'),
    ).toHaveLength(3);
  });

  /**
   * The option is declared and threaded here and
   * changes nothing yet. What separates the two
   * answers is a group drawn from a sleep row, and
   * that is only drawn where the project's SDK
   * records one.
   */
  /**
   * The moment a block wakes is read off a row the
   * SDK writes beside a wait, and an older SDK
   * writes no such row — so whether it may be read
   * at all is the host's answer, and this file
   * cannot ask.
   */
  it('says when a sleeping block wakes, where it may read timings', () => {
    const found = operationsOf(
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

    expect(groupsOf(found, { timing: true })[0]?.wakesAt).toEqual({
      at: 90_000,
      kind: 'sleep',
    });
  });

  it('says nothing about it where it may not', () => {
    const found = operationsOf(
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

    expect(groupsOf(found, { timing: false })[0]?.wakesAt).toBeUndefined();
    expect(groupsOf(found)[0]?.wakesAt).toBeUndefined();
  });

  /**
   * A zero-width sleep is the marker a timeout
   * leaves: its deadline may never be reached,
   * because the run wakes when somebody answers.
   */
  it('tells a timeout marker from a sleep by its width', () => {
    const found = operationsOf(
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

    expect(groupsOf(found, { timing: true })[0]?.wakesAt).toEqual({
      at: 90_000,
      kind: 'timeout',
    });
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
