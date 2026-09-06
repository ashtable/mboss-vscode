import {
  ownerOf,
  type Predicate,
  type RecordedSegment,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';

import { outputIn, stepError, valueIn, type Run, type Step } from './rows.js';
import { runTimeline } from './timeline.js';
import type { LiveStep } from './watch.js';

/**
 * The ledger, read as operations and grouped the way
 * they happened.
 *
 * Two questions are kept apart here on purpose.
 * Which block a row belongs to is a question about
 * the row's *name*, and the compiler's own grammar
 * answers it without seeing a document. Whether that
 * block still exists is a question about the
 * *document*, and only the document answers it — a
 * workflow somebody edited between the run and the
 * reading has rows naming blocks that are gone, and
 * a panel that threw on one would fail exactly when
 * somebody needs it.
 *
 * So an operation is `unmapped` in two different
 * situations that a reader does not need to tell
 * apart: a name the grammar cannot read, and a name
 * it can read naming a block the document no longer
 * has. Neither is the SDK's own, and neither points
 * at a block anybody can click.
 *
 * Browser-safe: no filesystem, no clock of its own,
 * nothing about the project. Whether the project's
 * SDK records timings is the host's question, and
 * arrives as an answer.
 */

/** Who a recorded row belongs to. */
export type OperationOwner = 'node' | 'sdk' | 'unmapped';

/**
 * One recorded row, drawable.
 *
 * `Omit` rather than an intersection, because an
 * intersection with `nodeId: string | undefined`
 * narrows back to `string` and every unattributed
 * row would then claim to name a block.
 */
export type Operation = Omit<LiveStep, 'nodeId'> & {
  nodeId: string | undefined;

  owner: OperationOwner;

  /** Where inside the block it ran: which round,
   *  which item, which part of a wait. */
  segments: readonly RecordedSegment[];
};

/**
 * One block's turn, with whatever the SDK wrote
 * while it was taking it.
 *
 * A block that ran more than once gets a group per
 * turn, in ledger order. Folding them into one
 * would say the run did once what it did twice, and
 * reordering the ledger to put them side by side
 * would misrepresent when.
 */
export type TraceGroup = {
  nodeId: string | undefined;

  owner: OperationOwner;

  /** Which time round this was, where the rows say
   *  so. */
  round: number | undefined;

  /** How many items a fan-out covered, where it was
   *  one. */
  items: number | undefined;

  /**
   * When the block wakes, or when it gives up
   * waiting.
   *
   * Read off the sleep row the SDK writes: a real
   * sleep records the wake deadline as its
   * completion, so the row has width; a timeout
   * marker records zero width, because its deadline
   * may never be reached. Only ever set where the
   * host has said the project's SDK records these
   * at all.
   */
  wakesAt: { at: number; kind: 'sleep' | 'timeout' } | undefined;

  operations: Operation[];
};

/**
 * Every row of a run, attributed.
 *
 * Takes every row and not only the ones a block
 * owns: what the SDK recorded is what a block was
 * waiting on, and the outage inference needs all of
 * it.
 */
export function operationsOf(
  run: Run,
  all: Step[],
  ir: WorkflowIR | undefined,
): Operation[] {
  const known = new Set(ir?.nodes.map((node) => node.id) ?? []);
  const parked = parkedNodes(all.map((step) => step.name));

  // Over every row, because a wait the SDK wrote
  // fills a hole that would otherwise read as an
  // outage.
  const restored = new Map(
    runTimeline(run, all).steps.map((step) => [step.functionId, step.restored]),
  );

  return all.map((step) => {
    const owner = ownerOf(step.name);
    const output = outputIn(step.output ?? null);
    const nodeId =
      owner.kind === 'node' && known.has(owner.nodeId)
        ? owner.nodeId
        : undefined;
    const failure = stepError(step.failure);

    return {
      name: step.name,
      nodeId,
      owner: ownerFor(owner.kind, nodeId),
      segments: owner.kind === 'node' ? owner.segments : [],
      state:
        failure !== undefined
          ? 'failed'
          : owner.kind === 'node' && parked.has(owner.nodeId)
            ? 'waiting'
            : 'done',
      functionId: step.functionId,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      output: step.output === undefined ? undefined : output.text,
      outputCut: output.cut,
      outputBytes: output.bytes,
      error: failure,
      childWorkflowId: step.childWorkflowId,
      reused:
        run.forkedFrom !== undefined &&
        step.completedAt !== undefined &&
        step.completedAt < run.createdAt,
      restored: restored.get(step.functionId) ?? false,
    };
  });
}

/**
 * The rows, in turns.
 *
 * One walk in the order DBOS numbered them. A row of
 * the block the open group belongs to joins it; any
 * other block's row closes it and opens the next.
 * A row the SDK wrote joins whatever is open,
 * because falling inside a block's turn is the only
 * thing the ledger says about where it belongs —
 * and where nothing is open it gets a group of its
 * own rather than being attached to a block that
 * had not started.
 *
 * `timing` says whether the project's SDK records
 * the timings a wait would be drawn from. It is
 * threaded and changes nothing yet; the group it
 * gates does not exist until something draws it.
 */
export function groupsOf(
  operations: readonly Operation[],
  options: { timing?: boolean } = {},
): TraceGroup[] {
  const groups: TraceGroup[] = [];
  let open: TraceGroup | undefined;

  for (const operation of operations) {
    if (operation.owner === 'sdk' && open !== undefined) {
      open.operations.push(operation);
      continue;
    }

    const round = roundOf(operation);

    if (
      open !== undefined &&
      open.nodeId === operation.nodeId &&
      open.owner === operation.owner &&
      open.round === round
    ) {
      open.operations.push(operation);
      continue;
    }

    open = {
      nodeId: operation.nodeId,
      owner: operation.owner,
      round,
      items: undefined,
      wakesAt: undefined,
      operations: [operation],
    };
    groups.push(open);
  }

  return groups.map((group) => ({
    ...group,
    items: itemsIn(group),
    wakesAt: options.timing === true ? wakesIn(group) : undefined,
  }));
}

/** The moment a sleep row in this group names. */
const SLEEP = 'DBOS.sleep';

/**
 * When a block wakes, out of the sleep row the SDK
 * wrote inside its turn.
 *
 * A real sleep records the wake deadline as its
 * completion, so the row has width. A timeout
 * marker records zero width, because its deadline
 * may never be reached — the run wakes when
 * somebody answers, and only then. Both carry the
 * same number in `output`, and the width is what
 * says which of the two it is.
 *
 * Read as the bytes rather than through `valueIn`,
 * because this one row is not the project's to
 * serialize: the SDK writes its own deadline with
 * the portable serializer whatever the application
 * configured, so the column holds the number and
 * nothing around it.
 */
function wakesIn(group: TraceGroup): TraceGroup['wakesAt'] {
  const row = group.operations.find(
    (one) => one.owner === 'sdk' && one.name === SLEEP,
  );
  if (row === undefined) return undefined;

  const at = Number(row.output);
  if (!Number.isFinite(at)) return undefined;

  return {
    at,
    kind:
      row.completedAt !== undefined &&
      row.startedAt !== undefined &&
      row.completedAt > row.startedAt
        ? 'sleep'
        : 'timeout',
  };
}

/**
 * The blocks a run is parked on.
 *
 * A wait writes `.register` when the run parks and
 * `.clear` when it wakes, and can write a reminder
 * in between — so the question is whether a block's
 * latest registration has been cleared, and not
 * whether its latest row happens to be one.
 */
export function parkedNodes(names: readonly string[]): Set<string> {
  const registered = new Map<string, number>();
  const cleared = new Map<string, number>();

  names.forEach((name, index) => {
    const owner = ownerOf(name);
    if (owner.kind !== 'node') return;

    const last = owner.segments.at(-1)?.kind;

    if (last === 'register') registered.set(owner.nodeId, index);
    if (last === 'clear') cleared.set(owner.nodeId, index);
  });

  const parked = new Set<string>();

  for (const [nodeId, at] of registered) {
    if ((cleared.get(nodeId) ?? -1) < at) parked.add(nodeId);
  }

  return parked;
}

/**
 * Which way out each decided block took, for the
 * round the run is on and no other.
 *
 * Scoped to that round because a loop that decided
 * one way last time and has not decided yet this
 * time must light both arms again. A row from an
 * earlier round is evidence about an earlier round,
 * and drawing it as this one's would tell somebody
 * the run had already gone somewhere it has not.
 */
export function decidedArms(
  operations: readonly Operation[],
  ir: WorkflowIR | undefined,
): ReadonlyMap<string, string> {
  const decided = new Map<string, string>();
  if (ir === undefined) return decided;

  const round = roundOf(operations.findLast((one) => one.owner === 'node'));

  for (const node of ir.nodes) {
    const arm =
      node.kind === 'branch'
        ? branchArm(node, operations, round)
        : node.kind === 'approval'
          ? approvalArm(node, operations, round)
          : undefined;

    if (arm !== undefined) decided.set(node.id, arm);
  }

  return decided;
}

/** The port a branch's own recorded value takes. */
function branchArm(
  node: WorkflowNode,
  operations: readonly Operation[],
  round: number | undefined,
): string | undefined {
  if (node.kind !== 'branch') return undefined;

  const recorded = thisRound(operations, node.id, round).at(-1);
  const value = valueIn(recorded?.output);
  if (value === undefined) return undefined;

  const taken = node.config.cases.find((one) => holds(one.when, value));

  return taken?.port ?? node.config.elsePort;
}

/**
 * The port an approval took, out of the reply the
 * SDK recorded for it.
 *
 * The runtime answers `{ approved: boolean }`, and
 * the row that carries it is the SDK's own, sitting
 * inside what the approval was doing — so it is
 * found by position, between the registration and
 * whatever came next.
 */
function approvalArm(
  node: WorkflowNode,
  operations: readonly Operation[],
  round: number | undefined,
): string | undefined {
  if (node.kind !== 'approval') return undefined;

  const own = thisRound(operations, node.id, round);
  const registered = own.find(
    (one) => one.segments.at(-1)?.kind === 'register',
  );
  if (registered === undefined) return undefined;

  const reply = operations.find(
    (one) => one.owner === 'sdk' && one.functionId > registered.functionId,
  );

  const answer = approvedIn(valueIn(reply?.output));

  return answer === undefined ? undefined : answer ? 'approved' : 'rejected';
}

/** One block's rows from the round the run is on. */
function thisRound(
  operations: readonly Operation[],
  nodeId: string,
  round: number | undefined,
): Operation[] {
  return operations.filter(
    (one) => one.nodeId === nodeId && roundOf(one) === round,
  );
}

/** Whether a predicate holds of a recorded value. */
function holds(predicate: Predicate, value: unknown): boolean {
  const at = valueAt(value, predicate.path);

  switch (predicate.op) {
    case 'eq':
      return at === predicate.value;

    case 'neq':
      return at !== predicate.value;

    case 'gt':
      return compares(at, predicate.value, (a, b) => a > b);

    case 'gte':
      return compares(at, predicate.value, (a, b) => a >= b);

    case 'lt':
      return compares(at, predicate.value, (a, b) => a < b);

    case 'lte':
      return compares(at, predicate.value, (a, b) => a <= b);

    case 'exists':
      return at !== undefined && at !== null;

    case 'nonempty':
      return at !== undefined && at !== null && at !== '';
  }
}

function compares(
  left: unknown,
  right: unknown,
  by: (a: number, b: number) => boolean,
): boolean {
  return (
    typeof left === 'number' && typeof right === 'number' && by(left, right)
  );
}

/** A dotted path into a recorded value. An empty
 *  path is the value itself. */
function valueAt(value: unknown, path: string): unknown {
  if (path === '') return value;

  return path.split('.').reduce<unknown>((held, key) => {
    if (held === null || typeof held !== 'object') return undefined;

    return (held as Record<string, unknown>)[key];
  }, value);
}

/**
 * What an approval's reply says, out of either shape
 * the ledger stores it in: the argument array
 * `DBOS.recv` records, or the object itself.
 */
function approvedIn(value: unknown): boolean | undefined {
  const held = Array.isArray(value) ? value[0] : value;

  if (typeof held === 'boolean') return held;
  if (held === null || typeof held !== 'object') return undefined;

  const approved = (held as { approved?: unknown }).approved;

  return typeof approved === 'boolean' ? approved : undefined;
}

function ownerFor(
  kind: 'node' | 'sdk' | 'unknown',
  nodeId: string | undefined,
): OperationOwner {
  if (kind === 'sdk') return 'sdk';

  return nodeId === undefined ? 'unmapped' : 'node';
}

function roundOf(operation: Operation | undefined): number | undefined {
  const found = operation?.segments.find((one) => one.kind === 'round');

  return found?.kind === 'round' ? found.round : undefined;
}

/** How many items a fan-out covered, or nothing
 *  where it was not one. */
function itemsIn(group: TraceGroup): number | undefined {
  const indexes = new Set(
    group.operations.flatMap((one) =>
      one.segments.flatMap((segment) =>
        segment.kind === 'item' ? [segment.index] : [],
      ),
    ),
  );

  return indexes.size === 0 ? undefined : indexes.size;
}
