import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../core/rules.js';
import {
  TIMER_THEN_ANSWER,
  TIMER_WAKES_AT,
  timerThenAnswerRows,
} from '../test-support/runs.js';

import { readRun } from './reading.js';
import { errorIn, OUTPUT_KEPT, type Run, type Step } from './rows.js';

/**
 * One run, read once.
 *
 * Two things are kept apart here. Which block a row
 * belongs to is a question about the row's name, and
 * the compiler's own grammar answers it. Whether
 * that block is still in the document is a different
 * question, and only the document can answer it — so
 * the three things a reader can know about the
 * drawing get three answers, and the two that used
 * to share `undefined` are pinned side by side.
 *
 * And the clock is a parameter. Every case that
 * turns on one says which moment it is asking about,
 * because the whole point of this module is that one
 * reading is answered about one moment.
 */

/** Later than anything these fixtures record, unless
 *  a case says otherwise. */
const NOW = 1_000_000;

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

/** A claim that asks a person, then branches on how
 *  much it was for. */
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
    { id: 'charge_each', kind: 'step', title: 'Charge', config: {} },
  ],
  edges: [],
} as unknown as WorkflowIR;

describe('what a block recorded', () => {
  it('reads one row as one operation of its block', () => {
    const [only] = readRun(
      RUN,
      ledger('parse_claim'),
      IR,
      false,
      NOW,
      IR,
    ).steps;

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
    const found = readRun(
      RUN,
      ledger('manager_ok.ask', 'manager_ok.register', 'DBOS.sleep'),
      IR,
      false,
      NOW,
      IR,
    ).steps;

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
    const found = readRun(
      RUN,
      ledger(
        'manager_ok.ask',
        'manager_ok.register',
        'DBOS.recv',
        'manager_ok.clear',
      ),
      IR,
      false,
      NOW,
      IR,
    ).steps;

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
    const [only] = readRun(
      RUN,
      [
        step({
          name: 'parse_claim',
          error: JSON.stringify({ name: 'BadClaim', message: 'no amount' }),
        }),
      ],
      IR,
      false,
      NOW,
      IR,
    ).steps;

    expect(only?.state).toBe('failed');
    expect(only?.nodeId).toBe('parse_claim');
    expect(only?.error?.name).toBe('BadClaim');
  });

  /**
   * A reading is where a stored value stops being
   * bytes, so it is where the serializer's wrapper
   * has to come off — before the cut, or a long value
   * arrives on the panel as the wrapper and there is
   * no way back to what the step returned.
   */
  it('opens a long output before cutting it', () => {
    const stored = JSON.stringify({
      json: { note: 'x'.repeat(OUTPUT_KEPT + 3000) },
      __dbos_serializer: 'superjson',
    });

    const found = readRun(
      RUN,
      [step({ name: 'parse_claim', output: stored })],
      IR,
      false,
      NOW,
      IR,
    ).steps;

    expect(found).toHaveLength(1);
    expect(found[0]?.shown).not.toContain('__dbos_serializer');
    expect(found[0]?.shown).toHaveLength(OUTPUT_KEPT);
    expect(found[0]?.outputCut).toBe(true);
    expect(found[0]?.bytes).toBe(stored.length);
  });

  /**
   * The name still parses as a block's; the document
   * simply no longer has that block. That is a
   * different answer from a name the grammar cannot
   * read at all, and both come back rather than
   * throwing.
   */
  it('leaves a row naming a block the document lost unattributed', () => {
    const found = readRun(
      RUN,
      ledger('deleted_block', 'Not A Name'),
      IR,
      false,
      NOW,
      IR,
    ).steps;

    expect(found.map((one) => one.owner)).toEqual(['unmapped', 'unmapped']);
    expect(found.map((one) => one.nodeId)).toEqual([undefined, undefined]);
    expect(found[0]?.name).toBe('deleted_block');
  });

  /**
   * A watch polls a database and never looked for a
   * document. Gating on one nobody consulted would
   * tell the canvas that every row belongs to
   * nothing, and the overlay it paints from these
   * ids would go dark.
   */
  it('keeps a readable name attributed where nobody asked for a document', () => {
    const found = readRun(
      RUN,
      ledger('parse_claim'),
      'unasked',
      false,
      NOW,
      undefined,
    ).steps;

    expect(found[0]?.owner).toBe('node');
    expect(found[0]?.nodeId).toBe('parse_claim');
  });

  it('still cannot attribute a name it cannot read', () => {
    const found = readRun(
      RUN,
      ledger('Not A Name'),
      'unasked',
      false,
      NOW,
      undefined,
    ).steps;

    expect(found[0]?.owner).toBe('unmapped');
    expect(found[0]?.nodeId).toBeUndefined();
  });

  /**
   * The opposite answer, from the opposite evidence.
   * A page that looked and found the project has no
   * document of this name knows every row names a
   * block nobody can click, and says so — which is
   * what draws the trace as one nameless group
   * rather than as blocks that no longer exist.
   */
  it('attributes nothing where the project lost the document', () => {
    const found = readRun(
      RUN,
      ledger('parse_claim'),
      'lost',
      false,
      NOW,
      undefined,
    ).steps;

    expect(found[0]?.owner).toBe('unmapped');
    expect(found[0]?.nodeId).toBeUndefined();
  });

  /**
   * The run is sitting in somebody's inbox whether or
   * not the block is still drawn. The row that says
   * so is the only evidence there is, and it names
   * the block by a name the grammar can still read.
   */
  it('says a block the document lost is parked all the same', () => {
    const found = readRun(
      RUN,
      ledger('deleted_block.register'),
      IR,
      false,
      NOW,
      IR,
    ).steps;

    expect(found[0]?.owner).toBe('unmapped');
    expect(found[0]?.state).toBe('waiting');
  });
});

