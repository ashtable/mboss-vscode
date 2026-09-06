import type { Predicate, WorkflowIR, WorkflowNode } from '../core/rules.js';

import type { Operation, OperationOwner } from './reading.js';
import { valueIn } from './rows.js';

/**
 * A run's rows, grouped the way they happened, and
 * the arms it is known to have taken.
 *
 * Both questions are asked of a reading rather than
 * of the ledger: which block each row belongs to is
 * already answered by then, and asking it twice is
 * how the two used to disagree.
 *
 * Browser-safe: no filesystem, no clock, nothing
 * about the project. Whether the project's SDK
 * records timings is the host's question, and
 * arrives as an answer.
 */

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
 * the timings a wait would be drawn from.
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
