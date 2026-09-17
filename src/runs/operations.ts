import type { Predicate, WorkflowIR, WorkflowNode } from '../core/rules.js';

import type { Operation } from './reading.js';
import { valueIn } from './rows.js';

/**
 * What a reading says about a run's sleeps and its
 * decisions: the moment a sleep row names, and the
 * arms the run is known to have taken.
 *
 * Both are asked of a reading rather than of the
 * ledger: which block each row belongs to is
 * already answered by then, and asking it twice is
 * how the two used to disagree.
 *
 * Browser-safe: no filesystem, no clock, nothing
 * about the project. Whether the project's SDK
 * records the rows a wake is read off is the
 * host's question, and its callers ask it.
 */

/** A moment a sleep row names, and whether it is
 *  the moment the run wakes or the moment a wait
 *  gives up. */
export type Wake = { at: number; kind: 'sleep' | 'timeout' };

/** The name the SDK records a sleep under. */
const SLEEP = 'DBOS.sleep';

/**
 * The moment a sleep row names, and nothing for any
 * other row.
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
 *
 * Told by its name and not by its owner. A wait on
 * the clock writes no row of its own, so the reading
 * hands it this one — and asking whose it is would
 * lose the wake at the one block whose whole state
 * is the wake.
 */
export function wakeOf(row: Operation): Wake | undefined {
  if (row.name !== SLEEP) return undefined;

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