/**
 * The wait on the clock, which writes no row of its
 * own.
 *
 * It compiles to a bare `await DBOS.sleep(ms)`, so
 * the only evidence the block ran at all is a row
 * carrying the SDK's name and no block id. Nothing
 * in that name says which wait wrote it — two of
 * them in one document write the same string — so
 * where the row fell is the only thing that can,
 * and that is a question about the saved document
 * rather than about the ledger.
 */
describe('a wait the run is sitting out on the clock', () => {
  /** The intake form's own document, which core's
   *  walk gives its park's `DBOS.recv` and
   *  `DBOS.sleep` to the wait. */
  const FORM_INTAKE = WorkflowIRSchema.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../mboss-core/fixtures/ir/form_intake.workflow.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    ),
  );

  /** The same timer document with a second way out
   *  of its trigger, which the compiler refuses to
   *  describe: it follows one wire out of a block. */
  const FORKED = WorkflowIRSchema.parse({
    ...TIMER_THEN_ANSWER,
    edges: [
      ...TIMER_THEN_ANSWER.edges,
      {
        id: 'e3',
        from: { node: 'started_by_hand', port: 'out' },
        to: { node: 'answer_it' },
      },
    ],
  });

  /** While the deadline is still ahead, and after
   *  it has passed. */
  const SLEEPING = TIMER_WAKES_AT - 30_000;
  const WOKEN = TIMER_WAKES_AT + 30_000;

  it('gives its sleep row to the wait that wrote it', () => {
    const [only] = readRun(
      RUN,
      timerThenAnswerRows(),
      TIMER_THEN_ANSWER,
      false,
      SLEEPING,
      TIMER_THEN_ANSWER,
    ).steps;

    expect(only?.owner).toBe('node');
    expect(only?.nodeId).toBe('let_it_wait');
  });

  /**
   * The row records the wake deadline as its
   * completion and is written before the sleep, so
   * the row alone cannot say whether the run is
   * still sitting it out. Only the clock can.
   */
  it('reads the wait as waiting while its deadline is ahead', () => {
    const [only] = readRun(
      RUN,
      timerThenAnswerRows(),
      TIMER_THEN_ANSWER,
      false,
      SLEEPING,
      TIMER_THEN_ANSWER,
    ).steps;

    expect(only?.state).toBe('waiting');
  });

  it('reads it as done once that deadline has passed', () => {
    const found = readRun(
      RUN,
      timerThenAnswerRows({ answered: true }),
      TIMER_THEN_ANSWER,
      false,
      WOKEN,
      TIMER_THEN_ANSWER,
    ).steps;

    expect(found.map((one) => one.nodeId)).toEqual([
      'let_it_wait',
      'answer_it',
    ]);
    expect(found.map((one) => one.state)).toEqual(['done', 'done']);
  });

  /**
   * A watch polls a database and never looked for a
   * document, and it is handed one all the same —
   * so the gate that decides which block ids
   * attribute stays the watch's, and the map is a
   * separate question.
   */
  it('gives it the same row where nobody asked about the drawing', () => {
    const [only] = readRun(
      RUN,
      timerThenAnswerRows(),
      'unasked',
      false,
      SLEEPING,
      TIMER_THEN_ANSWER,
    ).steps;

    expect(only?.owner).toBe('node');
    expect(only?.nodeId).toBe('let_it_wait');
  });

  /**
   * A form wait and an approval park on `DBOS.recv`
   * with a sleep beside it timing the park out.
   * Both already write rows of their own, so handing
   * them the SDK's pair as well would draw one block
   * twice — even though the same walk does say which
   * wait those rows fell inside.
   */
  it('leaves a wait on a form its own rows and the SDK its pair', () => {
    const found = readRun(
      RUN,
      ledger(
        'ask_details',
        'await_details.register',
        'DBOS.recv',
        'DBOS.sleep',
        'await_details.clear',
        'record_intake',
      ),
      FORM_INTAKE,
      false,
      NOW,
      FORM_INTAKE,
    ).steps;

    expect(found.map((one) => one.owner)).toEqual([
      'node',
      'node',
      'sdk',
      'sdk',
      'node',
      'node',
    ]);
  });

  /** Without a document there is nothing to ask
   *  where a row fell, and the sleep is the SDK's,
   *  as it has always been. */
  it('leaves the sleep the SDK own where no document came with it', () => {
    const [only] = readRun(
      RUN,
      timerThenAnswerRows(),
      'unasked',
      false,
      SLEEPING,
      undefined,
    ).steps;

    expect(only?.owner).toBe('sdk');
    expect(only?.nodeId).toBeUndefined();
  });

  /**
   * The compiler refuses a document it cannot
   * describe, and a run of one is still a run. A
   * page that threw over it would go blank exactly
   * where somebody needs to read what happened.
   */
  it('reads the run anyway where the document cannot be described', () => {
    const found = readRun(
      RUN,
      timerThenAnswerRows(),
      FORKED,
      false,
      SLEEPING,
      FORKED,
    ).steps;

    expect(found).toHaveLength(1);
    expect(found[0]?.owner).toBe('sdk');
    expect(found[0]?.nodeId).toBeUndefined();
  });
});

