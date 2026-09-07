import { detailOf } from './failure.js';
import type { ManagementClient } from './manage.js';
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
 * The client is taken as the narrow management
 * type rather than as DBOS's own, so this module
 * never has to know how one is opened and cannot
 * reach for anything the extension has decided not
 * to do.
 */

export type Replay =
  | {
      at: 'forked';

      /** The new run, which is a different run with
       *  a different id. */
      workflowId: string;

      /** The version it will execute under. */
      applicationVersion: string;

      /**
       * The step it starts executing at.
       *
       * Nothing in the new run's own rows says
       * this: every step before it is copied in and
       * reads exactly like one that ran. Whoever
       * asked for the fork is the only witness, so
       * the answer carries it back.
       */
      startStep: number;

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
 *
 * The id is named on every fork too, and by the
 * caller rather than here. Left to itself DBOS
 * mints one and hands it back, which means the run
 * exists for a moment before anything on screen
 * knows its name — and a fork the database then
 * refuses has no row anywhere to say so. Minting
 * it first turns that round.
 */
export async function replayFrom(
  client: ManagementClient,
  run: Run,
  startStep: number,
  options: { newWorkflowID: string },
): Promise<Replay> {
  try {
    const latest = await client.getLatestApplicationVersion();

    const workflowId = await client.forkWorkflow(run.workflowId, startStep, {
      applicationVersion: latest.versionName,
      newWorkflowID: options.newWorkflowID,
    });

    return {
      at: 'forked',
      workflowId,
      applicationVersion: latest.versionName,
      startStep,
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
