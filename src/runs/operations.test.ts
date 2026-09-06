import { describe, expect, it } from 'vitest';

import type { WorkflowIR } from '../core/rules.js';

import { decidedArms, groupsOf, operationsOf } from './operations.js';
import { errorIn, type Run, type Step } from './rows.js';

/**
 * The ledger read as operations, and grouped the
 * way they happened.
 *
 * Two things are being kept apart here. Which block
 * a row belongs to is a question about the row's
 * name, and the compiler's own grammar answers it.
 * Whether that block is still in the document is a
 * different question, and only the document can
 * answer it — a workflow somebody edited between
 * the run and the reading has rows naming blocks
 * that no longer exist, and a panel that threw on
 * one would be useless exactly when a person needs
 * it.
 *
 * The grouping is in ledger order and never
 * reordered. A block that ran twice gets two
 * groups; folding them into one would say the run
 * did something it did not do.
 */

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
  ],
  edges: [],
} as unknown as WorkflowIR;

describe('what a block recorded', () => {
  it('reads one row as one operation of its block', () => {
    const [only] = operationsOf(RUN, ledger('parse_claim'), IR);

    expect(only?.owner).toBe('node');
    expect(only?.nodeId).toBe('parse_claim');
    expect(only?.segments).toEqual([]);
    expect(only?.state).toBe('done');
  });

  /**
   * A wait writes the mail it sent and the row that
   * says which run is parked, and the SDK writes its
   * own between them. None of those is the block; all
   * of them are what the block did.
   */
  it('reads a parked approval as the rows the SDK writes for it', () => {
    const found = operationsOf(
      RUN,
      ledger('manager_ok.ask', 'manager_ok.register', 'DBOS.sleep'),
      IR,
    );

    expect(found.map((one) => one.owner)).toEqual(['node', 'node', 'sdk']);
    expect(found.map((one) => one.nodeId)).toEqual([
      'manager_ok',
      'manager_ok',
      undefined,
    ]);
    expect(found[1]?.segments).toEqual([{ kind: 'register' }]);
    expect(found[1]?.state).toBe('waiting');
  });

  it('reads an answered approval the same way', () => {
    const found = operationsOf(
      RUN,
      ledger(
        'manager_ok.ask',
        'manager_ok.register',
        'DBOS.recv',
        'manager_ok.clear',
      ),
      IR,
    );

    expect(found.map((one) => one.owner)).toEqual([
      'node',
      'node',
      'sdk',
      'node',
    ]);

    // Cleared, so nothing is parked any more.
    expect(found.every((one) => one.state !== 'waiting')).toBe(true);
  });

  it('carries a failed row to the block that failed', () => {
    const [only] = operationsOf(
      RUN,
      [
        step({
          name: 'parse_claim',
          error: JSON.stringify({ name: 'BadClaim', message: 'no amount' }),
        }),
      ],
      IR,
    );

    expect(only?.state).toBe('failed');
    expect(only?.nodeId).toBe('parse_claim');
    expect(only?.error?.name).toBe('BadClaim');
  });

  /**
   * The name still parses as a block's; the document
   * simply no longer has that block. That is a
   * different answer from a name the grammar cannot
   * read at all, and both come back rather than
   * throwing.
   */
  it('leaves a row naming a block the document lost unattributed', () => {
    const found = operationsOf(RUN, ledger('deleted_block', 'Not A Name'), IR);

    expect(found.map((one) => one.owner)).toEqual(['unmapped', 'unmapped']);
    expect(found.map((one) => one.nodeId)).toEqual([undefined, undefined]);
    expect(found[0]?.name).toBe('deleted_block');
  });

  it('leaves every row unattributed where there is no document', () => {
    const found = operationsOf(RUN, ledger('parse_claim'), undefined);

    expect(found[0]?.owner).toBe('unmapped');
    expect(found[0]?.nodeId).toBeUndefined();
  });
});

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