describe('where the run is', () => {
  it('is done when the status says it succeeded', () => {
    const reading = readRun(
      { ...RUN, status: 'SUCCESS' },
      ledger('parse_claim'),
      IR,
      false,
      NOW,
      IR,
    );

    expect(reading.outcome).toBe('done');
  });

  /**
   * Somebody asked for this one. It is not a failure
   * anybody has to look into, and the failed set
   * contains it.
   */
  it('tells a cancelled run from a failed one', () => {
    expect(
      readRun({ ...RUN, status: 'CANCELLED' }, [], IR, false, NOW, IR).outcome,
    ).toBe('cancelled');
    expect(
      readRun({ ...RUN, status: 'ERROR' }, [], IR, false, NOW, IR).outcome,
    ).toBe('failed');
  });

  it('is waiting where a block is parked', () => {
    const reading = readRun(
      RUN,
      ledger('manager_ok.register'),
      IR,
      false,
      NOW,
      IR,
    );

    expect(reading.outcome).toBe('waiting');
  });

  /**
   * A sleep row records its wake deadline as its
   * completion and is never rewritten, so the row
   * alone cannot say whether the run is still
   * sleeping. Only the clock can.
   */
  it('is waiting while a timer it is sitting out is still ahead', () => {
    const asleep = readRun(
      RUN,
      [step({ name: 'DBOS.sleep', startedAt: 1000, completedAt: 90_000 })],
      IR,
      false,
      50_000,
      IR,
    );

    expect(asleep.outcome).toBe('waiting');
  });

  it('is running again once that deadline has passed', () => {
    const woken = readRun(
      RUN,
      [step({ name: 'DBOS.sleep', startedAt: 1000, completedAt: 90_000 })],
      IR,
      false,
      95_000,
      IR,
    );

    expect(woken.outcome).toBe('running');
  });

  /** A run DBOS stopped restarting is over, and it
   *  is not the news a run that threw is. */
  it('says gave up for a run DBOS stopped restarting', () => {
    const dead = { ...RUN, status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' };

    expect(readRun(dead, [], IR, false, NOW, IR).outcome).toBe('gaveUp');
  });

  it('says queued for a run nothing has claimed yet', () => {
    const filed = { ...RUN, status: 'ENQUEUED' };

    expect(readRun(filed, [], IR, false, NOW, IR).outcome).toBe('queued');
  });

  /** The column counts dispatches, so one more than
   *  the first is the first time anything picked the
   *  run back up. */
  it('says recovering for a run something picked back up', () => {
    const again = { ...RUN, recoveryAttempts: 2 };

    expect(
      readRun(again, ledger('parse_claim'), IR, false, NOW, IR).outcome,
    ).toBe('recovering');
  });

  /**
   * Answered once, with every row the page holds,
   * and carried: a header that asked the steps again
   * would get the parked block and miss the timer.
   */
  it('carries whether the run is parked, timers included', () => {
    expect(
      readRun(RUN, ledger('manager_ok.register'), IR, false, NOW, IR).parked,
    ).toBe(true);
    expect(
      readRun(
        RUN,
        [step({ name: 'DBOS.sleep', startedAt: 1000, completedAt: 90_000 })],
        IR,
        false,
        50_000,
        IR,
      ).parked,
    ).toBe(true);
    expect(readRun(RUN, ledger('parse_claim'), IR, false, NOW, IR).parked).toBe(
      false,
    );
  });
});

describe('the window a run is drawn in', () => {
  it('opens where the run started and closes at the last thing that happened', () => {
    const reading = readRun(
      RUN,
      ledger('parse_claim', 'charge_each'),
      IR,
      false,
      NOW,
      IR,
    );

    expect(reading.from).toBe(1000);
    expect(reading.to).toBe(1100);
    expect(reading.outage).toBeUndefined();
  });

  /**
   * Never later than the moment it is being read: a
   * sleeping run records a wake deadline in the
   * future, and taken as the right edge it would
   * squeeze everything that has happened into a
   * sliver.
   */
  it('never closes later than the moment it was read', () => {
    const reading = readRun(
      RUN,
      [step({ name: 'DBOS.sleep', startedAt: 1000, completedAt: 90_000 })],
      IR,
      false,
      50_000,
      IR,
    );

    expect(reading.to).toBe(50_000);
  });

  /**
   * The widest hole on a run DBOS picked back up is
   * the outage, and every row that finished by then
   * came back from the ledger rather than running
   * again.
   */
  it('marks the rows a recovered run brought back', () => {
    const reading = readRun(
      { ...RUN, recoveryAttempts: 2 },
      [
        step({ functionId: 0, name: 'parse_claim', completedAt: 1100 }),
        step({
          functionId: 1,
          name: 'charge_each',
          startedAt: 60_000,
          completedAt: 60_200,
        }),
      ],
      IR,
      true,
      NOW,
      IR,
    );

    expect(reading.outage).toEqual({ from: 1100, to: 60_000 });
    expect(reading.steps.map((one) => one.restored)).toEqual([true, false]);
    expect(reading.recovered).toBe(true);
  });

  it('carries the recovered answer it was handed', () => {
    expect(readRun(RUN, [], IR, true, NOW, IR).recovered).toBe(true);
    expect(readRun(RUN, [], IR, false, NOW, IR).recovered).toBe(false);
  });
});
