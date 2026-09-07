import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRY,
  type LibManifest,
  type WorkflowIR,
} from '../core/rules.js';
import { RUN_ROW, STEP_ROW, database } from '../test-support/runs.js';

import type { EnvName } from './env.js';
import {
  OPERATIONS_KEPT,
  assembleRunEvidence,
  refusedRunEvidence,
  type EvidenceDeps,
  type RecordedRunEvidence,
} from './evidence.js';
import {
  OUTPUT_KEPT,
  type OperationOutputRow,
  type WorkflowStatusRow,
} from './rows.js';
import type { SessionRun } from './sessionLog.js';

/**
 * What a run hands an agent that is asked about it.
 *
 * Driven against a database double answering the
 * two statements the read makes, a hand-built
 * document and a hand-built manifest — no Postgres.
 * The object is assembled out of three readers that
 * disagree with each other by design, so most of
 * what is checked here is which reader each field
 * came from and what is said when one of them has
 * nothing.
 */

/** A connection string with a password in it, so
 *  the reader can be asked to keep one out. */
const LEDGER: { url: string; from: EnvName } = {
  url: 'postgres://app:hunter2@db.local:5432/runs',
  from: 'DBOS_SYSTEM_DATABASE_URL',
};

/**
 * The workflow as it is saved now.
 *
 * Three blocks, because three questions turn on the
 * kind: a step that declares a retry policy, a
 * transaction that can have none, and a step that
 * declares neither policy nor handler.
 */
const DOCUMENT: WorkflowIR = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 7,
  name: 'groom_booking',
  title: 'Groom booking',
  nodes: [
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      config: {},
      handler: { export: 'parseRequest' },
      in: 'BookingRequest',
      out: 'Booking',
      retry: { maxAttempts: 5, intervalSeconds: 2, backoffRate: 3 },
      forEach: { itemsPath: 'bookings', concurrency: 2 },
      guard: { path: 'booking.paid', op: 'exists' },
    },
    {
      id: 'charge_card',
      kind: 'transaction',
      title: 'Charge card',
      config: {},
      handler: { export: 'chargeCard' },
    },
    { id: 'find_slot', kind: 'step', title: 'Find slot', config: {} },
  ],
  edges: [],
};

/** The code behind it, as the last scan read it —
 *  one of the two handlers the document names. */
const MANIFEST: LibManifest = {
  scannedAt: '2026-01-01T09:00:00.000Z',
  sourceHash: 'b2f4',
  functions: [
    {
      export: 'parseRequest',
      file: 'lib/booking.ts',
      params: [{ name: 'request', type: 'BookingRequest' }],
      returnType: 'Booking',
      line: 12,
      externalCalls: [{ callee: 'fetch', via: 'globalThis', line: 18 }],
    },
  ],
  types: [],
  typeSources: {},
  nonSerializable: [],
  errors: [],
};

/** One recorded row, with a default for everything
 *  a case is not saying anything about. */
function stepRow(over: Partial<OperationOutputRow> = {}): OperationOutputRow {
  return { ...STEP_ROW, ...over };
}

const STACK =
  'PaymentError: card declined\n    at charge (/app/lib/pay.ts:31:9)';

/** An error as DBOS's richer serializer stored it,
 *  attempts and stack and all. */
function storedError(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'PaymentError',
    message: 'card declined',
    stack: STACK,
    ...over,
  });
}

type Over = {
  run?: Partial<WorkflowStatusRow>;

  steps?: OperationOutputRow[];

  /** The project no longer has the document, or the
   *  scan has no manifest to give. */
  lostDocument?: boolean;
  lostManifest?: boolean;

  ask?: { nodeId?: string; functionId?: number };
};

/** The three readers, over hand-built rows. */
function reading(over: Over = {}): {
  db: ReturnType<typeof database>;
  deps: EvidenceDeps;
} {
  const db = database();

  db.rows = [{ ...RUN_ROW, ...over.run }];
  db.steps = over.steps ?? [stepRow()];

  return {
    db,
    deps: {
      open: async () => db,
      document: (name) =>
        over.lostDocument === true || name !== DOCUMENT.name
          ? undefined
          : DOCUMENT,
      manifest: () => (over.lostManifest === true ? undefined : MANIFEST),
    },
  };
}

