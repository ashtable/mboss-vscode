import { detailOf } from './failure.js';
import type { Run } from './rows.js';

/**
 * The one write this view makes.
 *
 * Forking is DBOS's word for it: a new run is
 * written that inherits every step before the one
 * named, and starts executing from there. Doing
 * that by hand would mean composing an insert into
 * `workflow_status` and a copy out of
 * `operation_outputs` against somebody else's
 * schema, which is exactly the kind of thing the
 * read path avoids the client for and exactly the
 * kind of thing to use it for.
 *
 * Taken as an interface rather than as the client
 * itself, so the rule below can be stated in a
 * test without a database: DBOS's own client
 * satisfies it structurally, and this module never
 * has to know how one is opened.
 */
export type ForkClient = {
  getLatestApplicationVersion(): Promise<{ versionName: string }>;

  forkWorkflow(
    workflowID: string,
    startStep: number,
    options?: { applicationVersion?: string },
  ): Promise<string>;

  destroy(): Promise<void>;
};

export type Replay =
  | {
      at: 'forked';

      /** The new run, which is a different run with
       *  a different id. */
      workflowId: string;

      /** The version it will execute under. */
      applicationVersion: string;

      /**
       * The version the original ran under, when
       * that is not the same one — which means the
       * replay is running code that has been
       * regenerated since.
       */
      movedFrom: string | undefined;
    }
  | { at: 'refused'; detail: string };

/**
 * Runs one workflow again from one of its steps.
 *
 * The version is named on every fork, never left
 * to the default. DBOS's default is the version
 * the *original* run carried, and a worker only
 * ever dequeues its own version — so a fork of a
 * run started under code that has since been
 * regenerated would sit `ENQUEUED` for ever, with
 * nothing in any panel to say why. Naming the
 * latest is what makes the fork reachable by the
 * app the person is actually running.
 *
 * It does not make it reachable by an app that is
 * not running at all. Nothing in the schema says
 * whether a worker is alive, so the panel says
 * which version the fork is waiting for instead of
 * pretending to know.
 */
export async function replayFrom(
  client: ForkClient,
  run: Run,
  startStep: number,
): Promise<Replay> {
  try {
    const latest = await client.getLatestApplicationVersion();

    const workflowId = await client.forkWorkflow(run.workflowId, startStep, {
      applicationVersion: latest.versionName,
    });

    return {
      at: 'forked',
      workflowId,
      applicationVersion: latest.versionName,
      movedFrom:
        run.applicationVersion !== undefined &&
        run.applicationVersion !== latest.versionName
          ? run.applicationVersion
          : undefined,
    };
  } catch (cause) {
    return { at: 'refused', detail: detailOf(cause) };
  } finally {
    // A pool left open outlives the click that made
    // it, and this one is opened per replay.
    await client.destroy().catch(() => undefined);
  }
}
