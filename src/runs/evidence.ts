import {
  DEFAULT_RETRY,
  type LibFunction,
  type LibManifest,
  type NodeKind,
  type Predicate,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';

import type { Database, OpenDatabase } from './db.js';
import { describeDatabase, type EnvName } from './env.js';
import { runQuery, stepsQuery } from './queries.js';
import { readRun, type Operation } from './reading.js';
import {
  hasRecovered,
  stepError,
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type RunInput,
  type Step,
  type StepError,
  type WorkflowStatusRow,
} from './rows.js';
import type { SessionRun } from './sessionLog.js';

/**
 * Everything the editor knows about one run, as an
 * object an agent can be handed.
 *
 * "Evidence" here is not the word the rest of this
 * area uses. Elsewhere it means what a particular
 * reader happens to hold about a run, and the point
 * of it is that readers hold different things. Here
 * it means one assembled document: what the ledger
 * recorded, what the saved workflow says, what the
 * last scan of the code behind it found, and the
 * few things derived from those — gathered in one
 * place because an agent has none of the three and
 * cannot go and look.
 *
 * Every field comes from one of those four, and a
 * field whose source cannot be named is not here at
 * all. That is the whole rule, and it is what keeps
 * an object built to be persuasive from becoming an
 * object that invents. DBOS records no per-step
 * attempt and no per-step input, so neither is
 * here; a stack is carried as the container wrote
 * it rather than resolved against somebody's source
 * tree; a document edited since the run says so
 * rather than being reconciled.
 *
 * The read is open, read, close. The extension does
 * not run beside the app it is reading, and a
 * connection held past the answer is a slot on
 * somebody's development database for as long as
 * their editor is open.
 */

/**
 * What somebody asked about.
 *
 * A run always; a block or a row when they asked
 * from somewhere that had one selected. The two
 * optional halves are what turns a general question
 * about a run into a question about one part of it.
 */
export type AskAgent = {
  workflowId: string;
  nodeId?: string;
  functionId?: number;
};

export type RunEvidence = RecordedRunEvidence | RefusedRunEvidence;

/**
 * What a read of the ledger for one run came back
 * with: the run, or which kind of nothing.
 *
 * `absent` is a successful read of a ledger that
 * has no such run. `unreachable` is a read that
 * could not be made at all.
 */
export type RunEvidenceRead =
  RecordedRunEvidence | { at: 'absent' } | { at: 'unreachable' };

/** A run the ledger has rows for. */
export type RecordedRunEvidence = {
  at: 'run';

  assembledAt: string;

  reader: EvidenceReader;

  workflow: string;
  workflowId: string;

  /** DBOS's own word for where the run got to,
   *  passed through rather than translated. */
  status: string;

  applicationVersion?: string;
  executorId: string;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  /** The column, which counts dispatches of the
   *  whole run — never a count of tries at a step,
   *  which nothing records. */
  recoveryAttempts: number;

  recovered: boolean;

  input: RunInput;

  error?: RecordedError;

  replayOf?: { workflowId: string; startStep: number };

  focus: Focus;

  /** The first row that threw, repeated out of
   *  `operations` because it is what the question is
   *  usually about. */
  failedStep?: OperationEvidence;

  operations: OperationEvidence[];

  /** How many rows the run wrote, so a run longer
   *  than the object carries has a visible gap
   *  rather than a silent one. */
  operationsTotal: number;

  node?: NodeConfiguration;

  handler?: HandlerSource;

  document: DocumentNote;
};

/**
 * A run that never started.
 *
 * There is no row anywhere for one the ingress
 * refused, so every field here comes from the
 * window's own memory of trying. No workflow id:
 * the one it is filed under was minted here and
 * names nothing in anybody's database.
 */
export type RefusedRunEvidence = {
  at: 'refused';
  assembledAt: string;
  workflow: string;
  refusedAt: string;
  detail: string;
  input: unknown;
};

/** Who read what, and where. */
export type EvidenceReader = {
  by: 'mboss-vscode';
  tables: ['dbos.workflow_status', 'dbos.operation_outputs'];

  /** Host, port and database. A connection string
   *  carries a password and this travels. */
  database: string;

  from: EnvName;
};

/**
 * A failure as it is handed over: the sentence, the
 * stack the container wrote, and whether the step
 * ran out of retries.
 *
 * `errors` is dropped because one entry per attempt
 * is exactly the per-step attempt history nothing
 * may claim, and `frame` because it is a guess at a
 * file on somebody's disk made from the first line
 * of a stack.
 */
export type RecordedError = Omit<StepError, 'errors' | 'frame'>;

/** What the question is about, and how that was
 *  decided. */
export type Focus = {
  nodeId?: string;
  functionId?: number;
  how: 'selected' | 'failed-step' | 'none';
};

/** One recorded row, attributed. */
export type OperationEvidence = {
  functionId: number;
  name: string;
  nodeId?: string;
  owner: 'node' | 'sdk' | 'unmapped';
  state: 'done' | 'failed' | 'waiting';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: RecordedError;
  output?: string;
  outputTruncated?: boolean;
  childWorkflowId?: string;

  /** Whether a fork copied the row rather than the
   *  run writing it. Nothing tells the two apart
   *  yet, so it is absent rather than guessed. */
  reused?: boolean;

  /** Whether the row came back from the ledger after
   *  a crash instead of running again. */
  restored?: boolean;
};

/** A block, as the saved document configures it. */
export type NodeConfiguration = {
  id: string;
  title: string;
  kind: NodeKind;
  handler?: { export: string };
  retry?: {
    maxAttempts: number;
    intervalSeconds: number;
    backoffRate: number;

    /** Whether the document chose these numbers or
     *  simply did not say. */
    declared: boolean;
  };
  forEach?: { itemsPath: string; concurrency: number };
  guard?: Predicate;
  in?: string;
  out?: string;
};

/**
 * The code behind the block, as the last scan found
 * it.
 *
 * `line` is where the function is *declared* — the
 * scan reads the code, not the run, and nothing
 * here claims to know which line threw.
 */
export type HandlerSource = {
  export: string;
  inManifest: boolean;
  file?: string;
  line?: number;
  signature?: string;
  externalCalls?: { callee: string; via: string; line: number }[];
};

/** Whether the workflow the run was of is still
 *  saved, and at which revision. */
export type DocumentNote = { found: boolean; revision?: number };

/**
 * How many rows travel.
 *
 * A run that loops a thousand times would otherwise
 * fill a prompt with rows nobody asked about. The
 * cap is on the ordinary rows only — the row that
 * failed and the rows of the block in focus travel
 * wherever they sit.
 */
export const OPERATIONS_KEPT = 100;

export type EvidenceDeps = {
  open: OpenDatabase;

  /** The workflow as it is saved now, or nothing
   *  where the project no longer has one of that
   *  name. */
  document(name: string): WorkflowIR | undefined;

  manifest(): LibManifest | undefined;
};

/**
 * The run, read and assembled — or which kind of
 * nothing the read came back with.
 *
 * The two nothings are different sentences to a
 * person: a run the ledger holds no row for is a
 * fact about the run, and a database that would not
 * answer is a fact about this window. Whoever asked
 * writes one of them into a transcript somebody
 * reads and may act on, so they cannot arrive here
 * as one answer.
 *
 * Nothing here throws. Whoever asked has other ways
 * to answer a question about a run, and an
 * exception out of this would take those with it.
 */
export async function assembleRunEvidence(
  deps: EvidenceDeps,
  ledger: { url: string; from: EnvName },
  ask: AskAgent,
): Promise<RunEvidenceRead> {
  const found = await ledgerRead(deps.open, ledger.url, ask.workflowId);
  if (found.at !== 'read') return found;

  // One clock, read once: the moment the object says
  // it was assembled is the same moment its rows
  // were judged against.
  const now = Date.now();
  const { run, steps } = found;

  const ir = deps.document(run.name);

  // `lost` rather than `unasked`: the document was
  // asked for, so a row naming a block it does not
  // have is honestly unmapped rather than merely
  // unchecked.
  const reading = readRun(run, steps, ir ?? 'lost', hasRecovered(run), now);

  const failed = reading.steps.find((one) => one.state === 'failed');
  const focus = focusOf(ask, failed);
  const node =
    focus.nodeId === undefined
      ? undefined
      : ir?.nodes.find((one) => one.id === focus.nodeId);
  const handler = handlerSource(node, deps.manifest());
  const error = recordedError(stepError(run.failure));
  const duration = durationOf(run.startedAt, run.completedAt);

  return {
    at: 'run',
    assembledAt: moment(now),
    reader: {
      by: 'mboss-vscode',
      tables: ['dbos.workflow_status', 'dbos.operation_outputs'],
      database: describeDatabase(ledger.url),
      from: ledger.from,
    },
    workflow: run.name,
    workflowId: run.workflowId,
    status: run.status,
    ...(run.applicationVersion === undefined
      ? {}
      : { applicationVersion: run.applicationVersion }),
    executorId: run.executorId,
    createdAt: moment(run.createdAt),
    ...(run.startedAt === undefined
      ? {}
      : { startedAt: moment(run.startedAt) }),
    ...(run.completedAt === undefined
      ? {}
      : { completedAt: moment(run.completedAt) }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    recoveryAttempts: run.recoveryAttempts,
    recovered: reading.recovered,
    input: run.input ?? { shape: 'none' },
    ...(error === undefined ? {} : { error }),
    ...(run.forkedFrom === undefined
      ? {}
      : {
          replayOf: {
            workflowId: run.forkedFrom,
            startStep: startStepOf(run, steps),
          },
        }),
    focus,
    ...(failed === undefined ? {} : { failedStep: operationOf(failed) }),
    operations: kept(reading.steps, focus).map(operationOf),
    operationsTotal: reading.steps.length,
    ...(node === undefined ? {} : { node: configurationOf(node) }),
    ...(handler === undefined ? {} : { handler }),
    document: {
      found: ir !== undefined,
      ...(ir === undefined ? {} : { revision: ir.revision }),
    },
  };
}

/**
 * A run the app refused to start, as the session
 * log remembers it.
 *
 * The reason it was refused is the whole of what
 * this has to say, and a refused row always carries
 * one — it is the only thing recorded about it. The
 * empty string is for the row that somehow has
 * none, because a sentence invented here would be
 * the object making something up.
 */
export function refusedRunEvidence(run: SessionRun): RefusedRunEvidence {
  return {
    at: 'refused',
    assembledAt: moment(Date.now()),
    workflow: run.workflow,
    refusedAt: moment(run.startedAt),
    detail: run.error ?? '',
    input: run.input,
  };
}

/**
 * The run and its rows, from a connection opened
 * for exactly this.
 *
 * A row that is not there and a database that would
 * not answer are told apart, because they are told
 * apart where this is read: one of them earns a
 * sentence saying the read failed, and the other is
 * an ordinary answer to an ordinary question.
 */
async function ledgerRead(
  open: OpenDatabase,
  url: string,
  workflowId: string,
): Promise<
  { at: 'read'; run: Run; steps: Step[] } | { at: 'absent' | 'unreachable' }
> {
  let db: Database | undefined;

  try {
    db = await open(url);

    const one = runQuery(workflowId);
    const rows = await db.query<WorkflowStatusRow>(one.text, one.values);
    const row = rows[0];
    if (row === undefined) return { at: 'absent' };

    const recorded = stepsQuery(workflowId);

    return {
      at: 'read',
      run: toRun(row),
      steps: (
        await db.query<OperationOutputRow>(recorded.text, recorded.values)
      ).map(toStep),
    };
  } catch {
    return { at: 'unreachable' };
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/**
 * What the question is about.
 *
 * A selection beats an inference: somebody who
 * clicked a block asked about that block, even on a
 * run that failed somewhere else. With nothing
 * selected the failure is the obvious subject, and
 * with neither there is no subject and the object
 * says so rather than picking one.
 */
function focusOf(ask: AskAgent, failed: Operation | undefined): Focus {
  if (ask.nodeId !== undefined || ask.functionId !== undefined) {
    return {
      ...(ask.nodeId === undefined ? {} : { nodeId: ask.nodeId }),
      ...(ask.functionId === undefined ? {} : { functionId: ask.functionId }),
      how: 'selected',
    };
  }

  if (failed === undefined) return { how: 'none' };

  return {
    ...(failed.nodeId === undefined ? {} : { nodeId: failed.nodeId }),
    functionId: failed.functionId,
    how: 'failed-step',
  };
}

/**
 * Which rows travel, when a run wrote more of them
 * than the object carries.
 *
 * The last hundred, because that is where a run has
 * got to — and, wherever they sit, every row that
 * failed and every row of the block in focus,
 * because those are the question itself. Kept in the
 * order DBOS numbered them, which is the order they
 * ran in.
 */
function kept(
  operations: readonly Operation[],
  focus: Focus,
): readonly Operation[] {
  const tail = Math.max(operations.length - OPERATIONS_KEPT, 0);

  return operations.filter(
    (one, index) =>
      index >= tail || one.state === 'failed' || inFocus(one, focus),
  );
}

function inFocus(operation: Operation, focus: Focus): boolean {
  return (
    (focus.nodeId !== undefined && operation.nodeId === focus.nodeId) ||
    (focus.functionId !== undefined &&
      operation.functionId === focus.functionId)
  );
}

/**
 * One row, as it is handed over.
 *
 * What did not happen is left out rather than
 * stated as false, so that everything in the object
 * is something the ledger said.
 */
function operationOf(operation: Operation): OperationEvidence {
  const error = recordedError(operation.error);
  const duration = durationOf(operation.startedAt, operation.completedAt);

  return {
    functionId: operation.functionId,
    name: operation.name,
    ...(operation.nodeId === undefined ? {} : { nodeId: operation.nodeId }),
    owner: operation.owner,
    state: operation.state,
    ...(operation.startedAt === undefined
      ? {}
      : { startedAt: moment(operation.startedAt) }),
    ...(operation.completedAt === undefined
      ? {}
      : { completedAt: moment(operation.completedAt) }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    ...(error === undefined ? {} : { error }),
    ...(operation.output === undefined ? {} : { output: operation.output }),
    ...(operation.outputCut ? { outputTruncated: true } : {}),
    ...(operation.childWorkflowId === undefined
      ? {}
      : { childWorkflowId: operation.childWorkflowId }),
    ...(operation.restored ? { restored: true } : {}),
  };
}

/**
 * The failure, with the two things that are not
 * evidence taken out.
 *
 * Written field by field rather than by spreading
 * what is left, so that a field added to the stored
 * shape has to be decided about here instead of
 * arriving in the object unread.
 */
function recordedError(
  error: StepError | undefined,
): RecordedError | undefined {
  if (error === undefined) return undefined;

  return {
    ...(error.name === undefined ? {} : { name: error.name }),
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    retriesExhausted: error.retriesExhausted,
  };
}

/** The block, as the document configures it. */
function configurationOf(node: WorkflowNode): NodeConfiguration {
  const retry = retryOf(node);

  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    ...(node.handler === undefined
      ? {}
      : { handler: { export: node.handler.export } }),
    ...(retry === undefined ? {} : { retry }),
    // A queue block runs its handler over a list
    // too, but on a queue rather than through
    // `forEach` — the field is not on that kind at
    // all, so there is nothing here to read.
    ...(node.kind === 'queue' || node.forEach === undefined
      ? {}
      : { forEach: node.forEach }),
    ...(node.guard === undefined ? {} : { guard: node.guard }),
    ...(node.in === undefined ? {} : { in: node.in }),
    ...(node.out === undefined ? {} : { out: node.out }),
  };
}

/**
 * The policy the block ran under, and whether
 * anybody chose it.
 *
 * A transaction has none. It runs inside the app's
 * own transaction, whose config carries an
 * isolation level, a read-only flag and a name and
 * nothing at all about retries — so a policy stated
 * for one would describe something that never ran.
 */
function retryOf(node: WorkflowNode): NodeConfiguration['retry'] {
  if (node.kind === 'transaction') return undefined;

  return {
    ...(node.retry ?? DEFAULT_RETRY),
    declared: node.retry !== undefined,
  };
}

/**
 * The code behind the block, where the block names
 * one.
 *
 * An export the scan does not have is said to be
 * missing rather than left out: between the run and
 * this reading somebody may have renamed it, and
 * that is one of the more useful things the object
 * can say.
 */
function handlerSource(
  node: WorkflowNode | undefined,
  manifest: LibManifest | undefined,
): HandlerSource | undefined {
  const named = node?.handler?.export;
  if (named === undefined) return undefined;

  const found = manifest?.functions.find((one) => one.export === named);
  if (found === undefined) return { export: named, inManifest: false };

  return {
    export: named,
    inManifest: true,
    file: found.file,
    ...(found.line === undefined ? {} : { line: found.line }),
    signature: signatureOf(found),
    ...(found.externalCalls === undefined
      ? {}
      : { externalCalls: found.externalCalls }),
  };
}

/** The function as it is declared, in one line. */
function signatureOf(found: LibFunction): string {
  const params = found.params
    .map(
      (param) =>
        `${param.name}${param.optional === true ? '?' : ''}: ${param.type}`,
    )
    .join(', ');

  return `${found.export}(${params}): ${found.returnType}`;
}

/**
 * The step a replay started from.
 *
 * A fork copies every row below the boundary, the
 * SDK's own included, and the copies keep the
 * moments they were first written with — so a row
 * that completed before this run was created is one
 * of them, and the first row this run wrote for
 * itself is one past the last of those.
 */
function startStepOf(run: Run, steps: readonly Step[]): number {
  let last = -1;

  for (const step of steps) {
    if (step.completedAt !== undefined && step.completedAt < run.createdAt) {
      last = Math.max(last, step.functionId);
    }
  }

  return last + 1;
}

function durationOf(
  from: number | undefined,
  to: number | undefined,
): number | undefined {
  return from === undefined || to === undefined ? undefined : to - from;
}

/** Epoch milliseconds as a moment an agent can
 *  read, which is the only form of time this object
 *  carries. */
function moment(at: number): string {
  return new Date(at).toISOString();
}