/** The evidence, or a failure saying the read
 *  answered nothing — which every case here but two
 *  is assuming it did not. */
async function recorded(over: Over = {}): Promise<RecordedRunEvidence> {
  const found = await assembleRunEvidence(reading(over).deps, LEDGER, {
    workflowId: RUN_ROW.workflow_uuid,
    ...over.ask,
  });

  if (found?.at !== 'run') throw new Error('the ledger answered nothing');

  return found;
}

/** Every key in a serialized object, however deep
 *  it sits. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, held]) => [key, ...keysIn(held)]);
}

/** The keys anywhere in it that say anything about
 *  attempts, once each and in a fixed order. */
function attemptKeys(evidence: RecordedRunEvidence): string[] {
  const found: unknown = JSON.parse(JSON.stringify(evidence));

  return [
    ...new Set(keysIn(found).filter((key) => /attempt/i.test(key))),
  ].sort();
}

/**
 * Where each field comes from: the ledger's rows,
 * the saved document, the scanned manifest, the
 * session log, or a derivation over those.
 *
 * A field this table cannot name is a field the
 * object must not carry, so the table is the
 * assertion rather than a note beside one.
 */
const PROVENANCE: Record<string, 'ledger' | 'ir' | 'manifest' | 'derived'> = {
  at: 'derived',
  assembledAt: 'derived',
  reader: 'derived',
  workflow: 'ledger',
  workflowId: 'ledger',
  status: 'ledger',
  applicationVersion: 'ledger',
  executorId: 'ledger',
  createdAt: 'ledger',
  startedAt: 'ledger',
  completedAt: 'ledger',
  durationMs: 'derived',
  recoveryAttempts: 'ledger',
  recovered: 'derived',
  input: 'ledger',
  error: 'ledger',
  replayOf: 'derived',
  focus: 'derived',
  failedStep: 'derived',
  operations: 'derived',
  operationsTotal: 'ledger',
  node: 'ir',
  handler: 'manifest',
  document: 'ir',
};

/** A run with something to say under every field
 *  the table names: it failed, it was replayed from
 *  another, and the block it failed on is one the
 *  document and the manifest both still have. */
const EVERYTHING: Over = {
  run: {
    status: 'ERROR',
    error: storedError(),
    forked_from: 'wf_parent',
    was_forked_from: false,
  },
  steps: [stepRow({ error: storedError() })],
};

