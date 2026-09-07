import { ownerOf } from '../../core/rules.js';
import type { LiveOutcome, StepState } from '../../runs/reading.js';
import { FIRST_DISPATCH, type StepError } from '../../runs/rows.js';
import type { LiveRun, LiveStep } from '../../runs/watch.js';

/**
 * What a run recorded about one block, read off the
 * rows it wrote.
 *
 * "Evidence" is used two ways in this extension and
 * this is the narrow one: what a reader holds about
 * a block, as far as one run's rows say. The other
 * — `runs/evidence.ts` — is a whole document
 * assembled for an agent out of the ledger, the
 * saved workflow and the last code scan. Nothing is
 * shared between them but the word.
 *
 * The rows are the whole of it. A block that ran
 * three times wrote three of them; a wait wrote the
 * two halves of parking; a branch the generated
 * code decided without asking anybody wrote none.
 * What is not here is as load-bearing as what is:
 * DBOS records no per-step input and no count of
 * the tries a step made, so neither is derivable
 * and neither is offered.
 *
 * Times stay numbers. Turning an epoch into a clock
 * is the reader's locale's business and belongs
 * where the card is drawn, which also keeps this
 * module free of anything a test would have to pin
 * a timezone for.
 *
 * Browser-safe: no clock, no database, no document.
 */

/** One row the ledger holds for a block. */
export type EvidenceRow = {
  /** DBOS's own numbering, which is the order the
   *  rows ran in. */
  functionId: number;

  /** The name the ledger recorded, whole. */
  name: string;

  /**
   * Which part of the block this row is — `[2]`,
   * `.r3`, `.register` — or nothing where the block
   * wrote a single row.
   *
   * The recorded name with the block's own id taken
   * off the front, because that is exactly what the
   * emitter put on it.
   */
  part: string | undefined;

  state: StepState;

  startedAt: number | undefined;

  completedAt: number | undefined;

  /** How long it took, where the SDK timed both
   *  ends. */
  durationMs: number | undefined;

  /** What it returned, as far as the reading kept
   *  it. */
  output: string | undefined;

  outputCut: boolean;

  error: StepError | undefined;

  /** Whether the output came back from Postgres
   *  rather than from running the code again. */
  restored: boolean;

  /** Whether the row was carried over from the run
   *  this one was replayed from. */
  reused: boolean;
};

/** What one run recorded about one block. */
export type BlockEvidence = {
  /** Its rows, in the order DBOS numbered them. */
  rows: EvidenceRow[];

  /**
   * The one row the card draws in full.
   *
   * The latest failure where there is one, and the
   * latest row otherwise. A block that failed on
   * its third item is a block somebody is looking at
   * because of that item, and burying it under two
   * that worked would be the card answering a
   * question nobody asked.
   */
  headline: EvidenceRow | undefined;

  /**
   * When the run parked here, where it is parked
   * here now.
   *
   * The moment the registration landed: that row is
   * what says the run stopped, so it is what says
   * when. A time and never a count, because nothing
   * is still reading a run that parked.
   */
  waitingSince: number | undefined;

  /**
   * How many times round this run went, where it
   * went round at all.
   *
   * Read off the names of the rows inside the block
   * rather than its own, because the block that
   * asks — a loop — writes no row of its own, and
   * the rows carrying a round number are the ones
   * it encloses.
   */
  rounds: number | undefined;
};

/** What the run itself says, which is where what it
 *  was started with is drawn and nowhere else. */
export type RunCard = {
  workflowId: string;

  workflow: string;

  /** DBOS's own word, passed through rather than
   *  translated. */
  status: string;

  /** Where the run got to, which is what that word
   *  is coloured by — the word itself is the
   *  application's and cannot be. */
  outcome: LiveOutcome;

  startedAt: number | undefined;

  completedAt: number | undefined;

  durationMs: number | undefined;

  /** What the run was started with, printed. */
  input: string | undefined;

  /** How many times DBOS picked it back up, which
   *  is one fewer than the column says. */
  recoveries: number;

  applicationVersion: string | undefined;
};

/**
 * What one run recorded about one block.
 *
 * `body` is the blocks this one encloses, which
 * only a loop has and only the document knows: a
 * recorded row carries the round it ran in and not
 * the loop that numbered it, so two loops in one
 * run are two counts that nothing in the ledger
 * tells apart. Handed in rather than guessed,
 * because a card asked to guess would answer both
 * loops with the run's whole set.
 */
export function evidenceOf(
  run: LiveRun,
  nodeId: string,
  body: readonly string[] | undefined,
): BlockEvidence {
  const rows = run.steps
    .filter((step) => step.nodeId === nodeId)
    .map((step) => rowOf(step, nodeId));

  return {
    rows,
    headline: rows.findLast((row) => row.state === 'failed') ?? rows.at(-1),
    waitingSince: parkedSince(rows),
    rounds: roundsIn(run.steps, body),
  };
}

export function runCardOf(run: LiveRun): RunCard {
  return {
    workflowId: run.workflowId,
    workflow: run.workflow,
    status: run.status,
    outcome: run.outcome,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: spanOf(run.startedAt, run.completedAt),
    input: run.input,
    recoveries: Math.max(run.recoveryAttempts - FIRST_DISPATCH, 0),
    applicationVersion: run.applicationVersion,
  };
}

function rowOf(step: LiveStep, nodeId: string): EvidenceRow {
  const part = step.name.slice(nodeId.length);

  return {
    functionId: step.functionId,
    name: step.name,
    part: part === '' ? undefined : part,
    state: step.state,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: spanOf(step.startedAt, step.completedAt),
    output: step.output,
    outputCut: step.outputCut,
    error: step.error,
    restored: step.restored,
    reused: step.reused,
  };
}

/**
 * When the run stopped here, where it has not
 * started again.
 *
 * Asked of the rows' own state rather than of the
 * names a second time: the reading already worked
 * out which blocks a run is parked on, and asking
 * that question twice is how two panels come to
 * disagree about whether somebody is being waited
 * for.
 */
function parkedSince(rows: readonly EvidenceRow[]): number | undefined {
  if (!rows.some((row) => row.state === 'waiting')) return undefined;

  const registered = rows.findLast((row) => row.part?.endsWith('.register'));

  return registered?.completedAt ?? registered?.startedAt;
}

/**
 * How many distinct rounds the rows inside a block
 * were written under, or nothing where the block
 * encloses none or none of them went round.
 *
 * Scoped to the enclosed blocks rather than counted
 * across the run: a workflow may have two loops,
 * and a set built from every row would report each
 * of them the other's rounds as well as its own.
 */
function roundsIn(
  steps: readonly LiveStep[],
  body: readonly string[] | undefined,
): number | undefined {
  if (body === undefined) return undefined;

  const inside = new Set(body);
  const rounds = new Set(
    steps.flatMap((step) => {
      const owner = ownerOf(step.name);
      if (owner.kind !== 'node' || !inside.has(owner.nodeId)) return [];

      return owner.segments.flatMap((segment) =>
        segment.kind === 'round' ? [segment.round] : [],
      );
    }),
  );

  return rounds.size === 0 ? undefined : rounds.size;
}

function spanOf(
  from: number | undefined,
  to: number | undefined,
): number | undefined {
  return from === undefined || to === undefined ? undefined : to - from;
}
