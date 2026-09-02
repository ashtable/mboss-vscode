import { hasRecovered, type Run, type Step } from './rows.js';

/**
 * A run, laid out as something drawable.
 *
 * The hard part is not the arithmetic, it is the
 * one thing the database does not record. Nothing
 * in `dbos.workflow_status` or
 * `dbos.operation_outputs` marks a step as
 * restored from the ledger rather than freshly
 * executed, and no column anywhere holds the
 * moment a process died.
 *
 * Two facts are available. `recovery_attempts`
 * says a run was picked back up at some point —
 * once its first dispatch is discounted, which is
 * what `hasRecovered` does.
 * And a restored step keeps the timestamps it was
 * first written with — DBOS never rewrites them —
 * so a recovered run's ordered steps fall into a
 * before half and an after half with a hole
 * between them.
 *
 * The rule this file applies, and the only place
 * it is applied: **on a run that recovered, the
 * widest hole between one step finishing and the
 * next one starting is the outage; every step that
 * finished by then was restored.** That is an
 * inference, and it has one failure mode worth
 * knowing about — a workflow that genuinely waits
 * a long time between two steps, and also crashed
 * somewhere else, will have its band drawn over
 * the wait. It is bounded by the fact that a run
 * DBOS never recovered never gets a band at all,
 * so the drawing can only be wrong about *where*
 * a real crash was, never about whether there was
 * one.
 *
 * If DBOS ever records a recovery timestamp, this
 * is the one function that changes.
 */

/** One step, with everything the strip and the
 *  bars need. */
export type TimelineStep = {
  functionId: number;

  name: string;

  startedAt: number | undefined;

  completedAt: number | undefined;

  error: string | undefined;

  /**
   * Whether this step's output came back from
   * Postgres rather than from running the code
   * again.
   */
  restored: boolean;
};

/** When nothing was running because nothing was
 *  alive to run it. */
export type Outage = { from: number; to: number };

export type Timeline = {
  /** The window the bars are drawn in. */
  from: number;

  to: number;

  steps: TimelineStep[];

  outage: Outage | undefined;
};

/**
 * A window is never zero-width, so that a bar in a
 * run that took no measurable time still has
 * somewhere to be drawn.
 */
const MINIMUM_SPAN_MS = 1;

export function runTimeline(run: Run, steps: Step[]): Timeline {
  const outage = hasRecovered(run) ? widestHole(steps) : undefined;

  return {
    from: run.startedAt ?? run.createdAt,
    to: endOf(run, steps),
    outage,
    steps: steps.map((step) => ({
      functionId: step.functionId,
      name: step.name,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      error: step.error,
      restored:
        outage !== undefined &&
        step.completedAt !== undefined &&
        step.completedAt <= outage.from,
    })),
  };
}

/**
 * The widest gap between one step finishing and a
 * later one starting.
 *
 * Steps arrive in `function_id` order, which is the
 * order they ran in. A step DBOS has not timed
 * bounds nothing — it is skipped here and still
 * drawn, because a step missing from the strip is
 * a step nobody knows ran.
 */
function widestHole(steps: Step[]): Outage | undefined {
  const timed = steps.filter(
    (step) => step.startedAt !== undefined && step.completedAt !== undefined,
  );

  let widest: Outage | undefined;

  for (let index = 1; index < timed.length; index += 1) {
    const before = timed[index - 1]?.completedAt;
    const after = timed[index]?.startedAt;

    if (before === undefined || after === undefined) continue;
    if (after <= before) continue;

    if (widest === undefined || after - before > widest.to - widest.from) {
      widest = { from: before, to: after };
    }
  }

  return widest;
}

/**
 * The right edge.
 *
 * A finished run ends when it finished. One still
 * going ends at the last thing that has happened,
 * because a bar drawn against an unknown end is
 * drawn against nothing.
 */
function endOf(run: Run, steps: Step[]): number {
  const from = run.startedAt ?? run.createdAt;

  const latest = Math.max(
    run.completedAt ?? 0,
    ...steps.flatMap((step) =>
      step.completedAt === undefined ? [] : [step.completedAt],
    ),
  );

  return Math.max(latest, from + MINIMUM_SPAN_MS);
}