describe('the evidence a run hands the agent', () => {
  /**
   * DBOS records no per-step attempt anywhere, so a
   * count of tries on a row would be the object
   * making one up. The column that does exist
   * counts dispatches of the whole run.
   */
  it('carries no key about attempts except recoveryAttempts', async () => {
    expect(attemptKeys(await recorded({ lostDocument: true }))).toEqual([
      'recoveryAttempts',
    ]);

    // The one word that joins it once a block is in
    // focus is the policy that block was configured
    // with, which is a fact about the document and
    // not about the run.
    expect(
      attemptKeys(await recorded({ ask: { nodeId: 'parse_request' } })),
    ).toEqual(['maxAttempts', 'recoveryAttempts']);
  });

  it('names every field’s provenance or leaves it out', async () => {
    const found = await recorded(EVERYTHING);

    expect(Object.keys(found).sort()).toEqual(Object.keys(PROVENANCE).sort());
  });

  /**
   * A wait the SDK wrote is what fills a hole that
   * would otherwise read as a crash, so the rows
   * travel — said to be the SDK's so nobody reads
   * one as a block of the workflow's own.
   */
  it('keeps DBOS’s own rows and marks them sdk-owned', async () => {
    const found = await recorded({
      steps: [
        stepRow({ function_id: 0, function_name: 'parse_request' }),
        stepRow({ function_id: 1, function_name: 'DBOS.sleep' }),
      ],
    });

    expect(found.operations[1]).toMatchObject({
      name: 'DBOS.sleep',
      owner: 'sdk',
    });
    expect(found.operations[1]).not.toHaveProperty('nodeId');
  });

  it('marks a row naming a block the document lacks as unmapped', async () => {
    const found = await recorded({
      steps: [stepRow({ function_name: 'vanished_block' })],
    });

    expect(found.operations[0]?.owner).toBe('unmapped');
    expect(found.operations[0]).not.toHaveProperty('nodeId');
  });

  /**
   * A transaction's config carries an isolation
   * level, a read-only flag and a name, and nothing
   * at all about retries — so a policy printed for
   * one would describe something that never ran.
   */
  it('carries no retry for a transaction', async () => {
    const found = await recorded({ ask: { nodeId: 'charge_card' } });

    expect(found.node?.kind).toBe('transaction');
    expect(found.node).not.toHaveProperty('retry');
  });

  it('reports the default retry with declared false', async () => {
    const found = await recorded({ ask: { nodeId: 'find_slot' } });

    expect(found.node?.retry).toEqual({ ...DEFAULT_RETRY, declared: false });

    const chosen = await recorded({ ask: { nodeId: 'parse_request' } });

    expect(chosen.node?.retry).toEqual({
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 3,
      declared: true,
    });
  });

  /**
   * Code moves between a run and the reading of it,
   * and an export the scan cannot find is a fact
   * worth handing over rather than a reason to say
   * nothing about the handler at all.
   */
  it('says a handler the manifest lacks is not in it', async () => {
    const found = await recorded({ ask: { nodeId: 'charge_card' } });

    expect(found.handler).toEqual({ export: 'chargeCard', inManifest: false });
  });

  it('cuts a long output and says it was cut', async () => {
    const found = await recorded({
      steps: [stepRow({ output: 'x'.repeat(OUTPUT_KEPT + 500) })],
    });

    expect(found.operations[0]?.output).toHaveLength(OUTPUT_KEPT);
    expect(found.operations[0]?.outputTruncated).toBe(true);
  });

  /**
   * The last hundred rows are where a long run has
   * got to, but the row that failed and the rows of
   * the block somebody asked about are the question
   * itself, wherever they sit.
   */
  it('keeps the first failed row and the focus rows past the cap', async () => {
    const total = OPERATIONS_KEPT + 20;
    const found = await recorded({
      ask: { nodeId: 'find_slot' },
      steps: Array.from({ length: total }, (_unused, index) =>
        stepRow({
          function_id: index,
          function_name: index === 3 ? 'find_slot' : 'parse_request',
          ...(index === 0 ? { error: storedError() } : {}),
        }),
      ),
    });

    expect(found.operationsTotal).toBe(total);
    expect(found.operations).toHaveLength(OPERATIONS_KEPT + 2);
    expect(found.operations.slice(0, 3).map((one) => one.functionId)).toEqual([
      0, 3, 20,
    ]);
  });

  it('reads an input in each of its three shapes', async () => {
    const payload = await recorded({
      run: { inputs: '[{"email":"ada@example.com"}]' },
    });
    const raw = await recorded({ run: { inputs: 'not json at all' } });
    const none = await recorded({ run: { inputs: null } });

    expect(payload.input).toEqual({
      shape: 'payload',
      value: { email: 'ada@example.com' },
    });
    expect(raw.input).toEqual({ shape: 'raw', text: 'not json at all' });
    expect(none.input).toEqual({ shape: 'none' });
  });

  it('says how the focus was chosen, in each of its three cases', async () => {
    const selected = await recorded({ ask: { nodeId: 'find_slot' } });
    const failed = await recorded({
      steps: [stepRow({ function_id: 4, error: storedError() })],
    });
    const neither = await recorded();

    expect(selected.focus).toEqual({ nodeId: 'find_slot', how: 'selected' });
    expect(failed.focus).toEqual({
      nodeId: 'parse_request',
      functionId: 4,
      how: 'failed-step',
    });
    expect(neither.focus).toEqual({ how: 'none' });
  });

  /**
   * One entry per attempt is the per-step attempt
   * history the object may not carry, and the frame
   * is a guess about somebody's source tree. The
   * stack itself travels, as the container wrote
   * it — the last attempt's, which is already the
   * headline a step that ran out of retries is read
   * with.
   */
  it('drops the attempt list and the frame from a recorded error', async () => {
    const found = await recorded({
      steps: [
        stepRow({
          error: storedError({
            errors: [
              { message: 'no answer from the gateway' },
              { name: 'PaymentError', message: 'card declined', stack: STACK },
            ],
          }),
        }),
      ],
    });

    expect(found.operations[0]?.error).toEqual({
      name: 'PaymentError',
      message: 'card declined',
      stack: expect.stringContaining('/app/lib/pay.ts:31:9'),
      retriesExhausted: true,
    });
  });

  /**
   * A document edited since the run and a manifest
   * that never scanned the handler are the ordinary
   * state of a project, not a reason to hand the
   * agent nothing.
   */
  it('assembles even when the document and the code have moved', async () => {
    const moved = await recorded({
      lostManifest: true,
      ask: { nodeId: 'parse_request' },
      steps: [stepRow({ function_name: 'vanished_block' })],
    });

    expect(moved.document).toEqual({ found: true, revision: 7 });
    expect(moved.handler?.inManifest).toBe(false);
    expect(moved.operations[0]?.owner).toBe('unmapped');

    const gone = await recorded({ lostDocument: true, lostManifest: true });

    expect(gone.document).toEqual({ found: false });
    expect(gone).not.toHaveProperty('node');
    expect(gone).not.toHaveProperty('handler');
  });

  /**
   * The object goes to an agent and from there into
   * a transcript somebody may paste, so the
   * connection string is described from the parts
   * that are safe rather than trimmed down from the
   * whole.
   */
  it('describes the ledger it read without the password', async () => {
    const found = await recorded();

    expect(found.reader).toEqual({
      by: 'mboss-vscode',
      tables: ['dbos.workflow_status', 'dbos.operation_outputs'],
      database: 'db.local:5432/runs',
      from: 'DBOS_SYSTEM_DATABASE_URL',
    });
    expect(JSON.stringify(found)).not.toContain('hunter2');
  });

  it('answers nothing when the ledger has no such run', async () => {
    const { deps, db } = reading();
    db.rows = [];

    const found = await assembleRunEvidence(deps, LEDGER, {
      workflowId: 'wf_gone',
    });

    expect(found).toBeUndefined();
  });

  /**
   * The extension does not run alongside the app it
   * is reading, so a connection held past the read
   * is a slot on somebody's development database
   * for as long as their editor is open.
   */
  it('closes the connection whatever the read did', async () => {
    const { deps, db } = reading();

    await assembleRunEvidence(deps, LEDGER, {
      workflowId: RUN_ROW.workflow_uuid,
    });

    expect(db.closed).toBe(1);

    db.fail = 'the database went away';
    const failed = await assembleRunEvidence(deps, LEDGER, {
      workflowId: RUN_ROW.workflow_uuid,
    });

    expect(failed).toBeUndefined();
    expect(db.closed).toBe(2);
  });
});

describe('a run the ingress refused', () => {
  /**
   * There is no row anywhere for a run that never
   * started, so the window's own memory of trying is
   * the whole of the evidence.
   */
  it('answers refused evidence from the session row', () => {
    const refused: SessionRun = {
      workflowId: 'refused_1767268800000',
      workflow: 'groom_booking',
      input: { email: 'ada@example.com' },
      startedAt: Date.parse('2026-01-01T12:00:00Z'),
      outcome: 'failed',
      stepCount: 0,
      error: 'the app refused the request: 401',
      recovered: false,
    };

    expect(refusedRunEvidence(refused)).toEqual({
      at: 'refused',
      assembledAt: expect.any(String),
      workflow: 'groom_booking',
      refusedAt: '2026-01-01T12:00:00.000Z',
      detail: 'the app refused the request: 401',
      input: { email: 'ada@example.com' },
    });
  });
});
