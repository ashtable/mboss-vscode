import type { LiveOutcome } from './reading.js';

/**
 * What this window has set going.
 *
 * Memory in the extension host, for as long as the
 * process lives, and nothing written anywhere. The
 * durable record of a run is `dbos.workflow_status`
 * in the project's own database — a second record
 * beside it would drift from it, and be wrong in
 * exactly the cases somebody is looking at this
 * list to understand.
 *
 * What it is for is the part the ledger cannot
 * answer: what *this* person started, with what
 * input, since they opened the window. A run
 * refused by the ingress has no row in the ledger
 * at all, and is the clearest example — it exists
 * only here.
 */

/**
 * How a run this window is watching came to be.
 *
 * `start` is somebody pressing Run with an input
 * they typed. The other two are runs that already
 * existed: a fork from one of a run's steps, and a
 * run DBOS was told to pick back up. Only the
 * first has an input this side knows, which is why
 * the difference is worth carrying rather than
 * inferring.
 */
export type SessionVia = 'start' | 'resume' | 'replay';

/** One run somebody started from this window. */
export type SessionRun = {
  workflowId: string;

  /** The workflow it is a run of. */
  workflow: string;

  /** What it was started with, kept so that
   *  running it again needs nothing typed.
   *  `undefined` where this window never held it —
   *  a fork carries the original's input, which
   *  only the ledger has. */
  input: unknown;

  startedAt: number;

  outcome: LiveOutcome;

  durationMs?: number;

  stepCount: number;

  /** The step that threw, and what the run
   *  recorded as its error. */
  failedStep?: { name: string; error: string };

  /** Why it failed when no step did: the ingress
   *  refused to start it. */
  error?: string;

  /** Sticky: once a run recovered, it keeps saying
   *  so even after it finishes. */
  recovered: boolean;

  /** What put it here. */
  via: SessionVia;

  /** The run and the step a replay forked from.
   *  The ledger's own column names the run but not
   *  the step somebody picked, so this is the only
   *  record of that half. */
  replayOf?: { workflowId: string; functionId: number };
};

/**
 * How many runs are remembered.
 *
 * A bound rather than a setting, because this is
 * memory nothing ever hands back and a window left
 * open for a week is the ordinary case. The ledger
 * has all of them.
 *
 * The cap and the not-writing are one decision,
 * not two: an unbounded list would have to be
 * spilled somewhere, and anything spilled becomes
 * a second record of a run that the ledger is
 * already the record of.
 */
export const SESSION_LOG_LIMIT = 100;

export type SessionLog = {
  record(run: SessionRun): void;

  update(workflowId: string, patch: Partial<SessionRun>): void;

  /** Newest first, which is the order the panel
   *  draws them in. */
  list(): SessionRun[];

  find(workflowId: string): SessionRun | undefined;
};

export function sessionLog(): SessionLog {
  // In the order they were started, so the limit
  // drops the oldest and the list reverses.
  const runs: SessionRun[] = [];

  const at = (workflowId: string): number =>
    runs.findIndex((run) => run.workflowId === workflowId);

  return {
    record: (run) => {
      runs.push(run);

      if (runs.length > SESSION_LOG_LIMIT) runs.shift();
    },

    update: (workflowId, patch) => {
      const index = at(workflowId);
      const run = runs[index];

      if (run === undefined) return;

      runs[index] = {
        ...run,
        ...patch,
        // Never unsaid. The design treats recovery
        // as a first-class state, and a run that
        // crashed and then finished green would
        // otherwise be indistinguishable from one
        // that never crashed.
        recovered: run.recovered || (patch.recovered ?? false),
      };
    },

    list: () => [...runs].reverse(),

    find: (workflowId) => runs[at(workflowId)],
  };
}

/**
 * The id a run that never started is remembered
 * under.
 *
 * An event run has no id until the app echoes one,
 * so a refused start has nothing to be keyed on —
 * and a failure with no row is a failure nobody
 * sees. This gives it one, and says in the id
 * itself that there is no run behind it.
 */
export function refusedRunId(): string {
  return `refused_${Date.now()}`;
}
